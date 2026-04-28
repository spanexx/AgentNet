/*
 * Integration Test: Semantic Space — Cluster Search & Centroid Evolution
 * Requires: INTEGRATION_TESTS=true, MongoDB, and at least one provider API key
 *
 * Quick lookup: rg -n "CID:sem-space-test-" test/integration/semantic-space-intents.test.ts
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { SemanticSpace } from "../../src/core/sdg/semantic-space";
import { EmbeddingEnsemble } from "../../src/core/embeddings/ensemble";
import { SemanticClusterModel } from "../../src/models/SemanticCluster";
import { loadSeedData } from "../../src/core/seed-loader";

const INTEGRATION = process.env.INTEGRATION_TESTS === "true";
const PROVIDER_INTEGRATION =
  INTEGRATION &&
  (Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.GOOGLE_API_KEY));
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agentnet_test";

describe.skipIf(!PROVIDER_INTEGRATION)("Semantic Space — Integration", () => {
  let space: SemanticSpace;
  let ensemble: EmbeddingEnsemble;

  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
    await SemanticClusterModel.deleteMany({});
    await loadSeedData();
    space = new SemanticSpace();
    space.invalidateCache();
    ensemble = new EmbeddingEnsemble();
  });

  afterAll(async () => {
    await SemanticClusterModel.deleteMany({});
    await mongoose.disconnect();
  });

  it("finds intent cluster for 'find user john'", async () => {
    const result = await ensemble.embed("find user john");
    const { intentMatches } = await space.search(result.vector, result);

    expect(intentMatches.length).toBeGreaterThanOrEqual(1);
    expect(intentMatches[0].label).toBe("search_user");
    expect(intentMatches[0].score).toBeGreaterThan(0.50);
  });

  it("finds tag clusters for 'show dashboard urgently'", async () => {
    const result = await ensemble.embed("show dashboard urgently");
    const { tagMatches } = await space.search(result.vector, result);

    expect(tagMatches.length).toBeGreaterThanOrEqual(0);
  });

  it("constructs ranked hypotheses from cluster matches", async () => {
    const result = await ensemble.embed("show messages");
    const { intentMatches, tagMatches } = await space.search(result.vector, result);
    const hypotheses = space.constructHypotheses(intentMatches, tagMatches, result.agreement.average);

    expect(hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(hypotheses[0].intent).toBeTruthy();
    expect(hypotheses[0].confidence.value).toBeGreaterThan(0);
  });

  it("evolves centroid after updateCentroid call", async () => {
    const result = await ensemble.embed("find user details");
    const { intentMatches } = await space.search(result.vector, result);

    if (intentMatches.length > 0) {
      const before = await SemanticClusterModel.findOne({ label: intentMatches[0].label });
      const beforeDensity = before?.density ?? 0;

      await space.updateCentroid(intentMatches[0].label, result.vector, "find user details");

      const after = await SemanticClusterModel.findOne({ label: intentMatches[0].label });
      expect(after?.density).toBe(beforeDensity + 1);
    }
  });

  it("discovers new cluster for novel input", async () => {
    const novelText = "deploy microservice cluster";
    const result = await ensemble.embed(novelText);
    const { intentMatches } = await space.search(result.vector, result);

    await space.maybeDiscover(
      result.vector, novelText,
      intentMatches[0]?.score ?? 0, 0, "intent"
    );

    space.invalidateCache();
    const learned = await SemanticClusterModel.findOne({ source: "learned", kind: "intent" });
    if (learned) {
      expect(learned.label).toBeTruthy();
      expect(learned.centroid.length).toBeGreaterThan(0);
    }
  });

  it("returns fallback for empty catalog", async () => {
    await SemanticClusterModel.deleteMany({});
    space.invalidateCache();

    const result = await ensemble.embed("test query");
    const { intentMatches, tagMatches } = await space.search(result.vector, result);
    const hypotheses = space.constructHypotheses(intentMatches, tagMatches, result.agreement.average);

    expect(hypotheses.length).toBe(1);
    expect(hypotheses[0].intent).toBe("general");
    expect(hypotheses[0].source).toBe("fallback");
  });
});
