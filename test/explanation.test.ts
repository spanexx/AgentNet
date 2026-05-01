import { describe, expect, it } from "vitest";
import { buildExplanation, ResultExplanation } from "../src/core/explanation";
import { RankingSignals } from "../src/core/ranking";

describe("buildExplanation", () => {
  it("highlights semantic similarity as the top signal when it's strongest", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.92,
      intentMatch: 0,
      tagOverlap: 0,
      confidence: 0.5,
      recency: 0.3,
      reuse: 0.1,
      outcome: 0.25,
    };

    const explanation = buildExplanation(signals, "desktop_application", ["tauri"]);

    expect(explanation.topSignals[0]).toContain("Semantic similarity");
    expect(explanation.topSignals[0]).toContain("0.92");
  });

  it("includes intent match when intent is matched", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.7,
      intentMatch: 1,
      tagOverlap: 0.5,
      confidence: 0.8,
      recency: 0.3,
      reuse: 0,
      outcome: 0.25,
    };

    const explanation = buildExplanation(signals, "frontend_dashboard", ["angular"]);

    expect(explanation.matchedIntent).toBe("frontend_dashboard");
    expect(explanation.topSignals).toContain("Intent match");
  });

  it("returns null matchedIntent when intent does not match", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.8,
      intentMatch: 0,
      tagOverlap: 0,
      confidence: 0.5,
      recency: 0.3,
      reuse: 0,
      outcome: 0.25,
    };

    const explanation = buildExplanation(signals, "desktop_app", []);

    expect(explanation.matchedIntent).toBeNull();
  });

  it("includes validated outcome as a signal", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.5,
      intentMatch: 0,
      tagOverlap: 0,
      confidence: 0.5,
      recency: 0.2,
      reuse: 0,
      outcome: 0.8,
    };

    const explanation = buildExplanation(signals, null, []);

    expect(explanation.topSignals.some((s) => s.includes("Validated outcome"))).toBe(true);
  });

  it("returns at most 3 top signals", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0.9,
      intentMatch: 1,
      tagOverlap: 0.8,
      confidence: 0.9,
      recency: 0.8,
      reuse: 0.7,
      outcome: 0.85,
    };

    const explanation = buildExplanation(signals, "test", ["a", "b"]);

    expect(explanation.topSignals.length).toBeLessThanOrEqual(3);
  });

  it("falls back to 'Partial match' when no strong signals exist", () => {
    const signals: RankingSignals = {
      semanticSimilarity: 0,
      intentMatch: 0,
      tagOverlap: 0,
      confidence: 0,
      recency: 0,
      reuse: 0,
      outcome: 0,
    };

    const explanation = buildExplanation(signals, null, []);

    expect(explanation.topSignals).toContain("Partial match");
  });
});
