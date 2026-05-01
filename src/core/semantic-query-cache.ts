/*
 * Code Map: Semantic Query Cache
 * - getCachedSemanticQuery: Return cached semantic query for repeated free-text search
 * - setCachedSemanticQuery: Store semantic query with TTL and bounded size
 * - clearSemanticQueryCache: Test helper and manual reset
 *
 * CID Index:
 * CID:sem-query-cache-001 -> getCachedSemanticQuery
 * CID:sem-query-cache-002 -> setCachedSemanticQuery
 * CID:sem-query-cache-003 -> clearSemanticQueryCache
 */

import { ClusterMatch } from "./sdg";

export interface CachedSemanticQuery {
  originalText: string;
  interpretedIntent: string | null;
  interpretedTags: string[];
  vector: number[];
  confidence: number;
  providersUsed: string[];
  degraded: boolean;
  intentMatches: ClusterMatch[];
  tagMatches: ClusterMatch[];
}

interface CacheEntry {
  value: CachedSemanticQuery;
  expiresAt: number;
  lastAccessedAt: number;
}

const QUERY_CACHE_TTL_MS = Number(process.env.SEMANTIC_QUERY_CACHE_TTL_MS ?? "300000");
const QUERY_CACHE_MAX_ENTRIES = Number(process.env.SEMANTIC_QUERY_CACHE_MAX_ENTRIES ?? "500");

const cache = new Map<string, CacheEntry>();

// CID:sem-query-cache-001
export function getCachedSemanticQuery(text: string): CachedSemanticQuery | null {
  const key = normalizeQueryCacheKey(text);
  if (!key) return null;

  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  entry.lastAccessedAt = Date.now();
  return cloneCachedQuery(entry.value);
}

// CID:sem-query-cache-002
export function setCachedSemanticQuery(text: string, value: CachedSemanticQuery): void {
  const key = normalizeQueryCacheKey(text);
  if (!key) return;

  const now = Date.now();
  cache.set(key, {
    value: cloneCachedQuery(value),
    expiresAt: now + QUERY_CACHE_TTL_MS,
    lastAccessedAt: now,
  });

  evictIfNeeded();
}

// CID:sem-query-cache-003
export function clearSemanticQueryCache(): void {
  cache.clear();
}

function normalizeQueryCacheKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function cloneCachedQuery(value: CachedSemanticQuery): CachedSemanticQuery {
  return {
    ...value,
    interpretedTags: [...value.interpretedTags],
    vector: [...value.vector],
    providersUsed: [...value.providersUsed],
    intentMatches: value.intentMatches.map((match) => ({ ...match })),
    tagMatches: value.tagMatches.map((match) => ({ ...match })),
  };
}

function evictIfNeeded(): void {
  if (cache.size <= QUERY_CACHE_MAX_ENTRIES) return;

  const oldest = [...cache.entries()]
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)
    .slice(0, cache.size - QUERY_CACHE_MAX_ENTRIES);

  for (const [key] of oldest) {
    cache.delete(key);
  }
}
