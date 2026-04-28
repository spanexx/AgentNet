/*
 * Code Map: Embedding Cache Schema
 * - EmbeddingCacheSchema: Mongoose schema for persistent embedding cache
 * - EmbeddingCacheModel: Compiled cache collection model
 * - EmbeddingCacheDoc: TypeScript interface for cache documents
 *
 * CID Index:
 * CID:emb-cache-001 -> EmbeddingCacheSchema
 * CID:emb-cache-002 -> EmbeddingCacheModel
 *
 * Quick lookup: rg -n "CID:emb-cache-" src/models/EmbeddingCache.ts
 */

import mongoose, { Schema, Document } from "mongoose";

// CID:emb-cache-001 - EmbeddingCacheSchema
// Purpose: Define MongoDB schema for persistent embedding cache (Decision 9)
// Uses: mongoose.Schema
// Used by: EmbeddingCacheModel, ensemble cache layer
const EmbeddingCacheSchema = new Schema(
  {
    textHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    originalText: {
      type: String,
      required: true,
    },
    embeddings: {
      openai: [Number],
      google: [Number],
      local: [Number],
    },
    accessCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAccessedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
    indexes: [
      { textHash: 1 },
      { lastAccessedAt: -1 },
      { accessCount: -1 },
    ],
  }
);

export interface EmbeddingCacheDoc extends Document {
  textHash: string;
  originalText: string;
  embeddings: {
    openai?: number[];
    google?: number[];
    local?: number[];
  };
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

// CID:emb-cache-002 - EmbeddingCacheModel
// Purpose: Compiled Mongoose model for embedding cache CRUD
// Uses: mongoose.model, EmbeddingCacheSchema
// Used by: ensemble cache layer
export const EmbeddingCacheModel = mongoose.model<EmbeddingCacheDoc>(
  "EmbeddingCache",
  EmbeddingCacheSchema
);
