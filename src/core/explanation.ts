/*
 * Code Map: Result Explanation Formatter
 * - buildExplanation: Attach human-readable explanation to a search result
 *
 * CID Index:
 * CID:explain-001 -> buildExplanation
 *
 * Quick lookup: rg -n "CID:explain-" src/core/explanation.ts
 */

import { RankingSignals } from "./ranking";

/**
 * Lightweight explainability for a single search result.
 */
export interface ResultExplanation {
  /** The intent cluster that matched (if any) */
  matchedIntent: string | null;
  /** Tag clusters that matched */
  matchedTags: string[];
  /** Top human-readable signals explaining why this result ranked highly */
  topSignals: string[];
}

// CID:explain-001 - buildExplanation
// Purpose: Generate human-readable explanation for a search result
// Uses: RankingSignals
// Used by: semanticSearchController, CLI formatter
export function buildExplanation(
  signals: RankingSignals,
  interpretedIntent: string | null,
  interpretedTags: string[]
): ResultExplanation {
  const topSignals: string[] = [];

  // Collect signal descriptions sorted by contribution
  const signalDescriptions: Array<{ value: number; label: string }> = [
    {
      value: signals.semanticSimilarity,
      label: `Semantic similarity (${signals.semanticSimilarity.toFixed(2)})`,
    },
    {
      value: signals.intentMatch,
      label: signals.intentMatch > 0 ? "Intent match" : "",
    },
    {
      value: signals.tagOverlap,
      label: signals.tagOverlap > 0
        ? `Tag overlap (${(signals.tagOverlap * 100).toFixed(0)}%)`
        : "",
    },
    {
      value: signals.outcome,
      label: signals.outcome >= 0.8
        ? "Validated outcome"
        : signals.outcome >= 1.0
          ? "Reused outcome"
          : "",
    },
    {
      value: signals.reuse,
      label: signals.reuse > 0
        ? `Reuse evidence (${signals.reuse.toFixed(2)})`
        : "",
    },
    {
      value: signals.confidence,
      label: signals.confidence >= 0.7
        ? `High confidence (${signals.confidence.toFixed(2)})`
        : "",
    },
    {
      value: signals.recency,
      label: signals.recency >= 0.5
        ? "Recent solution"
        : "",
    },
  ];

  // Sort by signal strength descending, take top 3 non-empty
  const sorted = signalDescriptions
    .filter((s) => s.label.length > 0 && s.value > 0)
    .sort((a, b) => b.value - a.value);

  for (const signal of sorted.slice(0, 3)) {
    topSignals.push(signal.label);
  }

  if (topSignals.length === 0) {
    topSignals.push("Partial match");
  }

  return {
    matchedIntent: signals.intentMatch > 0 ? interpretedIntent : null,
    matchedTags: interpretedTags.filter(() => signals.tagOverlap > 0),
    topSignals,
  };
}
