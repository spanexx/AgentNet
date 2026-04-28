/*
 * Code Map: Google Generative AI Embedding Provider
 * - GoogleProvider: Generates embeddings via Google text-embedding-004
 *
 * CID Index:
 * CID:google-prov-001 -> GoogleProvider
 *
 * Quick lookup: rg -n "CID:google-prov-" src/core/embeddings/providers/google-provider.ts
 */

import { GoogleGenAI } from "@google/genai";
import { EmbeddingProvider, EmbeddingResult, PROVIDER_DIMENSIONS } from "../types";

const DEFAULT_GOOGLE_MODEL = process.env.GOOGLE_EMBEDDING_MODEL ?? "gemini-embedding-001";
const DEFAULT_OUTPUT_DIMENSION = PROVIDER_DIMENSIONS.google;

// CID:google-prov-001 - GoogleProvider
// Purpose: Produce embeddings via the Google GenAI SDK (30% weight fallback provider)
// Uses: @google/genai SDK, EmbeddingProvider interface
// Used by: ensemble.ts
export class GoogleProvider implements EmbeddingProvider {
  readonly name = "google" as const;
  readonly dimension: number;

  private client: GoogleGenAI | null = null;
  private readonly model: string;
  private readonly outputDimensionality?: number;
  private disabledReason: string | null = null;

  constructor(model = DEFAULT_GOOGLE_MODEL) {
    this.model = model;
    this.outputDimensionality = parseOutputDimensionality(
      process.env.GOOGLE_EMBEDDING_DIMENSION
    );
    this.dimension = this.outputDimensionality ?? DEFAULT_OUTPUT_DIMENSION;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now();
    try {
      const client = this.getClient();
      const result = await client.models.embedContent({
        model: this.model,
        contents: text,
        config: this.outputDimensionality
          ? { outputDimensionality: this.outputDimensionality }
          : undefined,
      });
      const vector = result.embeddings?.[0]?.values ?? [];
      if (vector.length === 0) {
        throw new Error("Google embedding response contained no vector");
      }
      return {
        provider: this.name,
        vector,
        dimension: vector.length,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      const error = err?.message ?? String(err);
      if (isFatalGoogleError(error)) {
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
      if (!process.env.GOOGLE_API_KEY) return false;
      this.getClient();
      return true;
    } catch {
      return false;
    }
  }
}

function parseOutputDimensionality(raw?: string): number | undefined {
  if (!raw) return DEFAULT_OUTPUT_DIMENSION;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OUTPUT_DIMENSION;
}

function isFatalGoogleError(error: string): boolean {
  return (
    error.includes("API key not valid") ||
    error.includes("API_KEY_INVALID") ||
    error.includes("not supported for embedContent") ||
    error.includes("is not found")
  );
}
