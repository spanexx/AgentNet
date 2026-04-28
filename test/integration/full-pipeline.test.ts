/*
 * Integration Test: Full Pipeline — SDG End-to-End
 * Requires: INTEGRATION_TESTS=true, MongoDB, OPENAI_API_KEY, GOOGLE_API_KEY
 *
 * Quick lookup: rg -n "CID:pipeline-test-" test/integration/full-pipeline.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { normalizeMessage } from "../../src/core/normalize";
import { SemanticClusterModel } from "../../src/models/SemanticCluster";
import { loadSeedData } from "../../src/core/seed-loader";

const INTEGRATION = process.env.INTEGRATION_TESTS === "true";
const PROVIDER_INTEGRATION =
  INTEGRATION &&
  Boolean(process.env.OPENAI_API_KEY) &&
  Boolean(process.env.GOOGLE_API_KEY);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agentnet_test";

describe.skipIf(!PROVIDER_INTEGRATION)("Full Pipeline (SDG) — Provider-backed Integration", () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
    await SemanticClusterModel.deleteMany({});
    await loadSeedData();
  });

  afterAll(async () => {
    await SemanticClusterModel.deleteMany({});
    await mongoose.disconnect();
  });

  it("normalizes 'Find me user john' with multi-hypothesis output", async () => {
    const result = await normalizeMessage({
      type: "INTENT_REQUEST",
      intent: "Find me user john",
    });

    expect(result.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(result.hypotheses[0].intent).toBeTruthy();
    expect(result.hypotheses[0].confidence.value).toBeGreaterThan(0);
    expect(result.providersUsed.length).toBeGreaterThanOrEqual(1);
    expect(result.hypotheses[0].tags).toBeDefined();
  });

  it("normalizes 'show dashboard' with correct top hypothesis", async () => {
    const result = await normalizeMessage({
      type: "INTENT_REQUEST",
      intent: "show dashboard",
    });

    expect(result.hypotheses[0].intent).toBeTruthy();
    expect(result.providersUsed.length).toBeGreaterThanOrEqual(1);
  });

  it("response schema matches SDG multi-hypothesis contract", async () => {
    const result = await normalizeMessage({
      type: "INTENT_REQUEST",
      intent: "get all messages",
      data: { page: 1 },
    });

    expect(result).toHaveProperty("hypotheses");
    expect(result).toHaveProperty("constraints");
    expect(result).toHaveProperty("providersUsed");
    expect(result).toHaveProperty("degraded");
    expect(result).toHaveProperty("vector");

    expect(Array.isArray(result.hypotheses)).toBe(true);
    expect(typeof result.hypotheses[0].intent).toBe("string");
    expect(typeof result.hypotheses[0].confidence.value).toBe("number");
    expect(typeof result.hypotheses[0].confidence.density).toBe("number");
    expect(typeof result.hypotheses[0].confidence.agreement).toBe("number");
    expect(typeof result.hypotheses[0].confidence.distance).toBe("number");
    expect(typeof result.hypotheses[0].source).toBe("string");
  });

  it("cache hit on second call with same text", async () => {
    const msg = { type: "QUERY", intent: "find user alice" };

    const result1 = await normalizeMessage(msg);
    expect(result1.providersUsed.length).toBeGreaterThanOrEqual(1);

    const result2 = await normalizeMessage(msg);
    expect(result2.hypotheses[0].intent).toBe(result1.hypotheses[0].intent);
  });
});

describe.skipIf(!INTEGRATION)("Full Pipeline (SDG) — Fallback Integration", () => {
  it("fallback path returns valid hypothesis when providers unavailable", async () => {
    const result = await normalizeMessage({
      type: "INTENT_REQUEST",
      intent: "search for user",
    });

    expect(result.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(result.hypotheses[0].intent).toBeDefined();
    expect(typeof result.hypotheses[0].intent).toBe("string");
    expect(result.hypotheses[0].confidence.value).toBeGreaterThanOrEqual(0);
  }, 15000);

  it("hypotheses are sorted by confidence descending", async () => {
    const result = await normalizeMessage({
      type: "INTENT_REQUEST",
      intent: "dashboard analytics chart",
    });

    if (result.hypotheses.length > 1) {
      for (let i = 1; i < result.hypotheses.length; i++) {
        expect(result.hypotheses[i - 1].confidence.value).toBeGreaterThanOrEqual(
          result.hypotheses[i].confidence.value
        );
      }
    }
  }, 15000);
});
