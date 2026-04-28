/*
 * Code Map: Semantic Space Storage Schema
 * - SemanticClusterSchema: Unified MongoDB schema for semantic clusters (replaces intents + tags)
 * - SemanticClusterModel: Compiled model for cluster CRUD
 * - SemanticClusterDoc: TypeScript interface for cluster documents
 *
 * CID Index:
 * CID:sem-space-001 -> SemanticClusterSchema
 * CID:sem-space-002 -> SemanticClusterModel
 *
 * Quick lookup: rg -n "CID:sem-space-" src/models/SemanticCluster.ts
 */

import mongoose, { Schema, Document } from "mongoose";

// CID:sem-space-001 - SemanticClusterSchema
// Purpose: Define MongoDB schema for unified semantic space — clusters, not fixed intents
// Uses: mongoose.Schema
// Used by: SemanticClusterModel, semantic-space engine, seed-loader
const SemanticClusterSchema = new Schema(
  {
    /** Human-readable label for this cluster */
    label: {
      type: String,
      required: true,
      trim: true,
    },
    /** Cluster type — intent clusters and tag clusters coexist in the same space */
    kind: {
      type: String,
      enum: ["intent", "tag"],
      required: true,
    },
    /** Centroid vector — the center of the cluster, continuously updated */
    centroid: {
      type: [Number],
      default: [],
    },
    /** Number of points (messages) assigned to this cluster */
    density: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Representative text samples for this cluster */
    exemplars: {
      type: [String],
      default: [],
    },
    /** Source of the cluster origin */
    source: {
      type: String,
      enum: ["seed", "learned"],
      required: true,
    },
    /** How many times this cluster has been matched (frequency signal) */
    frequency: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** When this cluster was first discovered */
    discoveredAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    indexes: [
      { label: 1, kind: 1, unique: true },
      { kind: 1 },
      { source: 1 },
      { frequency: -1 },
      { density: -1 },
    ],
  }
);

export interface SemanticClusterDoc extends Document {
  label: string;
  kind: "intent" | "tag";
  centroid: number[];
  density: number;
  exemplars: string[];
  source: "seed" | "learned";
  frequency: number;
  discoveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// CID:sem-space-002 - SemanticClusterModel
// Purpose: Compiled Mongoose model for semantic cluster operations
// Uses: mongoose.model, SemanticClusterSchema
// Used by: semantic-space engine, seed-loader
export const SemanticClusterModel = mongoose.model<SemanticClusterDoc>(
  "SemanticCluster",
  SemanticClusterSchema
);
