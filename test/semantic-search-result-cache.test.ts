import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSemanticSearchResultCache,
  getCachedSemanticSearchResult,
  setCachedSemanticSearchResult,
} from "../src/core/semantic-search-result-cache";

describe("semantic-search-result-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSemanticSearchResultCache();
  });

  afterEach(() => {
    clearSemanticSearchResultCache();
    vi.useRealTimers();
  });

  it("reuses cached results for normalized query and pagination key", () => {
    setCachedSemanticSearchResult(
      { q: "  Angular   dashboard ", limit: 10, skip: 0 },
      {
        results: [{ id: "1", score: 0.9 }],
        total: 1,
        limit: 10,
        skip: 0,
      }
    );

    expect(
      getCachedSemanticSearchResult({ q: "angular dashboard", limit: 10, skip: 0 })
    ).toEqual(
      expect.objectContaining({
        results: [{ id: "1", score: 0.9 }],
        total: 1,
        limit: 10,
        skip: 0,
      })
    );
  });

  it("misses cache when pagination changes", () => {
    setCachedSemanticSearchResult(
      { q: "semantic search", limit: 10, skip: 0 },
      {
        results: [{ id: "1", score: 0.8 }],
        total: 1,
        limit: 10,
        skip: 0,
      }
    );

    expect(
      getCachedSemanticSearchResult({ q: "semantic search", limit: 10, skip: 10 })
    ).toBeNull();
  });
});
