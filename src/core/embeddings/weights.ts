/*
 * Code Map: Adaptive Weight Calculator
 * - cosineSimilarity: Computes cosine similarity between two vectors
 * - computeAgreement: Calculates pairwise agreement across providers
 * - calculateAdaptiveWeights: Adjusts weights based on model agreement (Decision 4)
 * - redistributeWeights: Recalculates weights when providers fail (Decision 5)
 *
 * CID Index:
 * CID:emb-weights-001 -> cosineSimilarity
 * CID:emb-weights-002 -> computeAgreement
 * CID:emb-weights-003 -> calculateAdaptiveWeights
 * CID:emb-weights-004 -> redistributeWeights
 *
 * Quick lookup: rg -n "CID:emb-weights-" src/core/embeddings/weights.ts
 */

import {
  ProviderName,
  EmbeddingResult,
  AgreementScore,
  WeightProfile,
  WEIGHT_PRESETS,
  DEFAULT_WEIGHTS,
} from "./types";

// CID:emb-weights-001 - cosineSimilarity
// Purpose: Compute cosine similarity between two equal-length vectors
// Uses: Math operations
// Used by: computeAgreement, semantic-space engine
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// CID:emb-weights-002 - computeAgreement
// Purpose: Calculate pairwise cosine similarities between all successful provider results
// Uses: cosineSimilarity
// Used by: ensemble.ts
export function computeAgreement(results: EmbeddingResult[]): AgreementScore {
  const pairwise: AgreementScore["pairwise"] = {};
  const pairs: Array<[ProviderName, ProviderName]> = [
    ["openai", "google"],
    ["openai", "local"],
    ["google", "local"],
  ];

  const byProvider = new Map<ProviderName, number[]>();
  for (const r of results) {
    if (r.vector.length > 0) byProvider.set(r.provider, r.vector);
  }

  const sims: number[] = [];
  for (const [a, b] of pairs) {
    const va = byProvider.get(a);
    const vb = byProvider.get(b);
    if (va && vb) {
      const sim = cosineSimilarity(va, vb);
      const key = `${a}_${b}` as const;
      pairwise[key] = sim;
      sims.push(sim);
    }
  }

  const average = sims.length > 0 ? sims.reduce((s, v) => s + v, 0) / sims.length : 0;

  let regime: AgreementScore["regime"];
  if (average > 0.92) regime = "high";
  else if (average < 0.75) regime = "low";
  else regime = "medium";

  return { pairwise, average, regime };
}

// CID:emb-weights-003 - calculateAdaptiveWeights
// Purpose: Select weight preset based on agreement regime (Decision 4)
// Uses: WEIGHT_PRESETS, computeAgreement
// Used by: ensemble.ts
export function calculateAdaptiveWeights(agreement: AgreementScore): WeightProfile {
  switch (agreement.regime) {
    case "high":
      return WEIGHT_PRESETS.high;
    case "low":
      return WEIGHT_PRESETS.low;
    default:
      return WEIGHT_PRESETS.default;
  }
}

// CID:emb-weights-004 - redistributeWeights
// Purpose: Recalculate weights when one or more providers fail (Decision 5)
// Uses: DEFAULT_WEIGHTS
// Used by: ensemble.ts (fallback path)
export function redistributeWeights(
  availableProviders: ProviderName[]
): WeightProfile {
  const w = { ...DEFAULT_WEIGHTS };
  const totalAvailable = availableProviders.reduce((sum, p) => sum + w[p], 0);

  if (totalAvailable === 0) {
    // Last resort: equal distribution among whatever is left
    const eq = 1 / availableProviders.length;
    const profile: WeightProfile = { label: "emergency", openai: 0, google: 0, local: 0 };
    for (const p of availableProviders) profile[p] = eq;
    return profile;
  }

  // Proportional redistribution
  const profile: WeightProfile = { label: "fallback", openai: 0, google: 0, local: 0 };
  for (const p of availableProviders) {
    profile[p] = w[p] / totalAvailable;
  }
  return profile;
}
