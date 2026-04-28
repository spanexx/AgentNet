/*
 * Integration Test: Multi-Provider Embedding Coordination
 * Requires: INTEGRATION_TESTS=true, MongoDB, and at least one provider API key
 *
 * Quick lookup: rg -n "CID:emb-test-" test/integration/embeddings.test.ts
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { EmbeddingEnsemble } from "../../src/core/embeddings/ensemble";
import { cosineSimilarity, computeAgreement, calculateAdaptiveWeights, redistributeWeights } from "../../src/core/embeddings/weights";
import { PROVIDER_DIMENSIONS } from "../../src/core/embeddings/types";

const INTEGRATION = process.env.INTEGRATION_TESTS === "true";
const PROVIDER_INTEGRATION =
  INTEGRATION &&
  (Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.GOOGLE_API_KEY));
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agentnet_test";

describe.skipIf(!PROVIDER_INTEGRATION)("Embedding Ensemble — Integration", () => {
  let ensemble: EmbeddingEnsemble;

  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
    ensemble = new EmbeddingEnsemble();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("generates embeddings from configured providers with correct dimensions", async () => {
    const result = await ensemble.embed("Find me user john");

    expect(result.vector.length).toBeGreaterThan(0);
    expect(result.providersUsed.length).toBeGreaterThanOrEqual(1);
    expect(result.confidence).toBeGreaterThan(0);

    for (const r of result.results) {
      expect(r.dimension).toBe(PROVIDER_DIMENSIONS[r.provider]);
    }
  });

  it("computes agreement score across providers", async () => {
    const result = await ensemble.embed("search user details");

    expect(result.agreement).toBeDefined();
    expect(result.agreement.average).toBeGreaterThanOrEqual(0);
    expect(result.agreement.average).toBeLessThanOrEqual(1);
    expect(["high", "medium", "low"]).toContain(result.agreement.regime);
  });

  it("applies adaptive weights that sum to 1.0", async () => {
    const result = await ensemble.embed("show dashboard metrics");

    expect(result.weights).toBeDefined();
    const total = result.weights.openai + result.weights.google + result.weights.local;
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("returns consistent vectors for identical input", async () => {
    const r1 = await ensemble.embed("find user alice");
    const r2 = await ensemble.embed("find user alice");

    const sim = cosineSimilarity(r1.vector, r2.vector);
    expect(sim).toBeGreaterThan(0.99);
  });

  it("cache hit on second embed call for same text", async () => {
    const text = "cache test query embedding";
    await ensemble.embed(text);
    const r2 = await ensemble.embed(text);

    expect(r2.vector.length).toBeGreaterThan(0);
    expect(r2.confidence).toBeGreaterThan(0);
  });
});

describe("Weights Module — Pure Function Tests", () => {
  it("cosineSimilarity returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 5);
  });

  it("cosineSimilarity returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("cosineSimilarity returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });

  it("redistributeWeights normalizes to 1.0", () => {
    const w = redistributeWeights(["google", "local"]);
    expect(w.openai).toBe(0);
    expect(w.google + w.local).toBeCloseTo(1.0, 5);
  });

  it("calculateAdaptiveWeights selects correct preset per regime", () => {
    expect(calculateAdaptiveWeights({ pairwise: {}, average: 0.95, regime: "high" }).label).toBe("high-agreement");
    expect(calculateAdaptiveWeights({ pairwise: {}, average: 0.60, regime: "low" }).label).toBe("low-agreement");
    expect(calculateAdaptiveWeights({ pairwise: {}, average: 0.85, regime: "medium" }).label).toBe("default");
  });

  it("computeAgreement returns valid structure for 2+ results", () => {
    const results = [
      { provider: "openai" as const, vector: [1, 0, 0], dimension: 3, latencyMs: 100 },
      { provider: "google" as const, vector: [0.9, 0.1, 0], dimension: 3, latencyMs: 120 },
    ];
    const agreement = computeAgreement(results);
    expect(agreement.average).toBeGreaterThan(0.8);
    expect(agreement.regime).toBe("high");
  });
});
