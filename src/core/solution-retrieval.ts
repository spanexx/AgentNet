/*
 * Code Map: Solution Retrieval Module
 * - searchSolutions: Semantic search against the Solution collection
 * - computeSolutionSimilarity: Cosine similarity between query and solution vectors
 *
 * CID Index:
 * CID:sol-retr-001 -> searchSolutions
 * CID:sol-retr-002 -> computeSolutionSimilarity
 *
 * Quick lookup: rg -n "CID:sol-retr-" src/core/solution-retrieval.ts
 */

import mongoose from "mongoose";
import { SolutionModel } from "../models/Solution";
import { cosineSimilarity } from "./embeddings";
import { SemanticQuery } from "./query-understanding";
import {
  RankingSignals,
  computeRankingScore,
  loadSemanticSearchWeights,
  buildReuseScore,
  buildOutcomeScore,
  buildRecencyScore,
} from "./ranking";
import { buildExplanation, ResultExplanation } from "./explanation";
import { SolutionOutcome, SolutionOutcomeStatus, SolutionRecord } from "../types/protocol";

const SEMANTIC_WEIGHTS = loadSemanticSearchWeights();

/**
 * A single result from semantic search.
 */
export interface SemanticResultItem {
  id: string;
  summary: string;
  score: number;
  usage: number;
  intent: string;
  tags: string[];
  confidence: number;
  agentId: string;
  createdAt: string;
  reputation: {
    score: number;
    multiplier: number;
  };
  solution: SolutionRecord;
  explanation: ResultExplanation;
  signals: RankingSignals;
}

/**
 * Complete response from semantic search.
 */
export interface SemanticSearchResult {
  results: SemanticResultItem[];
  total: number;
  limit: number;
  skip: number;
  query: {
    original: string;
    interpretedIntent: string | null;
    interpretedTags: string[];
    confidence: number;
    degraded: boolean;
  };
  emptyReason?: "no_solutions" | "no_semantic_match";
}

export interface SemanticSearchOptions {
  query: SemanticQuery;
  limit?: number;
  skip?: number;
}

interface SolutionLean {
  _id: mongoose.Types.ObjectId | string;
  problem: string;
  approach: string;
  variant: string;
  outcome: SolutionRecord["outcome"];
  agentId?: string;
  sourceMessageIds?: Array<mongoose.Types.ObjectId | string>;
  usageCount?: number;
  lastUsedAt?: Date | string;
  embedding?: number[];
  intent?: string;
  tags?: string[];
  createdAt: Date | string;
  updatedAt?: Date | string;
}

interface AgentReputationStats {
  solutionCount: number;
  validatedCount: number;
  reusedCount: number;
  failedCount: number;
  reuseCount: number;
}

interface AgentReputation {
  score: number;
  multiplier: number;
}

// CID:sol-retr-001 - searchSolutions
// Purpose: Semantic search against the Solution collection using hybrid signals
// Uses: SolutionModel, cosineSimilarity, ranking, explanation
// Used by: semanticSearchController
export async function searchSolutions(
  options: SemanticSearchOptions
): Promise<SemanticSearchResult> {
  const { query, limit = 25, skip = 0 } = options;

  // Check if any solutions exist at all
  const totalSolutions = await SolutionModel.countDocuments();
  if (totalSolutions === 0) {
    return {
      results: [],
      total: 0,
      limit,
      skip,
      query: buildQueryMeta(query),
      emptyReason: "no_solutions",
    };
  }

  // Fetch an indexed candidate pool first, then score in memory.
  const candidateLimit = Math.min(Math.max(limit * 3, 25), 100);
  const allCandidates = await collectCandidateSolutions(query, candidateLimit);

  if (allCandidates.length === 0) {
    return {
      results: [],
      total: 0,
      limit,
      skip,
      query: buildQueryMeta(query),
      emptyReason: "no_semantic_match",
    };
  }

  // Compute reputation for all agents in the candidate set
  const agentIds = [...new Set(
    allCandidates
      .map((s) => typeof s.agentId === "string" ? s.agentId : "anonymous")
      .filter((id) => id !== "anonymous")
  )];
  const reputationMap = await getAgentReputationMap(agentIds);

  // Score and rank each candidate
  const scored: SemanticResultItem[] = allCandidates.map((solution) => {
    const agentId = typeof solution.agentId === "string" ? solution.agentId : "anonymous";
    const reputation = reputationMap.get(agentId) ?? { score: 0.5, multiplier: 1 };
    const solutionRecord = hydrateSolutionRecord(solution);

    const signals = computeSignals(query, solution, solutionRecord);
    const score = computeRankingScore(signals, SEMANTIC_WEIGHTS, reputation.multiplier);
    const explanation = buildExplanation(signals, query.interpretedIntent, query.interpretedTags);

    const summary = buildSummary(solution);

    return {
      id: String(solution._id),
      summary,
      score,
      usage: typeof solution.usageCount === "number" ? solution.usageCount : 0,
      intent: typeof solution.intent === "string" ? solution.intent : "general",
      tags: Array.isArray(solution.tags) ? solution.tags : [],
      confidence: signals.confidence,
      agentId,
      createdAt: new Date(solution.createdAt).toISOString(),
      reputation: {
        score: reputation.score,
        multiplier: reputation.multiplier,
      },
      solution: solutionRecord,
      explanation,
      signals,
    };
  });

  // Sort by composite score descending
  scored.sort((a, b) => b.score - a.score);

  // Filter out very low scores (noise)
  const meaningful = scored.filter((s) => s.score > 0.05);
  const paginated = meaningful.slice(skip, skip + limit);

  return {
    results: paginated,
    total: meaningful.length,
    limit,
    skip,
    query: buildQueryMeta(query),
    emptyReason: meaningful.length === 0 ? "no_semantic_match" : undefined,
  };
}

// CID:sol-retr-002 - computeSolutionSimilarity
// Purpose: Compute cosine similarity between query vector and solution embedding
// Uses: cosineSimilarity from embeddings module
// Used by: computeSignals
function computeSolutionSimilarity(
  queryVector: number[],
  solutionEmbedding: number[] | undefined
): number {
  if (
    !queryVector || queryVector.length === 0 ||
    !solutionEmbedding || solutionEmbedding.length === 0
  ) {
    return 0;
  }

  return Math.max(0, cosineSimilarity(queryVector, solutionEmbedding));
}

function computeSignals(
  query: SemanticQuery,
  solution: SolutionLean,
  record: SolutionRecord
): RankingSignals {
  const semanticSimilarity = computeSolutionSimilarity(
    query.vector,
    Array.isArray(solution.embedding) ? solution.embedding : undefined
  );

  const solutionIntent = typeof solution.intent === "string" ? solution.intent : "general";
  const intentMatch =
    query.interpretedIntent && solutionIntent === query.interpretedIntent ? 1 : 0;

  const solutionTags = Array.isArray(solution.tags) ? solution.tags : [];
  const overlappingTags = query.interpretedTags.filter((t) => solutionTags.includes(t)).length;
  const tagOverlap = query.interpretedTags.length > 0
    ? Math.min(1, overlappingTags / query.interpretedTags.length)
    : solutionTags.length > 0 ? 0.3 : 0;

  const confidence = query.confidence;
  const recency = buildRecencyScore(solution.createdAt);
  const usage = typeof solution.usageCount === "number" ? solution.usageCount : 0;
  const reuse = buildReuseScore(usage, record.outcome.metrics);
  const outcome = buildOutcomeScore(record.outcome);

  return {
    semanticSimilarity,
    intentMatch,
    tagOverlap,
    confidence,
    recency,
    reuse,
    outcome,
  };
}

async function collectCandidateSolutions(
  query: SemanticQuery,
  candidateLimit: number
): Promise<SolutionLean[]> {
  const merged = new Map<string, SolutionLean>();
  const textSearch = buildTextSearch(query.originalText);

  const sources = await Promise.all([
    query.interpretedIntent
      ? SolutionModel.find({ intent: query.interpretedIntent })
          .sort({ createdAt: -1 })
          .limit(candidateLimit)
          .lean<SolutionLean[]>()
      : Promise.resolve([]),
    query.interpretedTags.length > 0
      ? SolutionModel.find({ tags: { $in: query.interpretedTags } })
          .sort({ createdAt: -1 })
          .limit(candidateLimit)
          .lean<SolutionLean[]>()
      : Promise.resolve([]),
    textSearch
      ? SolutionModel.find(
          { $text: { $search: textSearch } },
          { score: { $meta: "textScore" } }
        )
          .sort({ score: { $meta: "textScore" }, createdAt: -1 })
          .limit(candidateLimit)
          .lean<SolutionLean[]>()
      : Promise.resolve([]),
  ]);

  for (const group of sources) {
    mergeSolutionsIntoMap(merged, group);
  }

  // Final fallback for semantic-only recall or sparse index matches.
  if (merged.size < candidateLimit && query.vector.length > 0) {
    const recent = await SolutionModel.find()
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean<SolutionLean[]>();
    mergeSolutionsIntoMap(merged, recent);
  }

  return Array.from(merged.values()).slice(0, candidateLimit);
}

function mergeSolutionsIntoMap(
  target: Map<string, SolutionLean>,
  solutions: SolutionLean[]
): void {
  for (const solution of solutions) {
    const id = String(solution._id);
    if (!target.has(id)) {
      target.set(id, solution);
    }
  }
}

function buildTextSearch(text: string): string | null {
  const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "for",
    "how",
    "need",
    "show",
    "that",
    "the",
    "this",
    "using",
    "with",
  ]);

  const terms = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !STOP_WORDS.has(part))
    .slice(0, 8);

  return terms.length > 0 ? terms.join(" ") : null;
}

function hydrateSolutionRecord(solution: SolutionLean): SolutionRecord {
  return {
    problem: solution.problem || "unknown",
    approach: solution.approach || "General",
    variant: solution.variant || "default",
    outcome: {
      status: (solution.outcome?.status as SolutionOutcomeStatus) ?? "pending",
      summary: solution.outcome?.summary ?? "Awaiting validation or reuse feedback",
      metrics: isNumberRecord(solution.outcome?.metrics) ? solution.outcome?.metrics : undefined,
      evidence: isObjectRecord(solution.outcome?.evidence) ? solution.outcome?.evidence : undefined,
    },
  };
}

function buildSummary(solution: SolutionLean): string {
  const parts: string[] = [];
  if (solution.problem) parts.push(solution.problem);
  if (solution.approach) parts.push(solution.approach);
  return parts.length > 0 ? parts.join(" → ") : "Unknown solution";
}

function buildQueryMeta(query: SemanticQuery) {
  return {
    original: query.originalText,
    interpretedIntent: query.interpretedIntent,
    interpretedTags: query.interpretedTags,
    confidence: query.confidence,
    degraded: query.degraded,
  };
}

async function getAgentReputationMap(agentIds: string[]): Promise<Map<string, AgentReputation>> {
  const reputationMap = new Map<string, AgentReputation>();
  if (agentIds.length === 0) return reputationMap;

  const solutions = await SolutionModel.find({
    agentId: { $in: agentIds },
  }).lean<SolutionLean[]>();

  const statsByAgent = new Map<string, AgentReputationStats>();
  for (const solution of solutions) {
    const agentId = typeof solution.agentId === "string" ? solution.agentId : "anonymous";
    if (agentId === "anonymous") continue;

    const stats = statsByAgent.get(agentId) ?? {
      solutionCount: 0,
      validatedCount: 0,
      reusedCount: 0,
      failedCount: 0,
      reuseCount: 0,
    };

    stats.solutionCount += 1;
    if (solution.outcome?.status === "validated") stats.validatedCount += 1;
    else if (solution.outcome?.status === "reused") stats.reusedCount += 1;
    else if (solution.outcome?.status === "failed") stats.failedCount += 1;

    stats.reuseCount += getSolutionReuseEvidenceCount(solution);
    statsByAgent.set(agentId, stats);
  }

  for (const id of agentIds) {
    reputationMap.set(id, buildReputation(statsByAgent.get(id)));
  }

  return reputationMap;
}

function buildReputation(stats?: Partial<AgentReputationStats>): AgentReputation {
  const s: AgentReputationStats = {
    solutionCount: Math.max(0, stats?.solutionCount ?? 0),
    validatedCount: Math.max(0, stats?.validatedCount ?? 0),
    reusedCount: Math.max(0, stats?.reusedCount ?? 0),
    failedCount: Math.max(0, stats?.failedCount ?? 0),
    reuseCount: Math.max(0, stats?.reuseCount ?? 0),
  };

  if (s.solutionCount === 0) return { score: 0.5, multiplier: 1 };

  const rawScore =
    (s.validatedCount + s.reusedCount * 2 + s.reuseCount * 0.1 - s.failedCount) / s.solutionCount;
  const score = clamp(rawScore, 0, 2);
  const multiplier = clamp(0.9 + score * 0.2, 0.9, 1.3);

  return { score, multiplier };
}

function getSolutionReuseEvidenceCount(solution: SolutionLean): number {
  return Math.max(
    0,
    typeof solution.usageCount === "number" ? solution.usageCount : 0,
    getMetricNumber(solution.outcome?.metrics, "successful_adoptions"),
    getMetricNumber(solution.outcome?.metrics, "reuse_count"),
    getMetricNumber(solution.outcome?.metrics, "reused_count")
  );
}

function getMetricNumber(
  metrics: SolutionOutcome["metrics"] | undefined,
  key: string
): number {
  if (!metrics) return 0;
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isObjectRecord(value)) return false;
  return Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v));
}
