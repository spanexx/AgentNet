/*
 * Code Map: Message Controller — HTTP Handler Layer
 * - createMessage: Handle POST /message requests
 * - getMessages: Handle GET /messages requests
 * - handleErrors: Centralized error response formatting
 *
 * CID Index:
 * CID:msg-ctrl-001 -> createMessage
 * CID:msg-ctrl-002 -> getMessages
 * CID:msg-ctrl-003 -> handleErrors
 *
 * Quick lookup: rg -n "CID:msg-ctrl-" src/api/controllers/messageController.ts
 */

import { Request, Response } from "express";
import {
  storeMessage,
  getAllMessages,
  getAllSolutions,
  searchMessages,
  markMessageUsed,
  updateMessageOutcome,
} from "../services/messageService";

// CID:msg-ctrl-001 - createMessage
// Purpose: HTTP POST handler — accept { text } or AgentMessage, return multi-hypothesis SDG response
// Uses: storeMessage, Request, Response, handleErrors
// Used by: POST /api/message route
export async function createMessage(req: Request, res: Response) {
  try {
    const result = await storeMessage(req.body);

    // SDG multi-hypothesis response
    const response: Record<string, unknown> = {
      status: "success",
      data: {
        id: result.id,
        original: result.original,
        normalized: {
          hypotheses: result.normalized.hypotheses.map((h) => ({
            intent: h.intent,
            tags: h.tags,
            confidence: h.confidence.value,
            confidence_detail: {
              density: h.confidence.density,
              agreement: h.confidence.agreement,
              distance: h.confidence.distance,
            },
            source: h.source,
          })),
          constraints: result.normalized.constraints,
          providers_used: result.normalized.providersUsed,
        },
        solution: result.solution,
        timestamp: result.timestamp,
      },
    };

    if (result.degraded) {
      (response.data as Record<string, unknown>).degraded = true;
      (response.data as Record<string, unknown>).available_providers = result.normalized.providersUsed.length;
    }

    res.status(201).json(response);
  } catch (err) {
    handleErrors(err, res);
  }
}

// CID:msg-ctrl-002 - getMessages
// Purpose: HTTP GET handler — extract query params, call service, format response
// Uses: getAllMessages, Request, Response, handleErrors
// Used by: GET /api/messages route
export async function getMessages(req: Request, res: Response) {
  try {
    const { intent, limit, skip } = req.query;

    const result = await getAllMessages({
      intent: intent ? String(intent) : undefined,
      limit: limit ? parseInt(String(limit)) : 100,
      skip: skip ? parseInt(String(skip)) : 0
    });

    res.json({
      count: result.messages.length,
      total: result.total,
      limit: result.limit,
      skip: result.skip,
      data: result.messages
    });
  } catch (err) {
    handleErrors(err, res);
  }
}

export async function search(req: Request, res: Response) {
  try {
    const { intent, tags, limit, skip } = req.query;
    const parsedTags =
      typeof tags === "string"
        ? tags.split(",").map((t) => t.trim()).filter(Boolean)
        : Array.isArray(tags)
          ? tags.map((t) => String(t).trim()).filter(Boolean)
          : [];

    const result = await searchMessages({
      intent: intent ? String(intent) : undefined,
      tags: parsedTags,
      limit: limit ? parseInt(String(limit)) : 25,
      skip: skip ? parseInt(String(skip)) : 0
    });

    res.json({
      count: result.results.length,
      total: result.total,
      limit: result.limit,
      skip: result.skip,
      data: result.results
    });
  } catch (err) {
    handleErrors(err, res);
  }
}

export async function getSolutions(req: Request, res: Response) {
  try {
    const { agentId, limit, skip } = req.query;

    const result = await getAllSolutions({
      agentId: agentId ? String(agentId) : undefined,
      limit: limit ? parseInt(String(limit)) : 100,
      skip: skip ? parseInt(String(skip)) : 0,
    });

    res.json({
      count: result.solutions.length,
      total: result.total,
      limit: result.limit,
      skip: result.skip,
      data: result.solutions,
    });
  } catch (err) {
    handleErrors(err, res);
  }
}

export async function useMessage(req: Request, res: Response) {
  try {
    const result = await markMessageUsed(req.params.id);
    res.json({
      status: "success",
      data: result,
    });
  } catch (err) {
    handleErrors(err, res);
  }
}

export async function updateOutcome(req: Request, res: Response) {
  try {
    const result = await updateMessageOutcome(req.params.id, req.body);
    res.json({
      status: "success",
      data: result,
    });
  } catch (err) {
    handleErrors(err, res);
  }
}

// CID:msg-ctrl-003 - handleErrors
// Purpose: Centralized error response formatting (validation, not found, server errors)
// Uses: Error, Response
// Used by: createMessage, getMessages
function handleErrors(err: unknown, res: Response): void {
  const error = err instanceof Error ? err : new Error(String(err));

  // Validation errors (from service layer)
  if (error.message.includes("Missing required field")) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.message.includes("must be")) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.message.startsWith("solution")) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.message.startsWith("outcome update")) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.message.includes("Invalid message ID format")) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.message.includes("Cast to ObjectId failed")) {
    res.status(400).json({ error: "invalid message id" });
    return;
  }

  if (error.message.includes("not found")) {
    res.status(404).json({ error: error.message });
    return;
  }

  // Generic error logging and response
  console.error("Controller error:", error);
  res.status(500).json({ error: "failed to process request" });
}
