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

export type SolutionOutcomeStatus = "pending" | "validated" | "reused" | "failed";

export type SolutionOutcome = {
  status: SolutionOutcomeStatus;
  summary: string;
  metrics?: Record<string, number>;
  evidence?: Record<string, unknown>;
};

export type SolutionRecord = {
  problem: string;
  approach: string;
  variant: string;
  outcome: SolutionOutcome;
};

// CID:protocol-001 - AgentMessage
// Purpose: Define flexible message schema for agent intake
// Uses: Record (TypeScript builtin)
// Used by: normalizeMessage, routes API handlers
export type AgentMessage = {
  agentId?: string;
  type: string;
  intent?: string;
  data?: Record<string, any>;
  extra?: Record<string, any>;
  solution?: {
    problem?: string;
    approach?: string;
    variant?: string;
    outcome?: Partial<SolutionOutcome>;
  };
};

// CID:protocol-002 - MessageType
// Purpose: Standardized message type constants for client callers
// Uses: Literal types
// Used by: message validation, intent routing
export type MessageType = 'INTENT_REQUEST' | 'QUERY' | 'ACTION' | 'FEEDBACK';
