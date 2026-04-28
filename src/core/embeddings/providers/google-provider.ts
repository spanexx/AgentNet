/*
 * Code Map: Google Generative AI Embedding Provider
 * - GoogleProvider: Generates embeddings via Google text-embedding-004
 *
 * CID Index:
 * CID:google-prov-001 -> GoogleProvider
 *
 * Quick lookup: rg -n "CID:google-prov-" src/core/embeddings/providers/google-provider.ts
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { EmbeddingProvider, EmbeddingResult, PROVIDER_DIMENSIONS } from "../types";

// CID:google-prov-001 - GoogleProvider
// Purpose: Produce 768-dim embeddings via Google Generative AI (30% weight fallback provider)
// Uses: @google/generative-ai SDK, EmbeddingProvider interface
// Used by: ensemble.ts
export class GoogleProvider implements EmbeddingProvider {
  readonly name = "google" as const;
  readonly dimension = PROVIDER_DIMENSIONS.google;

  private genAI: GoogleGenerativeAI | null = null;
  private readonly model: string;

  constructor(model = "text-embedding-004") {
    this.model = model;
  }

  private getGenAI(): GoogleGenerativeAI {
    if (!this.genAI) {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now();
    try {
      const genAI = this.getGenAI();
      const embedModel = genAI.getGenerativeModel({ model: this.model });
      const result = await embedModel.embedContent(text);
      const vector = result.embedding.values;
      return {
        provider: this.name,
        vector,
        dimension: vector.length,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        provider: this.name,
        vector: [],
        dimension: 0,
        latencyMs: Date.now() - start,
        error: err?.message ?? String(err),
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!process.env.GOOGLE_API_KEY) return false;
      this.getGenAI();
      return true;
    } catch {
      return false;
    }
  }
}
