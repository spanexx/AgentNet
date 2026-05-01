import { describe, expect, it } from "vitest";
import {
  computeRankingScore,
  loadSemanticSearchWeights,
  buildReuseScore,
  buildOutcomeScore,
  buildRecencyScore,
  RankingSignals,
} from "../src/core/ranking";

describe("computeRankingScore", () => {
  const weights = loadSemanticSearchWeights();

  it("returns 0 when all signals are zero", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0,
      intentMatch: 0,
      tagOverlap: 0,
      confidence: 0,
      recency: 0,
      reuse: 0,
      outcome: 0,
    };

    expect(computeRankingScore(signals, weights, 1.0)).toBe(0);
  });

  it("boosts score with reputation multiplier", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.9,
      intentMatch: 1,
      tagOverlap: 0.5,
      confidence: 0.8,
      recency: 0.7,
      reuse: 0.3,
      outcome: 0.8,
    };

    const base = computeRankingScore(signals, weights, 1.0);
    const boosted = computeRankingScore(signals, weights, 1.3);

    expect(boosted).toBeGreaterThan(base);
    expect(boosted / base).toBeCloseTo(1.3, 1);
  });

  it("semantic similarity dominates the score when other signals are weak", () => {
    const highSemantic: RankingSignals = {
      semanticSimilarity: 1.0,
      intentMatch: 0,
      tagOverlap: 0,
      confidence: 0,
      recency: 0,
      reuse: 0,
      outcome: 0,
    };

    const highIntent: RankingSignals = {
      semanticSimilarity: 0,
      intentMatch: 1.0,
      tagOverlap: 0,
      confidence: 0,
      recency: 0,
      reuse: 0,
      outcome: 0,
    };

    const scoreSemantic = computeRankingScore(highSemantic, weights, 1.0);
    const scoreIntent = computeRankingScore(highIntent, weights, 1.0);

    // Semantic similarity weight (0.30) > intent weight (0.15)
    expect(scoreSemantic).toBeGreaterThan(scoreIntent);
  });

  it("produces a score between 0 and ~1.3 for typical signal ranges", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.85,
      intentMatch: 1,
      tagOverlap: 0.8,
      confidence: 0.9,
      recency: 0.5,
      reuse: 0.6,
      outcome: 0.8,
    };

    const score = computeRankingScore(signals, weights, 1.3);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.5);
  });
});

describe("loadSemanticSearchWeights", () => {
  it("returns weights that sum to approximately 1", () => {
    const weights = loadSemanticSearchWeights();
    const total =
      weights.semanticSimilarity +
      weights.intent +
      weights.tags +
      weights.confidence +
      weights.recency +
      weights.reuse +
      weights.outcome;

    expect(total).toBeCloseTo(1.0, 2);
  });

  it("gives semantic similarity the highest weight", () => {
    const weights = loadSemanticSearchWeights();
    expect(weights.semanticSimilarity).toBeGreaterThan(weights.intent);
    expect(weights.semanticSimilarity).toBeGreaterThan(weights.tags);
    expect(weights.semanticSimilarity).toBeGreaterThan(weights.outcome);
  });
});

describe("buildReuseScore", () => {
  it("returns 0 for unused solutions", () => {
    expect(buildReuseScore(0, undefined)).toBe(0);
  });

  it("scales logarithmically with usage count", () => {
    const score1 = buildReuseScore(1, undefined);
    const score2 = buildReuseScore(2, undefined);
    const score3 = buildReuseScore(3, undefined);

    expect(score1).toBeGreaterThan(0);
    expect(score2).toBeGreaterThan(score1);
    expect(score3).toBeGreaterThan(score2);
    // Diminishing returns
    expect(score3 - score2).toBeLessThan(score2 - score1);
  });

  it("considers explicit reuse metrics", () => {
    const withMetrics = buildReuseScore(0, { successful_adoptions: 5 });
    const withoutMetrics = buildReuseScore(0, undefined);

    expect(withMetrics).toBeGreaterThan(withoutMetrics);
  });
});

describe("buildOutcomeScore", () => {
  it("scores reused > validated > pending > failed", () => {
    const reused = buildOutcomeScore({ status: "reused", summary: "test" });
    const validated = buildOutcomeScore({ status: "validated", summary: "test" });
    const pending = buildOutcomeScore({ status: "pending", summary: "test" });
    const failed = buildOutcomeScore({ status: "failed", summary: "test" });

    expect(reused).toBeGreaterThan(validated);
    expect(validated).toBeGreaterThan(pending);
    expect(pending).toBeGreaterThan(failed);
  });

  it("boosts outcome score when evidence is present", () => {
    const withEvidence = buildOutcomeScore({
      status: "validated",
      summary: "test",
      evidence: { ticket: "AG-1" },
    });
    const withoutEvidence = buildOutcomeScore({
      status: "validated",
      summary: "test",
    });

    expect(withEvidence).toBeGreaterThan(withoutEvidence);
  });
});

describe("buildRecencyScore", () => {
  it("returns ~1 for solutions created now", () => {
    const score = buildRecencyScore(new Date());
    expect(score).toBeCloseTo(1.0, 1);
  });

  it("returns 0 for solutions older than 30 days", () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(buildRecencyScore(oldDate)).toBe(0);
  });

  it("decays linearly over 30 days", () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const score = buildRecencyScore(fifteenDaysAgo);
    expect(score).toBeCloseTo(0.5, 1);
  });
});
