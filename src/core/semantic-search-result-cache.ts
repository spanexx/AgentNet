/*
 * Code Map: Semantic Search Result Cache
 * - getCachedSemanticSearchResult: Return cached semantic search payload by normalized query window
 * - setCachedSemanticSearchResult: Store short-lived search result payload
 * - clearSemanticSearchResultCache: Manual/global invalidation helper
 *
 * CID Index:
 * CID:sem-search-cache-001 -> getCachedSemanticSearchResult
 * CID:sem-search-cache-002 -> setCachedSemanticSearchResult
 * CID:sem-search-cache-003 -> clearSemanticSearchResultCache
 */

export interface SemanticSearchCacheKey {
  q: string;
  limit: number;
  skip: number;
}

export interface CachedSemanticSearchResult {
  count?: number;
  query?: Record<string, unknown> | null;
  emptyReason?: string | null;
  data?: Array<Record<string, unknown>>;
  results: Array<{ id: string; score: number }>;
  total: number;
  limit: number;
  skip: number;
}

interface CacheEntry {
  value: CachedSemanticSearchResult;
  expiresAt: number;
  lastAccessedAt: number;
}

const RESULT_CACHE_TTL_MS = Number(process.env.SEMANTIC_RESULT_CACHE_TTL_MS ?? "30000");
const RESULT_CACHE_MAX_ENTRIES = Number(process.env.SEMANTIC_RESULT_CACHE_MAX_ENTRIES ?? "250");

const cache = new Map<string, CacheEntry>();

// CID:sem-search-cache-001
export function getCachedSemanticSearchResult(
  key: SemanticSearchCacheKey
): CachedSemanticSearchResult | null {
  const normalizedKey = buildKey(key);
  const entry = cache.get(normalizedKey);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(normalizedKey);
    return null;
  }

  entry.lastAccessedAt = Date.now();
  return {
    ...entry.value,
    query: entry.value.query ? { ...entry.value.query } : entry.value.query ?? null,
    emptyReason: entry.value.emptyReason ?? null,
    data: entry.value.data?.map((item) => ({ ...item })),
    results: entry.value.results.map((result) => ({ ...result })),
  };
}

// CID:sem-search-cache-002
export function setCachedSemanticSearchResult(
  key: SemanticSearchCacheKey,
  value: CachedSemanticSearchResult
): void {
  const now = Date.now();
  cache.set(buildKey(key), {
    value: {
      ...value,
      query: value.query ? { ...value.query } : value.query ?? null,
      emptyReason: value.emptyReason ?? null,
      data: value.data?.map((item) => ({ ...item })),
      results: value.results.map((result) => ({ ...result })),
    },
    expiresAt: now + RESULT_CACHE_TTL_MS,
    lastAccessedAt: now,
  });

  evictIfNeeded();
}

// CID:sem-search-cache-003
export function clearSemanticSearchResultCache(): void {
  cache.clear();
}

function buildKey(key: SemanticSearchCacheKey): string {
  const query = key.q.trim().toLowerCase().replace(/\s+/g, " ");
  return `${query}::${key.limit}::${key.skip}`;
}

function evictIfNeeded(): void {
  if (cache.size <= RESULT_CACHE_MAX_ENTRIES) return;

  const oldest = [...cache.entries()]
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)
    .slice(0, cache.size - RESULT_CACHE_MAX_ENTRIES);

  for (const [key] of oldest) {
    cache.delete(key);
  }
}
