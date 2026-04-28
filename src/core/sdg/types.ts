/*
 * Code Map: Semantic Decision Graph Types
 * - SemanticHypothesis: Single ranked interpretation of input
 * - SemanticResult: Multi-hypothesis output from the SDG pipeline
 * - ClusterMatch: A cluster similarity hit from the semantic space
 * - GeometricConfidence: Confidence derived from spatial properties, not averaging
 *
 * CID Index:
 * CID:sdg-types-001 -> SemanticHypothesis
 * CID:sdg-types-002 -> SemanticResult
 * CID:sdg-types-003 -> ClusterMatch
 * CID:sdg-types-004 -> GeometricConfidence
 *
 * Quick lookup: rg -n "CID:sdg-types-" src/core/sdg/types.ts
 */

import { ProviderName } from "../embeddings/types";

// CID:sdg-types-001 - SemanticHypothesis
// Purpose: A single ranked interpretation of the input message
// Uses: GeometricConfidence
// Used by: SemanticResult, API response
export interface SemanticHypothesis {
  /** Best-matching cluster label (intent) */
  intent: string;
  /** Tags projected from the same semantic space */
  tags: string[];
  /** Geometric confidence — not averaged, derived from spatial properties */
  confidence: GeometricConfidence;
  /** Where this hypothesis came from */
  source: "seed" | "learned" | "fallback";
}

// CID:sdg-types-002 - SemanticResult
// Purpose: Multi-hypothesis output — the system is probabilistic, not deterministic
// Uses: SemanticHypothesis, ProviderName
// Used by: normalizeMessage, API response
export interface SemanticResult {
  /** Ranked hypotheses (top-K), sorted by confidence descending */
  hypotheses: SemanticHypothesis[];
  /** Constraints extracted from the input (separate layer) */
  constraints: Record<string, unknown>;
  /** Which embedding providers contributed to the vector */
  providersUsed: ProviderName[];
  /** True if any provider was skipped */
  degraded: boolean;
  /** The ensemble vector that produced these hypotheses */
  vector: number[];
}

// CID:sdg-types-003 - ClusterMatch
// Purpose: Raw similarity hit from the semantic space (before hypothesis construction)
// Uses: none
// Used by: SemanticSpace.search
export interface ClusterMatch {
  /** Cluster label */
  label: string;
  /** Cosine similarity to cluster centroid */
  score: number;
  /** Number of points in the cluster (density) */
  density: number;
  /** Source of the cluster */
  source: "seed" | "learned";
}

// CID:sdg-types-004 - GeometricConfidence
// Purpose: Confidence derived from spatial properties of the semantic space
// Uses: none
// Used by: SemanticHypothesis
export interface GeometricConfidence {
  /** Overall confidence value (0–1) */
  value: number;
  /** Cluster density — how many messages belong to this cluster */
  density: number;
  /** Provider agreement — how much the embedding models agree */
  agreement: number;
  /** Distance to centroid — how close the input is to the cluster center */
  distance: number;
}

/** Default number of hypotheses to return */
export const DEFAULT_TOP_K = 3;

/** Minimum cluster density to consider a cluster "established" */
export const MIN_CLUSTER_DENSITY = 2;

/** Minimum similarity score to include a hypothesis */
export const MIN_HYPOTHESIS_SCORE = 0.50;
