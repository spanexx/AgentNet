import mongoose, { Schema, Document } from "mongoose";
import { SolutionOutcomeStatus } from "../types/protocol";

const SolutionSchema = new Schema(
  {
    problem: {
      type: String,
      required: true,
    },
    approach: {
      type: String,
      required: true,
    },
    variant: {
      type: String,
      required: true,
    },
    outcome: {
      status: {
        type: String,
        enum: ["pending", "validated", "reused", "failed"] satisfies SolutionOutcomeStatus[],
        required: true,
      },
      summary: {
        type: String,
        required: true,
      },
      metrics: {
        type: Schema.Types.Mixed,
      },
      evidence: {
        type: Schema.Types.Mixed,
      },
    },
    agentId: {
      type: String,
      default: "anonymous",
      index: true,
    },
    sourceMessageIds: {
      type: [Schema.Types.ObjectId],
      default: [],
      ref: "Message",
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    lastUsedAt: {
      type: Date,
    },
    version: {
      type: String,
      default: "0.3.0",
    },
  },
  {
    timestamps: true,
    indexes: [
      { agentId: 1, createdAt: -1 },
      { "outcome.status": 1 },
      { problem: 1, approach: 1, variant: 1 },
    ],
  }
);

export interface SolutionDoc extends Document {
  problem: string;
  approach: string;
  variant: string;
  outcome: {
    status: SolutionOutcomeStatus;
    summary: string;
    metrics?: Record<string, number>;
    evidence?: Record<string, unknown>;
  };
  agentId: string;
  sourceMessageIds: mongoose.Types.ObjectId[];
  usageCount: number;
  lastUsedAt?: Date;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

export const SolutionModel = mongoose.model<SolutionDoc>("Solution", SolutionSchema);
