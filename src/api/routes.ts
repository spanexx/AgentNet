/*
 * Code Map: AgentNet REST API Routes
 * - Message Routes: Wire HTTP endpoints to controllers
 * - setupRoutes: Initialize Express router with all message endpoints
 *
 * CID Index:
 * CID:routes-001 -> POST /message
 * CID:routes-002 -> GET /messages
 * CID:routes-003 -> setupRoutes
 *
 * Quick lookup: rg -n "CID:routes-" src/api/routes.ts
 */

import express from "express";
import { createMessage, getMessages } from "./controllers/messageController";

const router = express.Router();

// CID:routes-001 - POST /message
// Purpose: Route message creation requests to controller
// Uses: createMessage controller
// Used by: Express app
router.post("/message", createMessage);

// CID:routes-002 - GET /messages
// Purpose: Route message retrieval requests to controller
// Uses: getMessages controller
// Used by: Express app
router.get("/messages", getMessages);

// CID:routes-003 - setupRoutes
// Purpose: Export configured router for app consumption
// Uses: express.Router
// Used by: src/index.ts
export default router;
