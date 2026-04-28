/*
 * Code Map: Embedding Type Definitions
 * - ProviderName: Union type for supported embedding providers
 * - EmbeddingProvider: Interface every provider must implement
 * - EmbeddingResult: Single provider output with vector + metadata
 * - EnsembleResult: Combined multi-provider output
 * - WeightProfile: Named weight distribution across providers
 * - AgreementScore: Pairwise model agreement metrics
 * - DEFAULT_WEIGHTS / WEIGHT_PRESETS: Standard weight configurations
 *
 * CID Index:
 * CID:emb-types-001 -> ProviderName
 * CID:emb-types-002 -> EmbeddingProvider
 * CID:emb-types-003 -> EmbeddingResult
 * CID:emb-types-004 -> EnsembleResult
 * CID:emb-types-005 -> WeightProfile
 * CID:emb-types-006 -> AgreementScore
 * CID:emb-types-007 -> DEFAULT_WEIGHTS
 * CID:emb-types-008 -> WEIGHT_PRESETS
 *
 * Quick lookup: rg -n "CID:emb-types-" src/core/embeddings/types.ts
 */

// CID:emb-types-001 - ProviderName
// Purpose: Constrain provider identifiers to known set
// Uses: string literal union
// Used by: EmbeddingProvider, EnsembleResult, weights module
export type ProviderName = "openai" | "google" | "local";

// CID:emb-types-002 - EmbeddingProvider
// Purpose: Contract every embedding provider must satisfy
// Uses: ProviderName
// Used by: ensemble.ts, provider implementations
export interface EmbeddingProvider {
  readonly name: ProviderName;
  readonly dimension: number;
  embed(text: string): Promise<EmbeddingResult>;
  isAvailable(): Promise<boolean>;
}

// CID:emb-types-003 - EmbeddingResult
// Purpose: Encapsulate a single provider's embedding output
// Uses: ProviderName
// Used by: EmbeddingProvider implementations, ensemble.ts
export interface EmbeddingResult {
  provider: ProviderName;
  vector: number[];
  dimension: number;
  latencyMs: number;
  error?: string;
}

// CID:emb-types-004 - EnsembleResult
// Purpose: Aggregated output from multi-provider embedding run
// Uses: ProviderName, WeightProfile, AgreementScore
// Used by: normalize.ts, semantic-space engine
export interface EnsembleResult {
  /** Weighted average vector across all successful providers */
  vector: number[];
  /** Dimension of the output vector */
  dimension: number;
  /** Per-provider raw results (only successful ones) */
  results: EmbeddingResult[];
  /** Which providers contributed */
  providersUsed: ProviderName[];
  /** Applied weight distribution */
  weights: WeightProfile;
  /** Pairwise agreement between providers */
  agreement: AgreementScore;
  /** Overall confidence derived from agreement + coverage */
  confidence: number;
  /** True if any provider was skipped due to failure */
  degraded: boolean;
}

// CID:emb-types-005 - WeightProfile
// Purpose: Named weight distribution across providers
// Uses: ProviderName
// Used by: weights.ts, ensemble.ts
export interface WeightProfile {
  label: string;
  openai: number;
  google: number;
  local: number;
}

// CID:emb-types-006 - AgreementScore
// Purpose: Quantify how much the models agree on embedding space
// Uses: ProviderName
// Used by: weights.ts (adaptive recalculation), ensemble.ts
export interface AgreementScore {
  /** Cosine similarity between each provider pair */
  pairwise: Partial<Record<`${ProviderName}_${ProviderName}`, number>>;
  /** Average of all pairwise similarities */
  average: number;
  /** Which agreement regime was detected */
  regime: "high" | "medium" | "low";
}

// CID:emb-types-007 - DEFAULT_WEIGHTS
// Purpose: Baseline 60/30/10 weight distribution (Decision 1)
// Uses: WeightProfile
// Used by: weights.ts, ensemble.ts
export const DEFAULT_WEIGHTS: WeightProfile = {
  label: "default",
  openai: 0.60,
  google: 0.30,
  local: 0.10,
};

// CID:emb-types-008 - WEIGHT_PRESETS
// Purpose: All named weight regimes per Decision 4
// Uses: WeightProfile
// Used by: calculateAdaptiveWeights
export const WEIGHT_PRESETS: Record<string, WeightProfile> = {
  /** High agreement (>0.92): boost best provider */
  high: { label: "high-agreement", openai: 0.70, google: 0.20, local: 0.10 },
  /** Default (0.75–0.92): standard distribution */
  default: DEFAULT_WEIGHTS,
  /** Low agreement (<0.75): equal safety distribution */
  low: { label: "low-agreement", openai: 0.33, google: 0.33, local: 0.34 },
};

/** Known vector dimensions per provider */
export const PROVIDER_DIMENSIONS: Record<ProviderName, number> = {
  openai: 1536,
  google: 768,
  local: 384,
};
