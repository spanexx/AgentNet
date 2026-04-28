import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MessageModel } from "../../src/models/Message";
import { markMessageUsed, searchMessages } from "../../src/api/services/messageService";

const INTEGRATION = process.env.INTEGRATION_TESTS === "true";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agentnet_test";

describe.skipIf(!INTEGRATION)("Search Usage Tracking — Integration", () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
  });

  beforeEach(async () => {
    await MessageModel.deleteMany({});
  });

  afterAll(async () => {
    await MessageModel.deleteMany({});
    await mongoose.disconnect();
  });

  it("does not increment usageCount for search impressions", async () => {
    const doc = await MessageModel.create({
      original: { type: "INTENT_REQUEST", intent: "search user alice" },
      normalized: {
        hypotheses: [
          {
            intent: "search_user",
            tags: ["user", "search"],
            confidence: {
              value: 0.9,
              density: 0.8,
              agreement: 1,
              distance: 0.1,
            },
            source: "seed",
          },
        ],
        constraints: {},
        providersUsed: ["google"],
        degraded: false,
      },
      usageCount: 0,
      agentId: "tester",
      source: "api",
    });

    const result = await searchMessages({ intent: "search_user" });
    expect(result.results).toHaveLength(1);

    const reloaded = await MessageModel.findById(doc._id).lean();
    expect(reloaded?.usageCount).toBe(0);
    expect(reloaded?.lastUsedAt).toBeUndefined();
  });

  it("increments usageCount only when usage is explicitly confirmed", async () => {
    const doc = await MessageModel.create({
      original: { type: "INTENT_REQUEST", intent: "show dashboard" },
      normalized: {
        hypotheses: [
          {
            intent: "frontend_dashboard",
            tags: ["dashboard"],
            confidence: {
              value: 0.85,
              density: 0.7,
              agreement: 1,
              distance: 0.15,
            },
            source: "seed",
          },
        ],
        constraints: {},
        providersUsed: ["google"],
        degraded: false,
      },
      usageCount: 2,
      agentId: "tester",
      source: "api",
    });

    const used = await markMessageUsed(String(doc._id));
    expect(used.id).toBe(String(doc._id));
    expect(used.usageCount).toBe(3);

    const reloaded = await MessageModel.findById(doc._id).lean();
    expect(reloaded?.usageCount).toBe(3);
    expect(reloaded?.lastUsedAt).toBeInstanceOf(Date);
  });
});
