/*
 * Code Map: Multi-Provider Embedding Ensemble
 * - EmbeddingEnsemble: Orchestrates multi-provider embedding with fallback + adaptive weights
 *
 * CID Index:
 * CID:emb-ensemble-001 -> EmbeddingEnsemble
 *
 * Quick lookup: rg -n "CID:emb-ensemble-" src/core/embeddings/ensemble.ts
 */

import {
  EmbeddingProvider,
  EmbeddingResult,
  EnsembleResult,
  ProviderName,
  WeightProfile,
} from "./types";
import { OpenAIProvider } from "./providers/openai-provider";
import { GoogleProvider } from "./providers/google-provider";
import { LocalProvider } from "./providers/local-provider";
import {
  computeAgreement,
  calculateAdaptiveWeights,
  redistributeWeights,
} from "./weights";
import { EmbeddingCacheModel } from "../../models/EmbeddingCache";
import crypto from "crypto";

// CID:emb-ensemble-001 - EmbeddingEnsemble
// Purpose: Coordinate 3-provider embedding with graceful fallback and adaptive weighting
// Uses: EmbeddingProvider implementations, weights module
// Used by: normalize.ts, seed-loader, integration tests
export class EmbeddingEnsemble {
  private providers: Map<ProviderName, EmbeddingProvider>;

  constructor(
    providers?: Partial<Record<ProviderName, EmbeddingProvider>>
  ) {
    this.providers = new Map<ProviderName, EmbeddingProvider>();

    const openai = providers?.openai ?? new OpenAIProvider();
    const google = providers?.google ?? new GoogleProvider();
    const local = providers?.local ?? new LocalProvider();

    this.providers.set("openai", openai);
    this.providers.set("google", google);
    this.providers.set("local", local);
  }

  /** Generate ensemble embedding for input text (with cache lookup) */
  async embed(text: string): Promise<EnsembleResult> {
    // Decision 9: Check persistent cache before calling providers
    const textHash = this.hashText(text);
    const cached = await this.lookupCache(textHash);
    if (cached) {
      return this.reconstructFromCache(cached);
    }

    const allResults = await this.runProviders(text);
    const successful = allResults.filter((r) => r.vector.length > 0);
    const failed = allResults.filter((r) => r.error);
    const attemptedProviders = successful.length + failed.length;

    if (successful.length === 0) {
      if (attemptedProviders === 0) {
        throw new Error("No embedding providers are configured or currently available");
      }
      throw new Error(
        `All embedding providers failed: ${failed.map((r) => `${r.provider}: ${r.error}`).join("; ")}`
      );
    }

    const providersUsed = successful.map((r) => r.provider);
    const degraded = failed.length > 0;

    // Compute agreement across successful providers
    const agreement = computeAgreement(successful);

    // Select weights: adaptive if 2+ providers, redistributed if degraded
    let weights: WeightProfile;
    if (successful.length < 3) {
      weights = redistributeWeights(providersUsed);
    } else {
      weights = calculateAdaptiveWeights(agreement);
    }

    // Compute weighted average vector (projected to OpenAI dimension for consistency)
    const vector = this.computeWeightedVector(successful, weights);

    // Confidence: agreement average * attempted provider coverage ratio
    const coverage = this.calculateCoverage(successful.length, attemptedProviders);
    const confidence = Math.min(agreement.average * coverage, 1.0);

    const result: EnsembleResult = {
      vector,
      dimension: vector.length,
      results: successful,
      providersUsed,
      weights,
      agreement,
      confidence,
      degraded,
    };

    // Store in persistent cache (fire-and-forget)
    this.storeCache(textHash, text, successful, attemptedProviders).catch(() => {
      // Cache write failure is non-critical
    });

    return result;
  }

  /** Run available providers in parallel, collecting results (errors become failed results) */
  private async runProviders(text: string): Promise<EmbeddingResult[]> {
    const entries = Array.from(this.providers.entries());
    const promises = entries.map(async ([name, provider]) => {
      try {
        const available = await provider.isAvailable();
        if (!available) return null;
        return await provider.embed(text);
      } catch (err: any) {
        return {
          provider: name,
          vector: [],
          dimension: 0,
          latencyMs: 0,
          error: err?.message ?? String(err),
        } satisfies EmbeddingResult;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((result): result is EmbeddingResult => result !== null);
  }

  /**
   * Compute weighted average of provider vectors.
   * Vectors of different dimensions are zero-padded to the max dimension
   * among successful providers, then weighted and summed.
   */
  private computeWeightedVector(
    results: EmbeddingResult[],
    weights: WeightProfile
  ): number[] {
    const maxDim = Math.max(...results.map((r) => r.dimension));
    const combined = new Float64Array(maxDim);

    for (const r of results) {
      const w = weights[r.provider];
      for (let i = 0; i < r.vector.length; i++) {
        combined[i] += r.vector[i] * w;
      }
    }

    return Array.from(combined);
  }

  /** Hash input text for cache key (SHA256) */
  private hashText(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
  }

  /** Look up cached embedding by text hash */
  private async lookupCache(textHash: string) {
    try {
      const doc = await EmbeddingCacheModel.findOne({ textHash });
      if (!doc) return null;

      // Update access tracking (LRU analytics)
      await EmbeddingCacheModel.updateOne(
        { textHash },
        { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } }
      );

      return doc;
    } catch {
      return null;
    }
  }

  /** Reconstruct EnsembleResult from cached document */
  private reconstructFromCache(doc: any): EnsembleResult {
    const results: EmbeddingResult[] = [];
    const providersUsed: ProviderName[] = [];
    const embeddings = doc.embeddings || {};

    for (const [name, vector] of Object.entries(embeddings)) {
      if (Array.isArray(vector) && vector.length > 0) {
        results.push({
          provider: name as ProviderName,
          vector: vector as number[],
          dimension: (vector as number[]).length,
          latencyMs: 0, // Cache hit = instant
        });
        providersUsed.push(name as ProviderName);
      }
    }

    const agreement = computeAgreement(results);
    const weights =
      providersUsed.length < 3
        ? redistributeWeights(providersUsed)
        : calculateAdaptiveWeights(agreement);
    const vector = this.computeWeightedVector(results, weights);
    const cachedSuccessful =
      Array.isArray(doc.providersUsed) && doc.providersUsed.length > 0
        ? doc.providersUsed.length
        : providersUsed.length;
    const cachedAttempted =
      typeof doc.attemptedProviders === "number" && doc.attemptedProviders > 0
        ? doc.attemptedProviders
        : cachedSuccessful;
    const coverage = this.calculateCoverage(cachedSuccessful, cachedAttempted);
    const confidence = Math.min(agreement.average * coverage, 1.0);

    return {
      vector,
      dimension: vector.length,
      results,
      providersUsed,
      weights,
      agreement,
      confidence,
      degraded: false, // Cache hit is not degraded
    };
  }

  private calculateCoverage(successfulCount: number, attemptedCount: number): number {
    if (attemptedCount === 0) return 0;
    return successfulCount / attemptedCount;
  }

  /** Store successful embedding results in cache */
  private async storeCache(
    textHash: string,
    originalText: string,
    results: EmbeddingResult[],
    attemptedProviders: number
  ): Promise<void> {
    const embeddings: Record<string, number[]> = {};
    const providersUsed: ProviderName[] = [];
    for (const r of results) {
      if (r.vector.length > 0) {
        embeddings[r.provider] = r.vector;
        providersUsed.push(r.provider);
      }
    }

    await EmbeddingCacheModel.findOneAndUpdate(
      { textHash },
      {
        $setOnInsert: {
          textHash,
          originalText,
          embeddings,
          providersUsed,
          attemptedProviders,
          confidence: 0, // Will be updated by normalize flow
          accessCount: 0,
          lastAccessedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /** Evict least-recently-used cache entries (LRU policy) */
  async evictCache(maxEntries = 10000): Promise<number> {
    const count = await EmbeddingCacheModel.countDocuments();
    if (count <= maxEntries) return 0;

    const toRemove = count - maxEntries;
    const oldest = await EmbeddingCacheModel.find()
      .sort({ lastAccessedAt: 1 })
      .limit(toRemove)
      .select("_id")
      .lean();

    if (oldest.length === 0) return 0;

    await EmbeddingCacheModel.deleteMany({
      _id: { $in: oldest.map((d) => d._id) },
    });

    return oldest.length;
  }

  /** Check which providers are currently reachable */
  async checkAvailability(): Promise<Record<ProviderName, boolean>> {
    const status: Record<ProviderName, boolean> = { openai: false, google: false, local: false };
    const checks = Array.from(this.providers.entries()).map(
      async ([name, provider]) => {
        try {
          status[name] = await provider.isAvailable();
        } catch {
          status[name] = false;
        }
      }
    );
    await Promise.all(checks);
    return status;
  }
}
