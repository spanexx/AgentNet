import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MessageModel } from "../../src/models/Message";
import { SolutionModel } from "../../src/models/Solution";
import {
  getAllSolutions,
  markMessageUsed,
  searchMessages,
  storeMessage,
  updateMessageOutcome,
} from "../../src/api/services/messageService";

const INTEGRATION = process.env.INTEGRATION_TESTS === "true";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agentnet_test";

async function createSearchFixture(options: {
  intent: string;
  tags: string[];
  confidence?: number;
  outcomeStatus?: "pending" | "validated" | "reused" | "failed";
  outcomeSummary?: string;
  outcomeMetrics?: Record<string, number>;
  usageCount?: number;
  createdAt?: Date;
}) {
  const createdAt = options.createdAt ?? new Date("2026-04-01T00:00:00.000Z");

  return MessageModel.create({
    original: { type: "INTENT_REQUEST", intent: options.intent },
    normalized: {
      hypotheses: [
        {
          intent: options.intent,
          tags: options.tags,
          confidence: {
            value: options.confidence ?? 0.9,
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
    solution: {
      problem: options.intent,
      approach: "Pattern library",
      variant: options.tags.join(", "),
      outcome: {
        status: options.outcomeStatus ?? "pending",
        summary: options.outcomeSummary ?? "Fixture outcome",
        metrics: options.outcomeMetrics,
      },
    },
    usageCount: options.usageCount ?? 0,
    agentId: "ranking-fixture",
    source: "api",
    createdAt,
    updatedAt: createdAt,
  });
}

describe.skipIf(!INTEGRATION)("Search Usage Tracking — Integration", () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO_URI);
  });

  beforeEach(async () => {
    await MessageModel.deleteMany({});
    await SolutionModel.deleteMany({});
  });

  afterAll(async () => {
    await MessageModel.deleteMany({});
    await SolutionModel.deleteMany({});
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

  it("rolls back usage updates when a linked solution id is malformed", async () => {
    const messageId = new mongoose.Types.ObjectId();
    const createdAt = new Date("2026-04-01T00:00:00.000Z");

    await MessageModel.collection.insertOne({
      _id: messageId,
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
      solution: {
        problem: "show dashboard",
        approach: "Frontend Dashboard",
        variant: "dashboard",
        outcome: {
          status: "pending",
          summary: "Awaiting validation or reuse feedback",
        },
      },
      solutionId: "not-an-objectid",
      usageCount: 0,
      agentId: "tester",
      source: "api",
      createdAt,
      updatedAt: createdAt,
      __v: 0,
    });

    await expect(markMessageUsed(String(messageId))).rejects.toThrow(
      "Invalid linked solution ID format"
    );

    const reloaded = await MessageModel.collection.findOne({ _id: messageId });
    expect(reloaded?.usageCount).toBe(0);
    expect(reloaded?.lastUsedAt).toBeUndefined();
  });

  it("syncs explicit usage tracking into the dedicated solution store", async () => {
    const stored = await storeMessage({
      agentId: "architect",
      text: "build an angular analytics dashboard",
      solution: {
        problem: "Angular analytics dashboard for heavy datasets",
        approach: "Modular widget dashboard",
        variant: "Angular + lazy-loaded widgets",
      },
    });

    const used = await markMessageUsed(stored.id);

    expect(used.usageCount).toBe(1);

    const solutionDoc = await SolutionModel.findById(stored.solutionId).lean();
    expect(solutionDoc?.usageCount).toBe(1);
    expect(solutionDoc?.lastUsedAt).toBeInstanceOf(Date);
  }, 15000);

  it("persists a reusable solution record alongside normalized message data", async () => {
    const stored = await storeMessage({
      agentId: "architect",
      text: "build an angular analytics dashboard",
      solution: {
        problem: "Angular analytics dashboard for heavy datasets",
        approach: "Modular widget dashboard",
        variant: "Angular + lazy-loaded widgets",
        outcome: {
          status: "validated",
          summary: "Reduced initial render time in staging",
          metrics: { load_time_reduction_pct: 40 },
        },
      },
    });

    expect(stored.solution.problem).toBe("Angular analytics dashboard for heavy datasets");
    expect(stored.solution.approach).toBe("Modular widget dashboard");
    expect(stored.solution.variant).toBe("Angular + lazy-loaded widgets");
    expect(stored.solution.outcome.status).toBe("validated");
    expect(stored.solutionId).toBeDefined();

    const persisted = await MessageModel.findById(stored.id).lean();
    expect(persisted?.solution).toBeDefined();
    expect(String(persisted?.solutionId)).toBe(stored.solutionId);
    expect(persisted?.solution?.problem).toBe(stored.solution.problem);
    expect(persisted?.solution?.outcome?.summary).toBe(stored.solution.outcome.summary);

    const solutionDoc = await SolutionModel.findById(stored.solutionId).lean();
    expect(solutionDoc).toBeDefined();
    expect(solutionDoc?.problem).toBe(stored.solution.problem);
    expect(solutionDoc?.approach).toBe(stored.solution.approach);
    expect(solutionDoc?.sourceMessageIds).toHaveLength(1);
  }, 15000);

  it("updates an existing solution outcome without losing the reusable solution fields", async () => {
    const stored = await storeMessage({
      agentId: "architect",
      text: "build an angular analytics dashboard",
      solution: {
        problem: "Angular analytics dashboard for heavy datasets",
        approach: "Modular widget dashboard",
        variant: "Angular + lazy-loaded widgets",
      },
    });

    const updated = await updateMessageOutcome(stored.id, {
      status: "validated",
      summary: "Validated in staging against heavy dashboard traffic",
      metrics: { load_time_reduction_pct: 40 },
      evidence: { environment: "staging" },
    });

    expect(updated.solution.problem).toBe("Angular analytics dashboard for heavy datasets");
    expect(updated.solution.approach).toBe("Modular widget dashboard");
    expect(updated.solution.variant).toBe("Angular + lazy-loaded widgets");
    expect(updated.solution.outcome.status).toBe("validated");
    expect(updated.solution.outcome.summary).toBe(
      "Validated in staging against heavy dashboard traffic"
    );

    const persisted = await MessageModel.findById(stored.id).lean();
    expect(String(persisted?.solutionId)).toBe(stored.solutionId);
    expect(persisted?.solution?.problem).toBe("Angular analytics dashboard for heavy datasets");
    expect(persisted?.solution?.approach).toBe("Modular widget dashboard");
    expect(persisted?.solution?.variant).toBe("Angular + lazy-loaded widgets");
    expect(persisted?.solution?.outcome?.status).toBe("validated");
    expect(persisted?.solution?.outcome?.metrics).toEqual({ load_time_reduction_pct: 40 });

    const solutionDoc = await SolutionModel.findById(stored.solutionId).lean();
    expect(solutionDoc?.outcome?.status).toBe("validated");
    expect(solutionDoc?.outcome?.metrics).toEqual({ load_time_reduction_pct: 40 });
  }, 15000);

  it("supports status-only outcome patches by validating the merged outcome", async () => {
    const stored = await storeMessage({
      agentId: "architect",
      text: "build an angular analytics dashboard",
      solution: {
        problem: "Angular analytics dashboard for heavy datasets",
        approach: "Modular widget dashboard",
        variant: "Angular + lazy-loaded widgets",
      },
    });

    const updated = await updateMessageOutcome(stored.id, {
      status: "validated",
    });

    expect(updated.solution.outcome.status).toBe("validated");
    expect(updated.solution.outcome.summary).toBe("Awaiting validation or reuse feedback");
  }, 15000);

  it("rolls back outcome updates when a linked solution id is malformed", async () => {
    const messageId = new mongoose.Types.ObjectId();
    const createdAt = new Date("2026-04-01T00:00:00.000Z");

    await MessageModel.collection.insertOne({
      _id: messageId,
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
      solution: {
        problem: "show dashboard",
        approach: "Frontend Dashboard",
        variant: "dashboard",
        outcome: {
          status: "pending",
          summary: "Awaiting validation or reuse feedback",
        },
      },
      solutionId: "not-an-objectid",
      usageCount: 0,
      agentId: "tester",
      source: "api",
      createdAt,
      updatedAt: createdAt,
      __v: 0,
    });

    await expect(
      updateMessageOutcome(String(messageId), {
        status: "validated",
      })
    ).rejects.toThrow("Invalid linked solution ID format");

    const reloaded = await MessageModel.collection.findOne({ _id: messageId });
    expect(reloaded?.solution?.outcome?.status).toBe("pending");
    expect(reloaded?.solution?.outcome?.summary).toBe("Awaiting validation or reuse feedback");
  });

  it("surfaces updated outcome data through search results", async () => {
    const stored = await storeMessage({
      agentId: "architect",
      text: "angular dashboard search optimization",
      solution: {
        problem: "Slow dashboard search",
        approach: "Precomputed search index",
        variant: "Angular + cached filters",
      },
    });

    await updateMessageOutcome(stored.id, {
      status: "reused",
      summary: "Adopted by another agent for dashboard retrieval",
      metrics: { successful_adoptions: 1 },
    });

    const result = await searchMessages({ limit: 10 });
    const match = result.results.find((item) => item.id === stored.id);

    expect(match).toBeDefined();
    expect(match?.solution.outcome.status).toBe("reused");
    expect(match?.solution.outcome.summary).toBe(
      "Adopted by another agent for dashboard retrieval"
    );
    expect(match?.solution.outcome.metrics).toEqual({ successful_adoptions: 1 });
  }, 15000);

  it("lists reusable solutions independently from raw messages", async () => {
    const stored = await storeMessage({
      agentId: "architect",
      text: "build an angular analytics dashboard",
      solution: {
        problem: "Angular analytics dashboard for heavy datasets",
        approach: "Modular widget dashboard",
        variant: "Angular + lazy-loaded widgets",
      },
    });

    const result = await getAllSolutions({
      agentId: "architect",
      limit: 10,
    });

    expect(result.total).toBe(1);
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0].id).toBe(stored.solutionId);
    expect(result.solutions[0].problem).toBe("Angular analytics dashboard for heavy datasets");
    expect(result.solutions[0].messageCount).toBe(1);
    expect(result.solutions[0].agentId).toBe("architect");
  }, 15000);

  it("ranks validated solutions above pending ones when semantic match is equal", async () => {
    const createdAt = new Date("2026-04-01T00:00:00.000Z");
    const pending = await createSearchFixture({
      intent: "frontend_dashboard",
      tags: ["dashboard", "angular"],
      outcomeStatus: "pending",
      createdAt,
    });
    const validated = await createSearchFixture({
      intent: "frontend_dashboard",
      tags: ["dashboard", "angular"],
      outcomeStatus: "validated",
      createdAt,
    });

    const result = await searchMessages({
      intent: "frontend_dashboard",
      tags: ["dashboard", "angular"],
      limit: 10,
    });

    expect(result.results[0]?.id).toBe(String(validated._id));
    expect(result.results[1]?.id).toBe(String(pending._id));
  });

  it("ranks heavily reused solutions above lightly reused ones", async () => {
    const createdAt = new Date("2026-04-01T00:00:00.000Z");
    const lightReuse = await createSearchFixture({
      intent: "retrieval",
      tags: ["search", "cache"],
      outcomeStatus: "validated",
      usageCount: 1,
      createdAt,
    });
    const heavyReuse = await createSearchFixture({
      intent: "retrieval",
      tags: ["search", "cache"],
      outcomeStatus: "validated",
      usageCount: 5,
      createdAt,
    });

    const result = await searchMessages({
      intent: "retrieval",
      tags: ["search", "cache"],
      limit: 10,
    });

    expect(result.results[0]?.id).toBe(String(heavyReuse._id));
    expect(result.results[1]?.id).toBe(String(lightReuse._id));
  });

  it("demotes failed solutions even when they are newer", async () => {
    const failed = await createSearchFixture({
      intent: "frontend_dashboard",
      tags: ["dashboard"],
      outcomeStatus: "failed",
      createdAt: new Date(),
    });
    const validated = await createSearchFixture({
      intent: "frontend_dashboard",
      tags: ["dashboard"],
      outcomeStatus: "validated",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const result = await searchMessages({
      intent: "frontend_dashboard",
      tags: ["dashboard"],
      limit: 10,
    });

    expect(result.results[0]?.id).toBe(String(validated._id));
    expect(result.results[1]?.id).toBe(String(failed._id));
  });
});
