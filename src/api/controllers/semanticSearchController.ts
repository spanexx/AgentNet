/*
 * Code Map: Semantic Search Controller — HTTP Handler Layer
 * - semanticSearch: Handle GET /api/semantic-search requests
 *
 * CID Index:
 * CID:sem-search-ctrl-001 -> semanticSearch
 *
 * Quick lookup: rg -n "CID:sem-search-ctrl-" src/api/controllers/semanticSearchController.ts
 */

import { Request, Response } from "express";
import { interpretQuery } from "../../core/query-understanding";
import { searchSolutions } from "../../core/solution-retrieval";
import {
  getCachedSemanticSearchResult,
  setCachedSemanticSearchResult,
} from "../../core/semantic-search-result-cache";

// CID:sem-search-ctrl-001 - semanticSearch
// Purpose: HTTP GET handler for semantic search — free-text query → ranked solutions
// Uses: interpretQuery, searchSolutions
// Used by: GET /api/semantic-search route
export async function semanticSearch(req: Request, res: Response) {
  try {
    const rawQuery = req.query.q;
    if (!rawQuery || typeof rawQuery !== "string" || rawQuery.trim().length === 0) {
      res.status(400).json({
        error: "Missing required query parameter: q",
        hint: "Example: GET /api/semantic-search?q=tauri+desktop+app",
      });
      return;
    }

    const limitParam = req.query.limit;
    const skipParam = req.query.skip;
    const limit = limitParam ? parseInt(String(limitParam), 10) : 25;
    const skip = skipParam ? parseInt(String(skipParam), 10) : 0;

    if (!Number.isFinite(limit) || limit <= 0) {
      res.status(400).json({ error: "limit must be a positive integer" });
      return;
    }

    if (!Number.isFinite(skip) || skip < 0) {
      res.status(400).json({ error: "skip must be a non-negative integer" });
      return;
    }

    const cacheKey = { q: rawQuery.trim(), limit, skip };
    const cached = getCachedSemanticSearchResult(cacheKey);
    if (cached) {
      res.json({
        count: cached.count ?? cached.results.length,
        total: cached.total,
        limit: cached.limit,
        skip: cached.skip,
        query: cached.query ?? null,
        emptyReason: cached.emptyReason ?? null,
        data: cached.data ?? [],
      });
      return;
    }

    // Step 1: Interpret the free-text query
    console.log(`[semantic-search] Interpreting query: "${rawQuery.trim()}"`);
    const query = await interpretQuery(rawQuery.trim());
    console.log(`[semantic-search] Interpreted: intent=${query.interpretedIntent}, tags=[${query.interpretedTags.join(",")}], degraded=${query.degraded}`);

    // Step 2: Search solutions using interpreted query
    const result = await searchSolutions({ query, limit, skip });

    console.log(`[semantic-search] Results: ${result.results.length} of ${result.total}${result.emptyReason ? `, reason=${result.emptyReason}` : ""}`);

    const responseBody = {
      count: result.results.length,
      total: result.total,
      limit: result.limit,
      skip: result.skip,
      query: result.query,
      emptyReason: result.emptyReason ?? null,
      data: result.results.map((item) => ({
        id: item.id,
        summary: item.summary,
        score: item.score,
        usage: item.usage,
        intent: item.intent,
        tags: item.tags,
        confidence: item.confidence,
        agentId: item.agentId,
        createdAt: item.createdAt,
        reputation: item.reputation,
        solution: item.solution,
        explanation: item.explanation,
      })),
    };

    setCachedSemanticSearchResult(cacheKey, {
      count: responseBody.count,
      total: responseBody.total,
      limit: responseBody.limit,
      skip: responseBody.skip,
      query: responseBody.query,
      emptyReason: responseBody.emptyReason,
      data: responseBody.data,
      results: responseBody.data.map((item) => ({
        id: String(item.id),
        score: typeof item.score === "number" ? item.score : 0,
      })),
    });

    res.json(responseBody);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[semantic-search] Error:", error.message);
    res.status(500).json({ error: "Semantic search failed" });
  }
}
