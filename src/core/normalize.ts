/*
 * Code Map: Semantic Decision Graph — Normalization Engine
 * - normalizeMessage: Transforms input into multi-hypothesis semantic result via SDG
 * - mapIntentFallback: String-matching fallback for intent resolution
 * - extractTagsFallback: Keyword-matching fallback for tag extraction
 * - getEnsemble: Lazy singleton for the embedding ensemble
 * - getSemanticSpace: Lazy singleton for the semantic space engine
 *
 * CID Index:
 * CID:normalize-001 -> normalizeMessage
 * CID:normalize-002 -> mapIntentFallback
 * CID:normalize-003 -> extractTagsFallback
 * CID:normalize-004 -> getEnsemble
 * CID:normalize-005 -> getSemanticSpace
 *
 * Quick lookup: rg -n "CID:normalize-" src/core/normalize.ts
 */

import { AgentMessage } from "../types/protocol";
import { EmbeddingEnsemble } from "./embeddings";
import { SemanticSpace, SemanticResult, DEFAULT_TOP_K } from "./sdg";

export type NormalizedMessage = SemanticResult;

// CID:normalize-004 - getEnsemble
// Purpose: Lazy-init singleton embedding ensemble for reuse across calls
// Uses: EmbeddingEnsemble
// Used by: normalizeMessage
let _ensemble: EmbeddingEnsemble | null = null;
export function getEnsemble(): EmbeddingEnsemble {
  if (!_ensemble) _ensemble = new EmbeddingEnsemble();
  return _ensemble;
}

// CID:normalize-005 - getSemanticSpace
// Purpose: Lazy-init singleton semantic space engine
// Uses: SemanticSpace
// Used by: normalizeMessage
let _semanticSpace: SemanticSpace | null = null;
export function getSemanticSpace(): SemanticSpace {
  if (!_semanticSpace) _semanticSpace = new SemanticSpace();
  return _semanticSpace;
}

// CID:normalize-001 - normalizeMessage
// Purpose: Convert raw agent messages into multi-hypothesis semantic result via SDG
// Uses: EmbeddingEnsemble, SemanticSpace
// Used by: API routes, storage layer
export async function normalizeMessage(msg: AgentMessage): Promise<NormalizedMessage> {
  const text = msg.intent ?? msg.type ?? "";
  const ensemble = getEnsemble();

  try {
    const ensembleResult = await ensemble.embed(text);
    const space = getSemanticSpace();

    // Search the semantic space for top-K clusters
    const { intentMatches, tagMatches } = await space.search(
      ensembleResult.vector,
      ensembleResult,
      DEFAULT_TOP_K
    );

    // Construct ranked hypotheses from cluster matches
    const hypotheses = space.constructHypotheses(
      intentMatches,
      tagMatches,
      ensembleResult.agreement.average
    );

    // Continuous centroid updates: evolve the best-matching clusters
    const bestIntent = intentMatches[0];
    const bestTag = tagMatches[0];

    if (bestIntent) {
      await space.updateCentroid(bestIntent.label, ensembleResult.vector, text);
    } else {
      await space.maybeDiscover(
        ensembleResult.vector, text,
        intentMatches[0]?.score ?? 0,
        tagMatches[0]?.score ?? 0,
        "intent"
      );
    }

    if (bestTag) {
      await space.updateCentroid(bestTag.label, ensembleResult.vector, text);
    } else {
      await space.maybeDiscover(
        ensembleResult.vector, text,
        intentMatches[0]?.score ?? 0,
        tagMatches[0]?.score ?? 0,
        "tag"
      );
    }

    return {
      hypotheses,
      constraints: msg.data || {},
      providersUsed: ensembleResult.providersUsed,
      degraded: ensembleResult.degraded,
      vector: ensembleResult.vector,
    };
  } catch {
    // All providers failed — fall back to string matching
    const fallbackIntent = mapIntentFallback(text);
    const fallbackTags = extractTagsFallback(msg);
    const fallbackConf = calculateFallbackConfidence(msg);

    return {
      hypotheses: [
        {
          intent: fallbackIntent,
          tags: fallbackTags,
          confidence: {
            value: fallbackConf,
            density: 0,
            agreement: 0,
            distance: 1,
          },
          source: "fallback",
        },
      ],
      constraints: msg.data || {},
      providersUsed: [],
      degraded: true,
      vector: [],
    };
  }
}

// CID:normalize-002 - mapIntentFallback
// Purpose: String-matching fallback for intent resolution
// Uses: string.includes, string.toLowerCase
// Used by: normalizeMessage
function mapIntentFallback(intent?: string): string {
  if (!intent) return "unknown";

  const i = intent.toLowerCase();

  if (i.includes("dashboard")) return "frontend_dashboard";
  if (i.includes("auth") || i.includes("login")) return "authentication";
  if (i.includes("payment") || i.includes("finance")) return "fintech";
  if (i.includes("chart") || i.includes("metric")) return "analytics";
  if (i.includes("query") || i.includes("search")) return "retrieval";

  return "general";
}

// CID:normalize-003 - extractTagsFallback
// Purpose: Keyword-matching fallback for tag extraction
// Uses: JSON.stringify, string.includes
// Used by: normalizeMessage
function extractTagsFallback(msg: AgentMessage): string[] {
  const raw = JSON.stringify(msg).toLowerCase();
  const tags: string[] = [];

  if (raw.includes("angular")) tags.push("angular");
  if (raw.includes("react")) tags.push("react");
  if (raw.includes("vue")) tags.push("vue");
  if (raw.includes("typescript")) tags.push("typescript");

  if (raw.includes("chart") || raw.includes("graph")) tags.push("charts");
  if (raw.includes("fintech") || raw.includes("payment")) tags.push("fintech");
  if (raw.includes("dashboard")) tags.push("dashboard");
  if (raw.includes("realtime")) tags.push("realtime");

  return Array.from(new Set(tags));
}

function calculateFallbackConfidence(msg: AgentMessage): number {
  let score = 0.5;
  if (msg.type) score += 0.2;
  if (msg.intent) score += 0.2;
  if (msg.data && Object.keys(msg.data).length > 0) score += 0.1;
  return Math.min(score, 1.0);
}
