/*
 * Code Map: Local Embedding Provider (ONNX Sidecar)
 * - LocalProvider: Generates embeddings via local sentence-transformers sidecar
 *
 * CID Index:
 * CID:local-prov-001 -> LocalProvider
 *
 * Quick lookup: rg -n "CID:local-prov-" src/core/embeddings/providers/local-provider.ts
 */

import axios, { AxiosInstance } from "axios";
import { EmbeddingProvider, EmbeddingResult, PROVIDER_DIMENSIONS } from "../types";

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8100";

// CID:local-prov-001 - LocalProvider
// Purpose: Produce 384-dim embeddings via local ONNX sidecar (10% weight, always-available fallback)
// Uses: axios, EmbeddingProvider interface
// Used by: ensemble.ts
export class LocalProvider implements EmbeddingProvider {
  readonly name = "local" as const;
  readonly dimension = PROVIDER_DIMENSIONS.local;

  private client: AxiosInstance;

  constructor(sidecarUrl = process.env.LOCAL_EMBEDDING_URL ?? DEFAULT_SIDECAR_URL) {
    this.client = axios.create({
      baseURL: sidecarUrl,
      timeout: 10_000,
    });
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const start = Date.now();
    try {
      const resp = await this.client.post("/embed", { text });
      const vector: number[] = resp.data.embedding;
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
        error: err?.response?.data?.detail ?? err?.message ?? String(err),
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await this.client.get("/health", { timeout: 2_000 });
      return resp.status === 200;
    } catch {
      return false;
    }
  }
}
