/*
 * Code Map: Message Service — Business Logic Layer
 * - storeMessage: Normalize and persist agent messages to database
 * - getAllMessages: Retrieve messages with optional intent filtering
 * - validateMessage: Validate message structure before processing
 *
 * CID Index:
 * CID:msg-svc-001 -> storeMessage
 * CID:msg-svc-002 -> getAllMessages
 * CID:msg-svc-003 -> validateMessage
 *
 * Quick lookup: rg -n "CID:msg-svc-" src/api/services/messageService.ts
 */

import mongoose from "mongoose";
import { MessageModel } from "../../models/Message";
import { SolutionModel } from "../../models/Solution";
import { normalizeMessage, NormalizedMessage } from "../../core/normalize";
import {
  AgentMessage,
  SolutionOutcome,
  SolutionOutcomeStatus,
  SolutionRecord,
} from "../../types/protocol";

const SEARCH_SCORE_WEIGHTS = loadSearchScoreWeights();

// CID:msg-svc-001a - StoreMessageResult
// Purpose: Shape returned by storeMessage for spec-compliant API response (Decision 8)
export interface StoreMessageResult {
  id: string;
  solutionId: string;
  original: string;
  normalized: NormalizedMessage;
  solution: SolutionRecord;
  degraded: boolean;
  timestamp: string;
}

// CID:msg-svc-001 - storeMessage
// Purpose: Core business logic: validate, normalize, and persist agent messages
// Uses: validateMessage, normalizeMessage, MessageModel.create
// Used by: messageController.createMessage
export async function storeMessage(raw: Record<string, unknown>): Promise<StoreMessageResult> {
  // Accept both { text: "..." } (spec) and AgentMessage (backward compat)
  const msg = toAgentMessage(raw);
  validateMessage(msg);

  // Normalize to structured form (async: uses embedding ensemble)
  const normalized = await normalizeMessage(msg);
  const solution = buildSolutionRecord(msg, normalized);
  const { persistedSolution, saved } = await runInTransaction(async (session) => {
    const [createdSolution] = await SolutionModel.create(
      [
        {
          ...solution,
          agentId: msg.agentId ?? "anonymous",
        },
      ],
      { session }
    );

    const [createdMessage] = await MessageModel.create(
      [
        {
          original: msg,
          normalized,
          solution,
          solutionId: createdSolution._id,
          agentId: msg.agentId ?? "anonymous",
          source: "api",
        },
      ],
      { session }
    );

    try {
      await SolutionModel.updateOne(
        { _id: createdSolution._id },
        { $addToSet: { sourceMessageIds: createdMessage._id } },
        { session }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to link solution to message: ${message}`);
    }

    return {
      persistedSolution: createdSolution,
      saved: createdMessage,
    };
  });

  // Surface the ensemble's runtime degradation signal without penalizing unconfigured providers.
  const degraded = normalized.degraded;

  return {
    id: saved._id.toString(),
    solutionId: persistedSolution._id.toString(),
    original: msg.intent ?? msg.type ?? String(raw.text ?? ""),
    normalized,
    solution,
    degraded,
    timestamp: saved.createdAt.toISOString(),
  };
}

/** Convert spec { text } or AgentMessage to AgentMessage */
function toAgentMessage(raw: Record<string, unknown>): AgentMessage {
  if (raw.text && typeof raw.text === "string") {
    return {
      type: "INTENT_REQUEST",
      agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
      intent: raw.text,
      data: raw.data as Record<string, unknown> | undefined,
      solution: asSolutionPartial(raw.solution),
    };
  }
  return {
    ...(raw as unknown as AgentMessage),
    solution: asSolutionPartial(raw.solution),
  };
}

// CID:msg-svc-002 - getAllMessages
// Purpose: Retrieve stored messages with optional intent filtering and pagination
// Uses: MessageModel.find, lean()
// Used by: messageController.getMessages
export async function getAllMessages(options?: {
  intent?: string;
  limit?: number;
  skip?: number;
}) {
  const { intent, limit = 100, skip = 0 } = options || {};

  // Normalized output stores ranked hypotheses, not a single top-level intent field.
  const filter = intent ? { "normalized.hypotheses.intent": intent } : {};

  // Query with pagination
  const messages = await MessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();

  // Get total count for pagination info
  const total = await MessageModel.countDocuments(filter);

  return {
    messages,
    total,
    limit,
    skip
  };
}

export async function getAllSolutions(options?: {
  agentId?: string;
  limit?: number;
  skip?: number;
}) {
  const { agentId, limit = 100, skip = 0 } = options || {};
  const filter = agentId ? { agentId } : {};

  const solutions = await SolutionModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean<SolutionLean[]>();

  const total = await SolutionModel.countDocuments(filter);

  return {
    solutions: solutions.map((solution) => ({
      id: String(solution._id),
      problem: solution.problem,
      approach: solution.approach,
      variant: solution.variant,
      outcome: solution.outcome,
      agentId: typeof solution.agentId === "string" ? solution.agentId : "anonymous",
      messageCount: Array.isArray(solution.sourceMessageIds) ? solution.sourceMessageIds.length : 0,
      createdAt: new Date(solution.createdAt).toISOString(),
      updatedAt: new Date(solution.updatedAt ?? solution.createdAt).toISOString(),
    })),
    total,
    limit,
    skip,
  };
}

// CID:msg-svc-003 - validateMessage
// Purpose: Enforce message structure contracts before processing
// Uses: AgentMessage type
// Used by: storeMessage
function validateMessage(msg: AgentMessage): void {
  if (!msg.type) {
    throw new Error("Missing required field: type");
  }

  if (typeof msg.type !== "string") {
    throw new Error("Field 'type' must be a string");
  }

  if (msg.agentId && typeof msg.agentId !== "string") {
    throw new Error("Field 'agentId' must be a string");
  }

  // Intent is optional, but if provided must be string
  if (msg.intent && typeof msg.intent !== "string") {
    throw new Error("Field 'intent' must be a string");
  }

  // Data is optional, but if provided must be object
  if (msg.data && typeof msg.data !== "object") {
    throw new Error("Field 'data' must be an object");
  }

  validateSolution(msg.solution);
}

export type SearchResultItem = {
  id: string;
  summary: string;
  score: number;
  usage: number;
  intent: string;
  tags: string[];
  confidence: number;
  agentId: string;
  createdAt: string;
  solution: SolutionRecord;
};

export interface UseMessageResult {
  id: string;
  usageCount: number;
  lastUsedAt: string;
}

export interface UpdateMessageOutcomeResult {
  id: string;
  solutionId?: string;
  solution: SolutionRecord;
  updatedAt: string;
}

export interface SolutionListItem extends SolutionRecord {
  id: string;
  agentId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface MessageLeanConfidence {
  value?: number;
  density?: number;
  agreement?: number;
  distance?: number;
}

interface MessageLeanHypothesis {
  intent?: string;
  tags?: string[];
  confidence?: MessageLeanConfidence;
  source?: string;
}

interface MessageLeanNormalized {
  hypotheses?: MessageLeanHypothesis[];
  constraints?: Record<string, unknown>;
  providersUsed?: string[];
  degraded?: boolean;
}

interface MessageLeanOriginal {
  intent?: string;
  type?: string;
  [key: string]: unknown;
}

interface MessageLeanSolution {
  problem?: string;
  approach?: string;
  variant?: string;
  outcome?: {
    status?: SolutionOutcomeStatus;
    summary?: string;
    metrics?: Record<string, number>;
    evidence?: Record<string, unknown>;
  };
}

interface MessageLean {
  _id: { toString(): string } | string;
  original?: MessageLeanOriginal;
  normalized?: MessageLeanNormalized;
  solution?: MessageLeanSolution;
  solutionId?: mongoose.Types.ObjectId | string;
  agentId?: string;
  usageCount?: number;
  lastUsedAt?: Date | string;
  createdAt: Date | string;
  updatedAt?: Date | string;
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
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export function buildSearchSummary(
  message: Pick<MessageLean, "original" | "solution">
): string {
  if (typeof message.original?.intent === "string") {
    return message.original.intent;
  }

  if (typeof message.original?.type === "string") {
    return message.original.type;
  }

  if (typeof message.solution?.problem === "string") {
    const approach =
      typeof message.solution.approach === "string" && message.solution.approach.trim().length > 0
        ? ` -> ${message.solution.approach}`
        : "";

    return `${message.solution.problem}${approach}`;
  }

  return JSON.stringify(message.original ?? "").slice(0, 160);
}

export async function searchMessages(options?: {
  intent?: string;
  tags?: string[];
  limit?: number;
  skip?: number;
}) {
  const { intent, tags = [], limit = 25, skip = 0 } = options || {};
  const filter: Record<string, unknown> = {};

  if (intent) filter["normalized.hypotheses.intent"] = intent;
  if (tags.length > 0) filter["normalized.hypotheses.tags"] = { $all: tags };

  const messages = await MessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean<MessageLean[]>();

  const now = Date.now();
  const scored: SearchResultItem[] = messages.map((m) => {
    const solution = hydrateSolutionRecord(m);
    const top = Array.isArray(m.normalized?.hypotheses) ? m.normalized.hypotheses[0] : undefined;
    const topIntent = typeof top?.intent === "string" ? top.intent : "unknown";
    const topTags = Array.isArray(top?.tags) ? top.tags.filter((t): t is string => typeof t === "string") : [];
    const confidence = typeof top?.confidence?.value === "number" ? top.confidence.value : 0;
    const usage = typeof m.usageCount === "number" ? m.usageCount : 0;

    const intentScore = intent ? (topIntent === intent ? 1 : 0) : 0.5;
    const overlappingTags = topTags.filter((t: string) => tags.includes(t)).length;
    const tagOverlap = tags.length > 0
      ? Math.min(1, overlappingTags / Math.max(1, tags.length))
      : 0.5;
    const ageMs = now - new Date(m.createdAt).getTime();
    const recency = Math.max(0, 1 - ageMs / (1000 * 60 * 60 * 24 * 30));
    const reuseScore = buildReuseScore(usage, solution.outcome.metrics);
    const outcomeScore = buildOutcomeScore(solution.outcome);

    const score =
      SEARCH_SCORE_WEIGHTS.intent * intentScore +
      SEARCH_SCORE_WEIGHTS.tags * tagOverlap +
      SEARCH_SCORE_WEIGHTS.confidence * confidence +
      SEARCH_SCORE_WEIGHTS.recency * recency +
      SEARCH_SCORE_WEIGHTS.reuse * reuseScore +
      SEARCH_SCORE_WEIGHTS.outcome * outcomeScore;

    const summary = buildSearchSummary(m);

    return {
      id: String(m._id),
      summary,
      score,
      usage,
      intent: topIntent,
      tags: topTags,
      confidence,
      agentId: typeof m.agentId === "string" ? m.agentId : "anonymous",
      createdAt: new Date(m.createdAt).toISOString(),
      solution,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const total = await MessageModel.countDocuments(filter);

  return {
    results: scored,
    total,
    limit,
    skip
  };
}

export async function markMessageUsed(id: string): Promise<UseMessageResult> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid message ID format");
  }

  const usedAt = new Date();
  const updated = await runInTransaction(async (session) => {
    const updatedMessage = await MessageModel.findByIdAndUpdate(
      id,
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: usedAt } },
      { new: true, session }
    ).lean<MessageLean | null>();

    if (!updatedMessage) {
      throw new Error("Message not found");
    }

    const linkedSolutionId = getValidLinkedSolutionId(updatedMessage.solutionId);

    if (linkedSolutionId) {
      const updatedSolution = await SolutionModel.findByIdAndUpdate(
        linkedSolutionId,
        {
          $inc: { usageCount: 1 },
          $set: { lastUsedAt: usedAt },
        },
        { new: true, session }
      ).lean<SolutionLean | null>();

      if (!updatedSolution) {
        throw new Error("Linked solution not found");
      }
    }

    return updatedMessage;
  });

  return {
    id: String(updated._id),
    usageCount: typeof updated.usageCount === "number" ? updated.usageCount : 0,
    lastUsedAt: new Date(updated.lastUsedAt ?? updated.updatedAt ?? usedAt).toISOString(),
  };
}

export async function updateMessageOutcome(
  id: string,
  raw: unknown
): Promise<UpdateMessageOutcomeResult> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid message ID format");
  }

  const outcomePatch = parseOutcomeUpdate(raw);
  const updated = await runInTransaction(async (session) => {
    const existing = await MessageModel.findById(id).session(session).lean<MessageLean | null>();

    if (!existing) {
      throw new Error("Message not found");
    }

    const currentSolution = hydrateSolutionRecord(existing);
    const nextSolution: SolutionRecord = {
      ...currentSolution,
      outcome: {
        ...currentSolution.outcome,
        ...outcomePatch,
        metrics: outcomePatch.metrics ?? currentSolution.outcome.metrics,
        evidence: outcomePatch.evidence ?? currentSolution.outcome.evidence,
      },
    };
    validateCompleteOutcome(nextSolution.outcome);

    const updatedMessage = await MessageModel.findByIdAndUpdate(
      id,
      { $set: { solution: nextSolution } },
      { new: true, session }
    ).lean<MessageLean | null>();

    if (!updatedMessage) {
      throw new Error("Message not found");
    }

    const linkedSolutionId = getValidLinkedSolutionId(updatedMessage.solutionId);

    if (linkedSolutionId) {
      const solutionUpdate = await SolutionModel.findByIdAndUpdate(
        linkedSolutionId,
        {
          $set: {
            problem: nextSolution.problem,
            approach: nextSolution.approach,
            variant: nextSolution.variant,
            outcome: nextSolution.outcome,
          },
        },
        { new: true, session }
      ).lean<SolutionLean | null>();

      if (!solutionUpdate) {
        throw new Error("Linked solution not found");
      }
    }

    return updatedMessage;
  });

  return {
    id: String(updated._id),
    solutionId: updated.solutionId ? String(updated.solutionId) : undefined,
    solution: hydrateSolutionRecord(updated),
    updatedAt: new Date(updated.updatedAt ?? Date.now()).toISOString(),
  };
}

function loadSearchScoreWeights() {
  // The ranking policy stays mostly semantic, then boosts solutions with evidence of reuse
  // and successful outcomes while demoting failed ones.
  const defaults = {
    intent: 0.28,
    tags: 0.18,
    confidence: 0.16,
    recency: 0.10,
    reuse: 0.13,
    outcome: 0.15,
  } as const;

  const configured = {
    intent: parseWeight(process.env.SEARCH_SCORE_WEIGHT_INTENT, defaults.intent),
    tags: parseWeight(process.env.SEARCH_SCORE_WEIGHT_TAGS, defaults.tags),
    confidence: parseWeight(process.env.SEARCH_SCORE_WEIGHT_CONFIDENCE, defaults.confidence),
    recency: parseWeight(process.env.SEARCH_SCORE_WEIGHT_RECENCY, defaults.recency),
    reuse: parseWeight(process.env.SEARCH_SCORE_WEIGHT_REUSE, defaults.reuse),
    outcome: parseWeight(process.env.SEARCH_SCORE_WEIGHT_OUTCOME, defaults.outcome),
  };

  const total =
    configured.intent +
    configured.tags +
    configured.confidence +
    configured.recency +
    configured.reuse +
    configured.outcome;

  if (total <= 0) return defaults;

  return {
    intent: configured.intent / total,
    tags: configured.tags / total,
    confidence: configured.confidence / total,
    recency: configured.recency / total,
    reuse: configured.reuse / total,
    outcome: configured.outcome / total,
  };
}

function parseWeight(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function runInTransaction<T>(
  work: (session: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  let result: T | undefined;

  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
  } finally {
    await session.endSession();
  }

  if (result === undefined) {
    throw new Error("Transaction completed without result");
  }

  return result;
}

function buildReuseScore(
  usageCount: number,
  metrics: SolutionOutcome["metrics"] | undefined
): number {
  const explicitReuseCount = Math.max(
    0,
    getMetricNumber(metrics, "successful_adoptions"),
    getMetricNumber(metrics, "reuse_count"),
    getMetricNumber(metrics, "reused_count")
  );
  const combinedReuse = Math.max(0, usageCount) + explicitReuseCount;

  if (combinedReuse <= 0) return 0;

  return Math.min(1, Math.log1p(combinedReuse) / Math.log(6));
}

function buildOutcomeScore(outcome: SolutionOutcome): number {
  const statusScores: Record<SolutionOutcomeStatus, number> = {
    failed: 0,
    pending: 0.25,
    validated: 0.8,
    reused: 1,
  };

  const base = statusScores[outcome.status] ?? statusScores.pending;
  const evidenceBoost = outcome.evidence && Object.keys(outcome.evidence).length > 0 ? 0.05 : 0;
  const metricBoost = outcome.metrics && Object.keys(outcome.metrics).length > 0 ? 0.05 : 0;

  return Math.min(1, base + evidenceBoost + metricBoost);
}

function getMetricNumber(
  metrics: SolutionOutcome["metrics"] | undefined,
  key: string
): number {
  if (!metrics) return 0;
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildSolutionRecord(
  msg: AgentMessage,
  normalized: Pick<NormalizedMessage, "hypotheses">
): SolutionRecord {
  const top = Array.isArray(normalized.hypotheses) ? normalized.hypotheses[0] : undefined;
  const solution = msg.solution;

  return {
    problem:
      sanitizeText(solution?.problem) ??
      sanitizeText(msg.intent) ??
      sanitizeText(msg.type) ??
      "unknown",
    approach:
      sanitizeText(solution?.approach) ??
      humanizeIdentifier(typeof top?.intent === "string" ? top.intent : "general"),
    variant:
      sanitizeText(solution?.variant) ??
      describeVariant(Array.isArray(top?.tags) ? top.tags : []),
    outcome: buildSolutionOutcome(solution?.outcome, msg),
  };
}

function buildSolutionOutcome(
  raw: Partial<SolutionOutcome> | undefined,
  msg: AgentMessage
): SolutionOutcome {
  const metrics = isNumberRecord(raw?.metrics) ? raw.metrics : undefined;
  const evidence = isObjectRecord(raw?.evidence) ? raw.evidence : undefined;

  return {
    status: toOutcomeStatus(raw?.status, msg.type),
    summary:
      sanitizeText(raw?.summary) ??
      inferOutcomeSummary(msg.type, msg.intent),
    metrics,
    evidence,
  };
}

function toOutcomeStatus(
  status: SolutionOutcomeStatus | undefined,
  messageType: string
): SolutionOutcomeStatus {
  if (status) return status;
  if (messageType === "FEEDBACK") return "validated";
  return "pending";
}

function inferOutcomeSummary(messageType: string, intent?: string): string {
  if (messageType === "FEEDBACK") {
    return sanitizeText(intent) ?? "Feedback received for this solution variant";
  }
  return "Awaiting validation or reuse feedback";
}

function describeVariant(tags: string[]): string {
  if (tags.length === 0) return "default";
  return tags.slice(0, 3).join(", ");
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function validateSolution(solution: AgentMessage["solution"]): void {
  if (!solution) return;

  if (solution.problem !== undefined && !sanitizeText(solution.problem)) {
    throw new Error("solution.problem must be a non-empty string");
  }

  if (solution.approach !== undefined && !sanitizeText(solution.approach)) {
    throw new Error("solution.approach must be a non-empty string");
  }

  if (solution.variant !== undefined && !sanitizeText(solution.variant)) {
    throw new Error("solution.variant must be a non-empty string");
  }

  if (solution.outcome !== undefined) {
    if (!isObjectRecord(solution.outcome)) {
      throw new Error("solution.outcome must be an object");
    }
    validateOutcomeFields(solution.outcome as Partial<SolutionOutcome>);
  }
}

function hydrateSolutionRecord(message: MessageLean): SolutionRecord {
  const fallbackIntent = message.original?.intent ?? message.original?.type ?? "general";
  const fallbackTags = Array.isArray(message.normalized?.hypotheses?.[0]?.tags)
    ? message.normalized?.hypotheses?.[0]?.tags ?? []
    : [];
  const fallbackApproach = humanizeIdentifier(
    typeof message.normalized?.hypotheses?.[0]?.intent === "string"
      ? message.normalized.hypotheses[0].intent
      : "general"
  );

  return {
    problem: sanitizeText(message.solution?.problem) ?? fallbackIntent,
    approach: sanitizeText(message.solution?.approach) ?? fallbackApproach,
    variant: sanitizeText(message.solution?.variant) ?? describeVariant(fallbackTags),
    outcome: {
      status: message.solution?.outcome?.status ?? "pending",
      summary:
        sanitizeText(message.solution?.outcome?.summary) ??
        "Awaiting validation or reuse feedback",
      metrics: isNumberRecord(message.solution?.outcome?.metrics)
        ? message.solution?.outcome?.metrics
        : undefined,
      evidence: isObjectRecord(message.solution?.outcome?.evidence)
        ? message.solution?.outcome?.evidence
        : undefined,
    },
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isObjectRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function parseOutcomeUpdate(value: unknown): Partial<SolutionOutcome> {
  if (!isObjectRecord(value)) {
    throw new Error("outcome update must be an object");
  }

  const patch: Partial<SolutionOutcome> = {};

  if ("status" in value) {
    patch.status = value.status as SolutionOutcomeStatus;
  }

  if ("summary" in value) {
    patch.summary = value.summary as string | undefined;
  }

  if ("metrics" in value) {
    patch.metrics = value.metrics as Record<string, number> | undefined;
  }

  if ("evidence" in value) {
    patch.evidence = value.evidence as Record<string, unknown> | undefined;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("outcome update must include at least one supported field");
  }

  validateOutcomeFields(patch);

  return patch;
}

function validateOutcomeFields(outcome: Partial<SolutionOutcome>): void {
  if (
    outcome.status !== undefined &&
    !["pending", "validated", "reused", "failed"].includes(String(outcome.status))
  ) {
    throw new Error("solution.outcome.status must be a valid status");
  }

  if (outcome.summary !== undefined && !sanitizeText(outcome.summary)) {
    throw new Error("solution.outcome.summary must be a non-empty string");
  }

  if (outcome.metrics !== undefined && !isNumberRecord(outcome.metrics)) {
    throw new Error("solution.outcome.metrics must be an object of numbers");
  }

  if (outcome.evidence !== undefined && !isObjectRecord(outcome.evidence)) {
    throw new Error("solution.outcome.evidence must be an object");
  }
}

function validateCompleteOutcome(outcome: Partial<SolutionOutcome>): asserts outcome is SolutionOutcome {
  validateOutcomeFields(outcome);

  if (!outcome.status) {
    throw new Error("solution.outcome.status is required");
  }

  if (!sanitizeText(outcome.summary)) {
    throw new Error("solution.outcome.summary is required");
  }
}

function getValidLinkedSolutionId(
  solutionId: mongoose.Types.ObjectId | string | null | undefined
): mongoose.Types.ObjectId | string | undefined {
  if (solutionId === null || solutionId === undefined) {
    return undefined;
  }

  if (!mongoose.Types.ObjectId.isValid(solutionId)) {
    throw new Error("Invalid linked solution ID format");
  }

  return solutionId;
}

function asSolutionPartial(value: unknown): AgentMessage["solution"] | undefined {
  if (value === undefined) return undefined;

  if (!isObjectRecord(value)) {
    throw new Error("solution must be an object");
  }

  const parsed: NonNullable<AgentMessage["solution"]> = {};
  const raw = value as Record<string, unknown>;

  if ("problem" in raw) {
    parsed.problem = raw.problem as string | undefined;
  }

  if ("approach" in raw) {
    parsed.approach = raw.approach as string | undefined;
  }

  if ("variant" in raw) {
    parsed.variant = raw.variant as string | undefined;
  }

  if ("outcome" in raw) {
    if (raw.outcome !== undefined && !isObjectRecord(raw.outcome)) {
      throw new Error("solution.outcome must be an object");
    }

    if (isObjectRecord(raw.outcome)) {
      const rawOutcome = raw.outcome as Record<string, unknown>;
      const outcome: Partial<SolutionOutcome> = {};

      if ("status" in rawOutcome) {
        outcome.status = rawOutcome.status as SolutionOutcomeStatus;
      }

      if ("summary" in rawOutcome) {
        outcome.summary = rawOutcome.summary as string | undefined;
      }

      if ("metrics" in rawOutcome) {
        outcome.metrics = rawOutcome.metrics as Record<string, number> | undefined;
      }

      if ("evidence" in rawOutcome) {
        outcome.evidence = rawOutcome.evidence as Record<string, unknown> | undefined;
      }

      parsed.outcome = outcome;
    }
  }

  return parsed;
}
