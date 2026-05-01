/*
 * Code Map: Query Understanding Module
 * - interpretQuery: Accepts free-text and produces a normalized semantic query
 * - interpretQueryFallback: String-matching fallback when embeddings are unavailable
 *
 * CID Index:
 * CID:query-und-001 -> interpretQuery
 * CID:query-und-002 -> interpretQueryFallback
 *
 * Quick lookup: rg -n "CID:query-und-" src/core/query-understanding.ts
 */

import { getEnsemble, getSemanticSpace } from "./normalize";
import { DEFAULT_TOP_K, ClusterMatch } from "./sdg";
import { SemanticClusterModel } from "../models/SemanticCluster";
import { getCachedSemanticQuery, setCachedSemanticQuery } from "./semantic-query-cache";

/**
 * Normalized semantic query produced from free-text interpretation.
 * This is the read-path counterpart to `NormalizedMessage` on the write path.
 */
export interface SemanticQuery {
  /** The original raw text the user typed */
  originalText: string;
  /** Best-matching intent cluster label, or null when degraded */
  interpretedIntent: string | null;
  /** Best-matching tag cluster labels */
  interpretedTags: string[];
  /** Ensemble embedding vector for similarity search */
  vector: number[];
  /** Interpretation confidence (0–1) */
  confidence: number;
  /** Which embedding providers contributed */
  providersUsed: string[];
  /** True if embedding providers were unavailable */
  degraded: boolean;
  /** Raw intent cluster matches for scoring use */
  intentMatches: ClusterMatch[];
  /** Raw tag cluster matches for scoring use */
  tagMatches: ClusterMatch[];
}

// CID:query-und-001 - interpretQuery
// Purpose: Transform free-text search query into structured semantic query
// Uses: EmbeddingEnsemble, SemanticSpace (read-only — no centroid updates)
// Used by: semanticSearchController, solution-retrieval
export async function interpretQuery(text: string): Promise<SemanticQuery> {
  const trimmed = text.trim();
  if (!trimmed) {
    return buildEmptyQuery(text);
  }

  const cached = getCachedSemanticQuery(trimmed);
  if (cached) {
    return cached;
  }

  const ensemble = getEnsemble();

  try {
    const ensembleResult = await ensemble.embed(trimmed);
    const space = getSemanticSpace();

    // Read-only search — intentionally no updateCentroid or maybeDiscover
    const { intentMatches, tagMatches } = await space.search(
      ensembleResult.vector,
      ensembleResult,
      DEFAULT_TOP_K
    );

    const bestIntent = intentMatches.length > 0 ? intentMatches[0] : null;
    const interpretedTags = tagMatches
      .filter((t) => t.score >= 0.50)
      .map((t) => t.label);

    const confidence = bestIntent
      ? bestIntent.score * ensembleResult.agreement.average
      : ensembleResult.agreement.average * 0.3;

    const result: SemanticQuery = {
      originalText: trimmed,
      interpretedIntent: bestIntent?.label ?? null,
      interpretedTags,
      vector: ensembleResult.vector,
      confidence: Math.min(confidence, 1.0),
      providersUsed: ensembleResult.providersUsed,
      degraded: ensembleResult.degraded,
      intentMatches,
      tagMatches,
    };
    setCachedSemanticQuery(trimmed, result);
    return result;
  } catch {
    // All providers failed — fall back to string matching
    const fallback = await interpretQueryFallback(trimmed);
    setCachedSemanticQuery(trimmed, fallback);
    return fallback;
  }
}

// CID:query-und-002 - interpretQueryFallback
// Purpose: Dynamic fallback for query interpretation using stored cluster labels
// Uses: SemanticClusterModel (queries labels + exemplars, no hardcoded keywords)
// Used by: interpretQuery
async function interpretQueryFallback(text: string): Promise<SemanticQuery> {
  const lower = text.toLowerCase();

  // Query stored clusters — match against labels and exemplars dynamically
  let bestIntent: string | null = null;
  const matchedTags: string[] = [];

  try {
    const clusters = await SemanticClusterModel.find().lean();

    let bestIntentScore = 0;
    for (const cluster of clusters) {
      const label = cluster.label.toLowerCase();
      // Check if query text contains the label or any exemplar contains the query
      const labelMatch = lower.includes(label) || label.includes(lower);
      const exemplarMatch = Array.isArray(cluster.exemplars) &&
        cluster.exemplars.some((ex: string) => {
          const exLower = ex.toLowerCase();
          return exLower.includes(lower) || lower.includes(exLower);
        });

      if (labelMatch || exemplarMatch) {
        const score = labelMatch ? 1.0 : 0.7;
        if (cluster.kind === "intent" && score > bestIntentScore) {
          bestIntent = cluster.label;
          bestIntentScore = score;
        } else if (cluster.kind === "tag") {
          matchedTags.push(cluster.label);
        }
      }
    }
  } catch {
    // DB unavailable — return with null intent
  }

  return {
    originalText: text,
    interpretedIntent: bestIntent,
    interpretedTags: matchedTags,
    vector: [],
    confidence: bestIntent ? 0.4 : 0.2,
    providersUsed: [],
    degraded: true,
    intentMatches: [],
    tagMatches: [],
  };
}

function buildEmptyQuery(text: string): SemanticQuery {
  return {
    originalText: text,
    interpretedIntent: null,
    interpretedTags: [],
    vector: [],
    confidence: 0,
    providersUsed: [],
    degraded: true,
    intentMatches: [],
    tagMatches: [],
  };
}
