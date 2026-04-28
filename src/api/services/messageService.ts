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

import { MessageModel } from "../../models/Message";
import { normalizeMessage, NormalizedMessage } from "../../core/normalize";
import { AgentMessage } from "../../types/protocol";

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
    source: "api"
  });

  // Determine degradation: fewer than 3 providers = degraded
  const degraded = normalized.providersUsed.length < 3;

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
    return { type: "INTENT_REQUEST", intent: raw.text, data: raw.data as Record<string, unknown> | undefined };
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

  // Intent is optional, but if provided must be string
  if (msg.intent && typeof msg.intent !== "string") {
    throw new Error("Field 'intent' must be a string");
  }

  // Data is optional, but if provided must be object
  if (msg.data && typeof msg.data !== "object") {
    throw new Error("Field 'data' must be an object");
  }
}
