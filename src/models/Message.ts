/*
 * Code Map: Message Storage Schema
 * - MessageSchema: Mongoose schema for storing raw + normalized agent messages
 * - MessageModel: Compiled message collection model
 * - MessageDoc: TypeScript interface for stored documents
 *
 * CID Index:
 * CID:message-001 -> MessageSchema
 * CID:message-002 -> MessageModel
 *
 * Quick lookup: rg -n "CID:message-" src/models/Message.ts
 */

import mongoose, { Schema, Document } from "mongoose";

// CID:message-001 - MessageSchema
// Purpose: Define MongoDB schema to persist raw and normalized agent messages
// Uses: mongoose.Schema, Date
// Used by: MessageModel, API storage operations
const MessageSchema = new Schema(
  {
    // Original incoming message (preserved for audit/replay)
    original: {
      type: Schema.Types.Mixed,
      required: true
    },

    // Normalized form (SDG multi-hypothesis)
    normalized: {
      hypotheses: [{
        intent: String,
        tags: [String],
        confidence: {
          value: Number,
          density: Number,
          agreement: Number,
          distance: Number,
        },
        source: String,
      }],
      constraints: Schema.Types.Mixed,
      providersUsed: [String],
      degraded: Boolean,
    },

    // Metadata
    agentId: {
      type: String,
      default: "anonymous"
    },
    usageCount: {
      type: Number,
      default: 0
    },
    lastUsedAt: {
      type: Date
    },
    source: {
      type: String,
      default: "api"
    },
    version: {
      type: String,
      default: "0.2.0"
    }
  },
  {
    timestamps: true,
    indexes: [
      { "normalized.hypotheses.intent": 1 },
      { "normalized.hypotheses.tags": 1 },
      { createdAt: -1 }
    ]
  }
);

export interface MessageDoc extends Document {
  original: Record<string, any>;
  normalized: {
    hypotheses: Array<{
      intent: string;
      tags: string[];
      confidence: {
        value: number;
        density: number;
        agreement: number;
        distance: number;
      };
      source: string;
    }>;
    constraints: Record<string, any>;
    providersUsed: string[];
    degraded: boolean;
  };
  agentId: string;
  usageCount: number;
  lastUsedAt?: Date;
  source: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

// CID:message-002 - MessageModel
// Purpose: Compiled Mongoose model for CRUD operations on messages
// Uses: mongoose.model, MessageSchema
// Used by: API routes, queries
export const MessageModel = mongoose.model<MessageDoc>("Message", MessageSchema);
