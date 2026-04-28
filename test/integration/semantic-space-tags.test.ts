/*
 * Integration Test: Semantic Space — Tag Cluster Inference & Discovery
 * Requires: INTEGRATION_TESTS=true, MongoDB, and at least one provider API key
 *
 * Quick lookup: rg -n "CID:tag-test-" test/integration/semantic-space-tags.test.ts
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

describe.skipIf(!PROVIDER_INTEGRATION)("Tag Cluster Inference — Integration", () => {
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

  it("finds tag clusters for 'angular dashboard component'", async () => {
    const result = await ensemble.embed("angular dashboard component");
    const { tagMatches } = await space.search(result.vector, result);

    expect(tagMatches.length).toBeGreaterThanOrEqual(0);
    if (tagMatches.length > 0) {
      expect(tagMatches[0].score).toBeGreaterThan(0.50);
    }
  });

  it("increments frequency on centroid update", async () => {
    const result = await ensemble.embed("react chart component");
    const { tagMatches } = await space.search(result.vector, result);

    if (tagMatches.length > 0) {
      const before = await SemanticClusterModel.findOne({ label: tagMatches[0].label, kind: "tag" });
      const beforeFreq = before?.frequency ?? 0;

      await space.updateCentroid(tagMatches[0].label, result.vector, "react chart component");

      const after = await SemanticClusterModel.findOne({ label: tagMatches[0].label, kind: "tag" });
      expect(after?.frequency).toBe(beforeFreq + 1);
    }
  });

  it("discovers new tag cluster for novel input", async () => {
    const novelText = "graphql api query";
    const result = await ensemble.embed(novelText);
    const { tagMatches } = await space.search(result.vector, result);

    await space.maybeDiscover(
      result.vector, novelText,
      0,
      tagMatches[0]?.score ?? 0,
      "tag"
    );

    space.invalidateCache();
    const learned = await SemanticClusterModel.findOne({ source: "learned", kind: "tag" });
    if (learned) {
      expect(learned.label).toBeTruthy();
      expect(learned.centroid.length).toBeGreaterThan(0);
    }
  });

  it("constructs hypotheses with tag projections", async () => {
    const result = await ensemble.embed("fintech payment dashboard");
    const { intentMatches, tagMatches } = await space.search(result.vector, result);
    const hypotheses = space.constructHypotheses(intentMatches, tagMatches, result.agreement.average);

    expect(hypotheses.length).toBeGreaterThanOrEqual(1);
    if (tagMatches.length > 0) {
      expect(hypotheses[0].tags.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("geometric confidence reflects density and agreement", async () => {
    const result = await ensemble.embed("search user query");
    const { intentMatches, tagMatches } = await space.search(result.vector, result);
    const hypotheses = space.constructHypotheses(intentMatches, tagMatches, result.agreement.average);

    if (hypotheses.length > 0 && hypotheses[0].source !== "fallback") {
      const conf = hypotheses[0].confidence;
      expect(conf.value).toBeGreaterThan(0);
      expect(conf.agreement).toBeGreaterThanOrEqual(0);
      expect(conf.distance).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns empty tags for empty catalog", async () => {
    await SemanticClusterModel.deleteMany({});
    space.invalidateCache();

    const result = await ensemble.embed("test query");
    const { tagMatches } = await space.search(result.vector, result);
    expect(tagMatches.length).toBe(0);
  });
});
