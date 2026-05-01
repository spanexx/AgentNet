/*
 * Code Map: Semantic Search Ranking Module
 * - computeRankingScore: Combine weighted signals with reputation multiplier
 * - loadSemanticSearchWeights: Load configurable weight distribution
 * - buildReuseScore: Score reuse evidence logarithmically
 * - buildOutcomeScore: Score outcome status with evidence/metric boosts
 *
 * CID Index:
 * CID:ranking-001 -> computeRankingScore
 * CID:ranking-002 -> loadSemanticSearchWeights
 * CID:ranking-003 -> buildReuseScore
 * CID:ranking-004 -> buildOutcomeScore
 *
 * Quick lookup: rg -n "CID:ranking-" src/core/ranking.ts
 */

import { SolutionOutcome, SolutionOutcomeStatus } from "../types/protocol";

/**
 * Raw ranking signals for a single result.
 * Each signal is normalized to 0–1 range.
 */
export interface RankingSignals {
  /** Cosine similarity between query vector and solution embedding */
  semanticSimilarity: number;
  /** 1.0 if interpreted intent matches solution intent, 0 otherwise */
  intentMatch: number;
  /** Fraction of query tags that overlap with solution tags (0–1) */
  tagOverlap: number;
  /** Normalization confidence from the stored solution's origin (0–1) */
  confidence: number;
  /** Time-decay signal — newer solutions score higher (0–1) */
  recency: number;
  /** Reuse evidence score (0–1) */
  reuse: number;
  /** Outcome quality score (0–1) */
  outcome: number;
}

/**
 * Weight distribution across ranking signals.
 */
export interface RankingWeights {
  semanticSimilarity: number;
  intent: number;
  tags: number;
  confidence: number;
  recency: number;
  reuse: number;
  outcome: number;
}

// CID:ranking-001 - computeRankingScore
// Purpose: Weighted sum of normalized signals, boosted by agent reputation
// Uses: RankingSignals, RankingWeights
// Used by: solution-retrieval, searchMessages
export function computeRankingScore(
  signals: RankingSignals,
  weights: RankingWeights,
  reputationMultiplier: number
): number {
  const baseScore =
    weights.semanticSimilarity * signals.semanticSimilarity +
    weights.intent * signals.intentMatch +
    weights.tags * signals.tagOverlap +
    weights.confidence * signals.confidence +
    weights.recency * signals.recency +
    weights.reuse * signals.reuse +
    weights.outcome * signals.outcome;

  return baseScore * reputationMultiplier;
}

// CID:ranking-002 - loadSemanticSearchWeights
// Purpose: Load configurable weight distribution for semantic search ranking
// Uses: Environment variables with defaults
// Used by: solution-retrieval
export function loadSemanticSearchWeights(): RankingWeights {
  const defaults: RankingWeights = {
    semanticSimilarity: 0.30,
    intent: 0.15,
    tags: 0.10,
    confidence: 0.12,
    recency: 0.08,
    reuse: 0.12,
    outcome: 0.13,
  };

  const configured: RankingWeights = {
    semanticSimilarity: parseWeight(process.env.SEMANTIC_WEIGHT_SIMILARITY, defaults.semanticSimilarity),
    intent: parseWeight(process.env.SEMANTIC_WEIGHT_INTENT, defaults.intent),
    tags: parseWeight(process.env.SEMANTIC_WEIGHT_TAGS, defaults.tags),
    confidence: parseWeight(process.env.SEMANTIC_WEIGHT_CONFIDENCE, defaults.confidence),
    recency: parseWeight(process.env.SEMANTIC_WEIGHT_RECENCY, defaults.recency),
    reuse: parseWeight(process.env.SEMANTIC_WEIGHT_REUSE, defaults.reuse),
    outcome: parseWeight(process.env.SEMANTIC_WEIGHT_OUTCOME, defaults.outcome),
  };

  const total =
    configured.semanticSimilarity +
    configured.intent +
    configured.tags +
    configured.confidence +
    configured.recency +
    configured.reuse +
    configured.outcome;

  if (total <= 0) return defaults;

  return {
    semanticSimilarity: configured.semanticSimilarity / total,
    intent: configured.intent / total,
    tags: configured.tags / total,
    confidence: configured.confidence / total,
    recency: configured.recency / total,
    reuse: configured.reuse / total,
    outcome: configured.outcome / total,
  };
}

// CID:ranking-003 - buildReuseScore
// Purpose: Score reuse evidence using logarithmic scaling (diminishing returns)
// Uses: Math.log1p
// Used by: solution-retrieval
export function buildReuseScore(
  usageCount: number,
  metrics: SolutionOutcome["metrics"] | undefined
): number {
  const explicitReuseCount = Math.max(
    0,
    getMetricNumber(metrics, "successful_adoptions"),
    getMetricNumber(metrics, "reuse_count"),
    getMetricNumber(metrics, "reused_count")
  );
  const combinedReuse = Math.max(0, usageCount) + explicitReuseCount;

  if (combinedReuse <= 0) return 0;

  return Math.min(1, Math.log1p(combinedReuse) / Math.log(6));
}

// CID:ranking-004 - buildOutcomeScore
// Purpose: Score outcome status with evidence and metric boosts
// Uses: SolutionOutcome
// Used by: solution-retrieval
export function buildOutcomeScore(outcome: SolutionOutcome): number {
  const statusScores: Record<SolutionOutcomeStatus, number> = {
    failed: 0,
    pending: 0.25,
    validated: 0.8,
    reused: 1,
  };

  const base = statusScores[outcome.status] ?? statusScores.pending;
  const evidenceBoost = outcome.evidence && Object.keys(outcome.evidence).length > 0 ? 0.05 : 0;
  const metricBoost = outcome.metrics && Object.keys(outcome.metrics).length > 0 ? 0.05 : 0;

  return Math.min(1, base + evidenceBoost + metricBoost);
}

/**
 * Compute recency signal from a timestamp. Decays linearly over 30 days.
 */
export function buildRecencyScore(createdAt: Date | string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, 1 - ageMs / (1000 * 60 * 60 * 24 * 30));
}

function parseWeight(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getMetricNumber(
  metrics: SolutionOutcome["metrics"] | undefined,
  key: string
): number {
  if (!metrics) return 0;
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
