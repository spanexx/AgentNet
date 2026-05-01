/*
 * Code Map: Embedding Runtime Diagnostics
 * - getEmbeddingRuntimeStatus: Summarize runtime embedding provider configuration + availability
 *
 * CID Index:
 * CID:emb-runtime-001 -> getEmbeddingRuntimeStatus
 *
 * Quick lookup: rg -n "CID:emb-runtime-" src/core/embedding-runtime.ts
 */

import { PROVIDER_DIMENSIONS, ProviderName } from "./embeddings";
import { getEnsemble } from "./normalize";

export type EmbeddingRuntimeMode =
  | "real_provider_available"
  | "local_only"
  | "configured_but_unavailable"
  | "fallback_only";

export interface EmbeddingProviderRuntimeStatus {
  configured: boolean;
  available: boolean;
  dimension: number;
  kind: "remote" | "local";
}

export interface EmbeddingRuntimeStatus {
  mode: EmbeddingRuntimeMode;
  realProviderAvailable: boolean;
  configuredProviders: ProviderName[];
  availableProviders: ProviderName[];
  providers: Record<ProviderName, EmbeddingProviderRuntimeStatus>;
}

const PROVIDER_ORDER: ProviderName[] = ["openai", "google", "local"];
const REAL_PROVIDERS = new Set<ProviderName>(["openai", "google"]);

// CID:emb-runtime-001 - getEmbeddingRuntimeStatus
// Purpose: Report whether semantic search has live embedding providers or is running degraded
// Uses: getEnsemble().checkAvailability, env configuration, provider metadata
// Used by: server health endpoint, startup diagnostics
export async function getEmbeddingRuntimeStatus(): Promise<EmbeddingRuntimeStatus> {
  const availability = await getEnsemble().checkAvailability();

  const providers = PROVIDER_ORDER.reduce<Record<ProviderName, EmbeddingProviderRuntimeStatus>>(
    (acc, name) => {
      const configured = isProviderConfigured(name);
      acc[name] = {
        configured,
        available: availability[name] ?? false,
        dimension: PROVIDER_DIMENSIONS[name],
        kind: name === "local" ? "local" : "remote",
      };
      return acc;
    },
    {} as Record<ProviderName, EmbeddingProviderRuntimeStatus>
  );

  const configuredProviders = PROVIDER_ORDER.filter((name) => providers[name].configured);
  const availableProviders = PROVIDER_ORDER.filter((name) => providers[name].available);
  const realProviderAvailable = PROVIDER_ORDER.some(
    (name) => REAL_PROVIDERS.has(name) && providers[name].available
  );

  return {
    mode: classifyRuntimeMode(providers, configuredProviders.length, realProviderAvailable),
    realProviderAvailable,
    configuredProviders,
    availableProviders,
    providers,
  };
}

function classifyRuntimeMode(
  providers: Record<ProviderName, EmbeddingProviderRuntimeStatus>,
  configuredCount: number,
  realProviderAvailable: boolean
): EmbeddingRuntimeMode {
  if (realProviderAvailable) return "real_provider_available";
  if (providers.local.available) return "local_only";
  if (configuredCount > 0) return "configured_but_unavailable";
  return "fallback_only";
}

function isProviderConfigured(name: ProviderName): boolean {
  if (name === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (name === "google") {
    return Boolean(process.env.GOOGLE_API_KEY);
  }

  // Local embeddings now default to Ollama; env can still override host/model explicitly.
  return Boolean(
    process.env.OLLAMA_HOST ||
    process.env.OLLAMA_EMBEDDING_MODEL ||
    process.env.LOCAL_EMBEDDING_URL
  );
}
