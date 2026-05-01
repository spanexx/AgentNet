/*
 * Code Map: Ollama Embedding Provider
 * - OllamaProvider: Generates embeddings via local Ollama server
 *
 * CID Index:
 * CID:ollama-prov-001 -> OllamaProvider
 *
 * Quick lookup: rg -n "CID:ollama-prov-" src/core/embeddings/providers/ollama-provider.ts
 */

import { EmbeddingProvider, EmbeddingResult } from "../types";

const MODEL_DIMENSIONS: Record<string, number> = {
  "mxbai-embed-large": 1024,
  "nomic-embed-text": 768,
};

// CID:ollama-prov-001 - OllamaProvider
// Purpose: Produce local embeddings through Ollama using embedding-native models
// Uses: fetch, EmbeddingProvider interface
// Used by: ensemble.ts, tests
export class OllamaProvider implements EmbeddingProvider {
  readonly name = "local" as const;
  readonly dimension: number;

  private readonly host: string;
  private readonly model: string;

  constructor(
    host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    model = process.env.OLLAMA_EMBEDDING_MODEL ?? "mxbai-embed-large"
  ) {
    this.host = host.replace(/\/+$/, "");
    this.model = model;
    this.dimension = MODEL_DIMENSIONS[model] ?? 1024;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.host}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`${response.status} ${detail}`.trim());
      }

      const payload = await response.json() as { embedding?: number[] };
      const vector = Array.isArray(payload.embedding) ? payload.embedding : [];
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error(`Ollama returned invalid embedding payload for model ${this.model}`);
      }

      return {
        provider: this.name,
        vector,
        dimension: vector.length,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
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
      const response = await fetch(`${this.host}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
