/*
 * Code Map: OpenAI Embedding Provider
 * - OpenAIProvider: Generates embeddings via OpenAI text-embedding-3-small
 *
 * CID Index:
 * CID:openai-prov-001 -> OpenAIProvider
 *
 * Quick lookup: rg -n "CID:openai-prov-" src/core/embeddings/providers/openai-provider.ts
 */

import OpenAI from "openai";
import { EmbeddingProvider, EmbeddingResult, PROVIDER_DIMENSIONS } from "../types";

// CID:openai-prov-001 - OpenAIProvider
// Purpose: Produce 1536-dim embeddings via OpenAI API (60% weight primary provider)
// Uses: openai SDK, EmbeddingProvider interface
// Used by: ensemble.ts
export class OpenAIProvider implements EmbeddingProvider {
  readonly name = "openai" as const;
  readonly dimension = PROVIDER_DIMENSIONS.openai;

  private client: OpenAI | null = null;
  private readonly model: string;
  private disabledReason: string | null = null;

  constructor(model = "text-embedding-3-small") {
    this.model = model;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now();
    try {
      const client = this.getClient();
      const resp = await client.embeddings.create({
        model: this.model,
        input: text,
      });
      const vector = resp.data[0].embedding;
      return {
        provider: this.name,
        vector,
        dimension: vector.length,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      const error = err?.message ?? String(err);
      if (isFatalOpenAIError(error)) {
        this.disabledReason = error;
      }
      return {
        provider: this.name,
        vector: [],
        dimension: 0,
        latencyMs: Date.now() - start,
        error,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (this.disabledReason) return false;
      if (!process.env.OPENAI_API_KEY) return false;
      this.getClient();
      return true;
    } catch {
      return false;
    }
  }
}

function isFatalOpenAIError(error: string): boolean {
  return (
    error.includes("Incorrect API key") ||
    error.includes("invalid_api_key") ||
    error.includes("401") ||
    error.includes("model_not_found")
  );
}
