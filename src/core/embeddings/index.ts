/*
 * Code Map: Embeddings Barrel Export
 * - Re-exports all public types, providers, and ensemble from embeddings module
 *
 * CID Index: (none — barrel only)
 * Quick lookup: rg -n "CID:emb-" src/core/embeddings/
 */

export {
  ProviderName,
  EmbeddingProvider,
  EmbeddingResult,
  EnsembleResult,
  WeightProfile,
  AgreementScore,
  DEFAULT_WEIGHTS,
  WEIGHT_PRESETS,
  PROVIDER_DIMENSIONS,
} from "./types";

export { OpenAIProvider } from "./providers/openai-provider";
export { GoogleProvider } from "./providers/google-provider";
export { LocalProvider } from "./providers/local-provider";
export { OllamaProvider } from "./providers/ollama-provider";

export {
  cosineSimilarity,
  computeAgreement,
  calculateAdaptiveWeights,
  redistributeWeights,
} from "./weights";

export { EmbeddingEnsemble } from "./ensemble";
