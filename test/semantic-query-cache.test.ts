import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSemanticQueryCache,
  getCachedSemanticQuery,
  setCachedSemanticQuery,
} from "../src/core/semantic-query-cache";

describe("semantic-query-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSemanticQueryCache();
  });

  afterEach(() => {
    clearSemanticQueryCache();
    vi.useRealTimers();
  });

  it("normalizes query text so casing and spacing reuse cache", () => {
    setCachedSemanticQuery("  Angular   Dashboard  ", {
      originalText: "Angular Dashboard",
      interpretedIntent: "frontend_dashboard",
      interpretedTags: ["angular", "dashboard"],
      vector: [1, 2, 3],
      confidence: 0.9,
      providersUsed: ["local"],
      degraded: false,
      intentMatches: [{ label: "frontend_dashboard", score: 0.9, density: 3, source: "seed" }],
      tagMatches: [{ label: "angular", score: 0.8, density: 2, source: "learned" }],
    });

    const cached = getCachedSemanticQuery("angular dashboard");
    expect(cached?.interpretedIntent).toBe("frontend_dashboard");
    expect(cached?.vector).toEqual([1, 2, 3]);
  });

  it("expires entries after ttl", () => {
    setCachedSemanticQuery("semantic search", {
      originalText: "semantic search",
      interpretedIntent: "retrieval",
      interpretedTags: ["search"],
      vector: [0.1, 0.2],
      confidence: 0.7,
      providersUsed: ["local"],
      degraded: false,
      intentMatches: [{ label: "retrieval", score: 0.7, density: 4, source: "seed" }],
      tagMatches: [{ label: "search", score: 0.6, density: 2, source: "learned" }],
    });

    expect(getCachedSemanticQuery("semantic search")).not.toBeNull();
    vi.advanceTimersByTime(300001);
    expect(getCachedSemanticQuery("semantic search")).toBeNull();
  });
});
