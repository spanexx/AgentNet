/*
 * Code Map: Agent Protocol Types
 * - AgentMessage: Flexible message format for agent communication
 * - MessageType: Enumeration of supported message types
 *
 * CID Index:
 * CID:protocol-001 -> AgentMessage
 * CID:protocol-002 -> MessageType
 *
 * Quick lookup: rg -n "CID:protocol-" src/types/protocol.ts
 */

// CID:protocol-001 - AgentMessage
// Purpose: Define flexible message schema for agent intake
// Uses: Record (TypeScript builtin)
// Used by: normalizeMessage, routes API handlers
export type AgentMessage = {
  type: string;
  intent?: string;
  data?: Record<string, any>;
  extra?: Record<string, any>;
};

// CID:protocol-002 - MessageType
// Purpose: Standardized message type constants for client callers
// Uses: Literal types
// Used by: message validation, intent routing
export type MessageType = 'INTENT_REQUEST' | 'QUERY' | 'ACTION' | 'FEEDBACK';
