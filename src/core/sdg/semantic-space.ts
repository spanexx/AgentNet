/*
 * Code Map: Semantic Space Engine
 * - SemanticSpace: Unified semantic search + continuous clustering (replaces IntentResolver + TagGenerator)
 * - search: Top-K cluster similarity search across the semantic space
 * - updateCentroid: Continuous centroid update (not upsert — clusters evolve)
 * - maybeDiscover: Emergent cluster discovery for novel inputs
 *
 * CID Index:
 * CID:sem-space-eng-001 -> SemanticSpace
 * CID:sem-space-eng-002 -> search
 * CID:sem-space-eng-003 -> updateCentroid
 * CID:sem-space-eng-004 -> maybeDiscover
 *
 * Quick lookup: rg -n "CID:sem-space-eng-" src/core/sdg/semantic-space.ts
 */

import { SemanticClusterModel, SemanticClusterDoc } from "../../models/SemanticCluster";
import { cosineSimilarity } from "../embeddings";
import {
  ClusterMatch,
  SemanticHypothesis,
  GeometricConfidence,
  DEFAULT_TOP_K,
  MIN_HYPOTHESIS_SCORE,
  MIN_CLUSTER_DENSITY,
} from "./types";
import { EnsembleResult } from "../embeddings/types";

// CID:sem-space-eng-001 - SemanticSpace
// Purpose: Unified semantic search engine — clusters evolve, intents are emergent
// Uses: SemanticClusterModel, cosineSimilarity
// Used by: normalizeMessage
export class SemanticSpace {
  private cache: Map<string, SemanticClusterDoc[]> = new Map();

  /**
   * Search the semantic space for top-K clusters matching the input vector.
   * Returns separate intent and tag matches so hypotheses can be constructed.
   */
  async search(
    inputVector: number[],
    _ensembleResult: EnsembleResult,
    topK = DEFAULT_TOP_K
  ): Promise<{ intentMatches: ClusterMatch[]; tagMatches: ClusterMatch[] }> {
    const clusters = await this.loadClusters();

    const intentMatches: ClusterMatch[] = [];
    const tagMatches: ClusterMatch[] = [];

    for (const cluster of clusters) {
      if (cluster.centroid.length === 0) continue;

      const score = cosineSimilarity(inputVector, cluster.centroid);
      if (score < MIN_HYPOTHESIS_SCORE) continue;

      const match: ClusterMatch = {
        label: cluster.label,
        score,
        density: cluster.density,
        source: cluster.source,
      };

      if (cluster.kind === "intent") {
        intentMatches.push(match);
      } else {
        tagMatches.push(match);
      }
    }

    // Sort by score descending, take top-K
    intentMatches.sort((a, b) => b.score - a.score);
    tagMatches.sort((a, b) => b.score - a.score);

    return {
      intentMatches: intentMatches.slice(0, topK),
      tagMatches: tagMatches.slice(0, topK),
    };
  }

  /**
   * Construct ranked hypotheses from cluster matches.
   * Each hypothesis pairs an intent cluster with its best tag projections.
   */
  constructHypotheses(
    intentMatches: ClusterMatch[],
    tagMatches: ClusterMatch[],
    agreement: number
  ): SemanticHypothesis[] {
    if (intentMatches.length === 0 && tagMatches.length === 0) {
      return [
        {
          intent: "general",
          tags: [],
          confidence: {
            value: 0,
            density: 0,
            agreement,
            distance: 1,
          },
          source: "fallback",
        },
      ];
    }

    // If no intent matches but we have tags, create a general-intent hypothesis
    if (intentMatches.length === 0) {
      const tags = tagMatches.map((t) => t.label);
      return [
        {
          intent: "general",
          tags,
          confidence: computeGeometricConfidence(0, 0, agreement, 1),
          source: "fallback",
        },
      ];
    }

    const hypotheses: SemanticHypothesis[] = [];

    for (const intentMatch of intentMatches) {
      // Project tags: include tags that are semantically coherent with this intent
      const coherentTags = tagMatches
        .filter((t) => t.score >= MIN_HYPOTHESIS_SCORE)
        .map((t) => t.label);

      const confidence = computeGeometricConfidence(
        intentMatch.density,
        intentMatch.score,
        agreement,
        1 - intentMatch.score // distance = 1 - similarity
      );

      hypotheses.push({
        intent: intentMatch.label,
        tags: coherentTags,
        confidence,
        source: intentMatch.source,
      });
    }

    // Sort by confidence value descending
    hypotheses.sort((a, b) => b.confidence.value - a.confidence.value);
    return hypotheses;
  }

  /**
   * Continuous centroid update — clusters evolve, they are not replaced.
   * This is the core difference from the old upsert-based learning.
   * Uses exponential moving average to shift the centroid toward new data.
   */
  async updateCentroid(
    clusterLabel: string,
    inputVector: number[],
    inputText: string,
    learningRate = 0.1
  ): Promise<void> {
    const cluster = await SemanticClusterModel.findOne({ label: clusterLabel });
    if (!cluster || cluster.centroid.length === 0) return;

    // Exponential moving average: centroid = (1 - α) * old + α * new
    const updated = cluster.centroid.map((c, i) =>
      (1 - learningRate) * c + learningRate * (inputVector[i] ?? c)
    );

    await SemanticClusterModel.updateOne(
      { label: clusterLabel },
      {
        $set: { centroid: updated },
        $inc: { density: 1, frequency: 1 },
        $push: {
          exemplars: {
            $each: [inputText],
            $slice: -20, // Keep last 20 exemplars
          },
        },
      }
    );
  }

  /**
   * Discover a new emergent cluster when no existing cluster matches well.
   * Unlike the old maybeLearn/maybeDiscover which upsert, this creates a cluster
   * that will evolve its centroid over time.
   */
  async maybeDiscover(
    inputVector: number[],
    inputText: string,
    bestIntentScore: number,
    bestTagScore: number,
    kind: "intent" | "tag"
  ): Promise<void> {
    // Only discover if no strong match exists
    const threshold = kind === "intent" ? 0.60 : 0.50;
    const bestScore = kind === "intent" ? bestIntentScore : bestTagScore;

    if (bestScore >= 0.85) return; // Already well-matched
    if (bestScore < threshold) return; // Too noisy

    const label = inputText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .slice(0, kind === "intent" ? 3 : 2)
      .join("_");

    if (!label) return;

    await SemanticClusterModel.findOneAndUpdate(
      { label, kind },
      {
        $setOnInsert: {
          label,
          kind,
          centroid: inputVector,
          density: 1,
          exemplars: [inputText],
          source: "learned",
          frequency: 1,
          discoveredAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /** Load clusters from MongoDB with in-memory cache (60s TTL) */
  private async loadClusters(): Promise<SemanticClusterDoc[]> {
    const cacheKey = "all";
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const clusters = await SemanticClusterModel.find().lean();
    const docs = clusters as unknown as SemanticClusterDoc[];
    this.cache.set(cacheKey, docs);

    setTimeout(() => this.cache.delete(cacheKey), 60_000);
    return docs;
  }

  /** Force cache invalidation */
  invalidateCache(): void {
    this.cache.clear();
  }
}

/**
 * Compute geometric confidence from spatial properties.
 * confidence = density_signal × agreement × (1 - distance)
 * This replaces the old avg(intentConf, tagConf) — no more premature collapse.
 */
function computeGeometricConfidence(
  density: number,
  similarity: number,
  agreement: number,
  distance: number
): GeometricConfidence {
  // Density signal: log-scaled so it doesn't dominate but rewards established clusters
  const densitySignal = Math.log2(Math.max(density, MIN_CLUSTER_DENSITY)) /
    Math.log2(100); // Normalize: density of 100 = signal of 1.0

  const value = Math.min(
    densitySignal * agreement * (1 - distance),
    1.0
  );

  return {
    value: Math.max(value, similarity * 0.5), // Floor: similarity alone gives at least 50%
    density,
    agreement,
    distance,
  };
}
