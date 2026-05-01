import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as normalizeModule from "../src/core/normalize";
import {
  buildAgentReputation,
  buildSearchSummary,
  buildSolutionRecord,
  storeMessage,
  updateMessageOutcome,
} from "../src/api/services/messageService";

describe("buildSolutionRecord", () => {
  it("derives a reusable solution record from normalized hypotheses", () => {
    const record = buildSolutionRecord(
      {
        type: "INTENT_REQUEST",
        intent: "build a fintech dashboard with charts",
      },
      {
        hypotheses: [
          {
            intent: "frontend_dashboard",
            tags: ["angular", "dashboard", "charts"],
            confidence: {
              value: 0.91,
              density: 0.8,
              agreement: 1,
              distance: 0.09,
            },
            source: "seed",
          },
        ],
      }
    );

    expect(record.problem).toBe("build a fintech dashboard with charts");
    expect(record.approach).toBe("Frontend Dashboard");
    expect(record.variant).toBe("angular, dashboard, charts");
    expect(record.outcome.status).toBe("pending");
    expect(record.outcome.summary).toBe("Awaiting validation or reuse feedback");
  });

  it("prefers explicit solution fields when callers provide them", () => {
    const record = buildSolutionRecord(
      {
        type: "FEEDBACK",
        intent: "dashboard feedback",
        solution: {
          problem: "Data-heavy dashboard search latency",
          approach: "Precomputed search index",
          variant: "Redis-backed cache",
          outcome: {
            status: "reused",
            summary: "Adopted by two internal agents",
            metrics: { successful_adoptions: 2 },
            evidence: { ticket: "AG-42" },
          },
        },
      },
      {
        hypotheses: [
          {
            intent: "retrieval",
            tags: ["search"],
            confidence: {
              value: 0.7,
              density: 0.4,
              agreement: 0.9,
              distance: 0.2,
            },
            source: "seed",
          },
        ],
      }
    );

    expect(record.problem).toBe("Data-heavy dashboard search latency");
    expect(record.approach).toBe("Precomputed search index");
    expect(record.variant).toBe("Redis-backed cache");
    expect(record.outcome.status).toBe("reused");
    expect(record.outcome.metrics).toEqual({ successful_adoptions: 2 });
    expect(record.outcome.evidence).toEqual({ ticket: "AG-42" });
  });

  it("always derives required solution fields when explicit solution data is absent", () => {
    const record = buildSolutionRecord(
      {
        type: "QUERY",
      },
      {
        hypotheses: [],
      }
    );

    expect(record.problem).toBe("QUERY");
    expect(record.approach).toBe("General");
    expect(record.variant).toBe("default");
    expect(record.outcome.summary).toBe("Awaiting validation or reuse feedback");
  });
});

describe("storeMessage validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects malformed solution payloads before persistence", async () => {
    await expect(
      storeMessage({
        type: "INTENT_REQUEST",
        intent: "show dashboard",
        solution: "bad-payload",
      } as unknown as Record<string, unknown>)
    ).rejects.toThrow("solution must be an object");
  });

  it("rejects malformed solution outcome payloads before persistence", async () => {
    await expect(
      storeMessage({
        type: "INTENT_REQUEST",
        intent: "show dashboard",
        solution: {
          outcome: "bad-outcome",
        },
      } as unknown as Record<string, unknown>)
    ).rejects.toThrow("solution.outcome must be an object");
  });

  it("uses standardized validation messages for nested solution fields", async () => {
    await expect(
      storeMessage({
        type: "INTENT_REQUEST",
        intent: "show dashboard",
        solution: {
          outcome: {
            status: "almost-valid",
          },
        },
      } as unknown as Record<string, unknown>)
    ).rejects.toThrow("solution.outcome.status must be a valid status");
  });

  it("rejects empty embedding vectors before persistence", async () => {
    vi.spyOn(normalizeModule, "normalizeMessage").mockResolvedValue({
      hypotheses: [
        {
          intent: "frontend_dashboard",
          tags: ["angular"],
          confidence: {
            value: 0.8,
            density: 0.5,
            agreement: 1,
            distance: 0.1,
          },
          source: "seed",
        },
      ],
      constraints: {},
      providersUsed: [],
      degraded: true,
      vector: [],
    });

    await expect(
      storeMessage({
        type: "INTENT_REQUEST",
        intent: "show dashboard",
      })
    ).rejects.toThrow("Invalid embedding vector");
  });
});

describe("updateMessageOutcome validation", () => {
  const validId = new mongoose.Types.ObjectId().toString();

  it("rejects malformed outcome update payloads before persistence", async () => {
    await expect(updateMessageOutcome(validId, "bad-payload")).rejects.toThrow(
      "outcome update must be an object"
    );
  });

  it("rejects empty outcome update payloads before persistence", async () => {
    await expect(updateMessageOutcome(validId, {})).rejects.toThrow(
      "outcome update must include at least one supported field"
    );
  });

  it("reuses standardized validation messages for outcome update fields", async () => {
    await expect(
      updateMessageOutcome(validId, {
        status: "almost-valid",
      })
    ).rejects.toThrow("solution.outcome.status must be a valid status");
  });
});

describe("buildSearchSummary", () => {
  it("prefers the original intent over derived solution fields for backward compatibility", () => {
    const summary = buildSearchSummary({
      original: {
        intent: "show dashboard",
        type: "INTENT_REQUEST",
      },
      solution: {
        problem: "Angular analytics dashboard for heavy datasets",
        approach: "Modular widget dashboard",
      },
    });

    expect(summary).toBe("show dashboard");
  });

  it("falls back to the original type before using solution fields", () => {
    const summary = buildSearchSummary({
      original: {
        type: "FEEDBACK",
      },
      solution: {
        problem: "Search latency",
        approach: "Precomputed index",
      },
    });

    expect(summary).toBe("FEEDBACK");
  });

  it("uses the solution summary format only when original intent and type are absent", () => {
    const summary = buildSearchSummary({
      original: {},
      solution: {
        problem: "Search latency",
        approach: "Precomputed index",
      },
    });

    expect(summary).toBe("Search latency -> Precomputed index");
  });
});

describe("buildAgentReputation", () => {
  it("returns a neutral multiplier when an agent has no solution history", () => {
    const reputation = buildAgentReputation();

    expect(reputation.score).toBe(0.5);
    expect(reputation.multiplier).toBe(1);
  });

  it("rewards validated and reused outcomes with reuse evidence", () => {
    const reputation = buildAgentReputation({
      solutionCount: 2,
      validatedCount: 1,
      reusedCount: 1,
      failedCount: 0,
      reuseCount: 4,
    });

    expect(reputation.score).toBe(1.7);
    expect(reputation.multiplier).toBe(1.24);
  });

  it("demotes agents with repeated failed outcomes", () => {
    const reputation = buildAgentReputation({
      solutionCount: 2,
      validatedCount: 0,
      reusedCount: 0,
      failedCount: 2,
      reuseCount: 0,
    });

    expect(reputation.score).toBe(0);
    expect(reputation.multiplier).toBe(0.9);
  });
});
