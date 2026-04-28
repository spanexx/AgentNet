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
import { normalizeMessage, NormalizedMessage } from "../../core/normalize";
import { AgentMessage } from "../../types/protocol";

const SEARCH_SCORE_WEIGHTS = loadSearchScoreWeights();

// CID:msg-svc-001a - StoreMessageResult
// Purpose: Shape returned by storeMessage for spec-compliant API response (Decision 8)
export interface StoreMessageResult {
  id: string;
  original: string;
  normalized: NormalizedMessage;
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

  // Persist both raw and normalized
  const saved = await MessageModel.create({
    original: msg,
    normalized,
    agentId: msg.agentId ?? "anonymous",
    source: "api"
  });

  // Surface the ensemble's runtime degradation signal without penalizing unconfigured providers.
  const degraded = normalized.degraded;

  return {
    id: saved._id.toString(),
    original: msg.intent ?? msg.type ?? String(raw.text ?? ""),
    normalized,
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
      data: raw.data as Record<string, unknown> | undefined
    };
  }
  return raw as unknown as AgentMessage;
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
};

export interface UseMessageResult {
  id: string;
  usageCount: number;
  lastUsedAt: string;
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

interface MessageLean {
  _id: { toString(): string } | string;
  original?: MessageLeanOriginal;
  normalized?: MessageLeanNormalized;
  agentId?: string;
  usageCount?: number;
  lastUsedAt?: Date | string;
  createdAt: Date | string;
  updatedAt?: Date | string;
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
    const top = Array.isArray(m.normalized?.hypotheses) ? m.normalized.hypotheses[0] : undefined;
    const topIntent = typeof top?.intent === "string" ? top.intent : "unknown";
    const topTags = Array.isArray(top?.tags) ? top.tags.filter((t): t is string => typeof t === "string") : [];
    const confidence = typeof top?.confidence?.value === "number" ? top.confidence.value : 0;

    const intentScore = intent ? (topIntent === intent ? 1 : 0) : 0.5;
    const overlappingTags = topTags.filter((t: string) => tags.includes(t)).length;
    const tagOverlap = tags.length > 0
      ? Math.min(1, overlappingTags / Math.max(1, tags.length))
      : 0.5;
    const ageMs = now - new Date(m.createdAt).getTime();
    const recency = Math.max(0, 1 - ageMs / (1000 * 60 * 60 * 24 * 30));

    const score =
      SEARCH_SCORE_WEIGHTS.intent * intentScore +
      SEARCH_SCORE_WEIGHTS.tags * tagOverlap +
      SEARCH_SCORE_WEIGHTS.confidence * confidence +
      SEARCH_SCORE_WEIGHTS.recency * recency;

    const summary =
      typeof m.original?.intent === "string"
        ? m.original.intent
        : typeof m.original?.type === "string"
          ? m.original.type
          : JSON.stringify(m.original ?? "").slice(0, 160);

    return {
      id: String(m._id),
      summary,
      score,
      usage: typeof m.usageCount === "number" ? m.usageCount : 0,
      intent: topIntent,
      tags: topTags,
      confidence,
      agentId: typeof m.agentId === "string" ? m.agentId : "anonymous",
      createdAt: new Date(m.createdAt).toISOString(),
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

  const updated = await MessageModel.findByIdAndUpdate(
    id,
    { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
    { new: true }
  ).lean<MessageLean | null>();

  if (!updated) {
    throw new Error("Message not found");
  }

  return {
    id: String(updated._id),
    usageCount: typeof updated.usageCount === "number" ? updated.usageCount : 0,
    lastUsedAt: new Date(updated.lastUsedAt ?? updated.updatedAt ?? Date.now()).toISOString(),
  };
}

function loadSearchScoreWeights() {
  const defaults = {
    intent: 0.45,
    tags: 0.25,
    confidence: 0.20,
    recency: 0.10,
  } as const;

  const configured = {
    intent: parseWeight(process.env.SEARCH_SCORE_WEIGHT_INTENT, defaults.intent),
    tags: parseWeight(process.env.SEARCH_SCORE_WEIGHT_TAGS, defaults.tags),
    confidence: parseWeight(process.env.SEARCH_SCORE_WEIGHT_CONFIDENCE, defaults.confidence),
    recency: parseWeight(process.env.SEARCH_SCORE_WEIGHT_RECENCY, defaults.recency),
  };

  const total =
    configured.intent +
    configured.tags +
    configured.confidence +
    configured.recency;

  if (total <= 0) return defaults;

  return {
    intent: configured.intent / total,
    tags: configured.tags / total,
    confidence: configured.confidence / total,
    recency: configured.recency / total,
  };
}

function parseWeight(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
