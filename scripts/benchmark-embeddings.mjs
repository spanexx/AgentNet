import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: ".env.local" });
dotenv.config();

const GOOGLE_MODEL = process.env.GOOGLE_EMBEDDING_MODEL ?? "gemini-embedding-001";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const LOG_PATH = path.resolve(process.cwd(), "embeddings-benchmark.log");
const GOOGLE_CONCURRENCY = Number(process.env.BENCHMARK_GOOGLE_CONCURRENCY ?? "1");
const OLLAMA_CONCURRENCY = Number(process.env.BENCHMARK_OLLAMA_CONCURRENCY ?? "4");
const GOOGLE_MIN_INTERVAL_MS = Number(process.env.BENCHMARK_GOOGLE_MIN_INTERVAL_MS ?? "700");
let lastGoogleRequestAt = 0;

const BENCHMARK_CASES = [
  {
    id: "desktop-tauri",
    query: "tauri desktop app for cross platform tooling",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "React dashboard with analytics widgets for browser app" },
      { id: "d2", text: "Tauri desktop application shell for cross platform native tooling" },
      { id: "d3", text: "MongoDB indexing guide for query performance" },
      { id: "d4", text: "Authentication middleware for JWT refresh tokens" },
    ],
  },
  {
    id: "angular-dashboard",
    query: "angular analytics dashboard for heavy data with lazy widgets",
    relevantId: "d1",
    documents: [
      { id: "d1", text: "Angular dashboard with modular widgets and lazy loaded charts" },
      { id: "d2", text: "Tauri desktop launcher for system tray utilities" },
      { id: "d3", text: "Payment webhook retry worker for failed invoices" },
      { id: "d4", text: "CLI formatter for compact terminal tables" },
    ],
  },
  {
    id: "semantic-search",
    query: "semantic search over stored solutions using embeddings and hybrid ranking",
    relevantId: "d3",
    documents: [
      { id: "d1", text: "Docker sandbox for safe code execution with AST checks" },
      { id: "d2", text: "Redis cache invalidation for API responses" },
      { id: "d3", text: "Hybrid semantic retrieval over reusable solutions with vector similarity and ranking signals" },
      { id: "d4", text: "OAuth login flow with refresh token rotation" },
    ],
  },
  {
    id: "payment-retries",
    query: "payment retry pipeline for failed invoices and webhooks",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "Rate limiter for bursty public API traffic" },
      { id: "d2", text: "Webhook retry worker for failed payment events and invoice recovery" },
      { id: "d3", text: "Desktop notification tray app built with Tauri" },
      { id: "d4", text: "Graph storage for idea relationships between solutions" },
    ],
  },
  {
    id: "auth-jwt",
    query: "jwt auth refresh token middleware for api gateway",
    relevantId: "d4",
    documents: [
      { id: "d1", text: "Embedding cache model with access counters and timestamps" },
      { id: "d2", text: "Analytics dashboard route with chart virtualization" },
      { id: "d3", text: "Search ranking multiplier based on validated reuse evidence" },
      { id: "d4", text: "JWT authentication middleware with refresh token rotation for API requests" },
    ],
  },
  {
    id: "vector-cache",
    query: "cache repeated embeddings to avoid recomputing vectors",
    relevantId: "d1",
    documents: [
      { id: "d1", text: "Persistent embedding cache keyed by text hash to reuse vector results" },
      { id: "d2", text: "CLI output formatter that prints why search results matched" },
      { id: "d3", text: "Sandbox policy to prevent raw code execution" },
      { id: "d4", text: "Outcome update endpoint for message backed solutions" },
    ],
  },
  {
    id: "graph-memory",
    query: "idea graph store linking problem approach variant and outcome",
    relevantId: "d3",
    documents: [
      { id: "d1", text: "Tail request logs from JSONL file during development" },
      { id: "d2", text: "Local embedding sidecar using sentence transformers" },
      { id: "d3", text: "Structured solution graph linking problem approach variant and outcome nodes" },
      { id: "d4", text: "Express controller for exact intent search" },
    ],
  },
  {
    id: "cli-empty-state",
    query: "cli should explain when no semantic match exists",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "Payment worker retries failed invoice events" },
      { id: "d2", text: "CLI empty state message says no semantic match found and suggests broader terms" },
      { id: "d3", text: "Query understanding module interprets tags and intent from text" },
      { id: "d4", text: "Mongo connection helper returns readyState for health checks" },
    ],
  },
  {
    id: "docker-sandbox",
    query: "sandbox code execution using docker or wasm",
    relevantId: "d1",
    documents: [
      { id: "d1", text: "Code safety sandbox using Docker or WASM to isolate execution" },
      { id: "d2", text: "Embedding benchmark compares google and ollama models" },
      { id: "d3", text: "Cluster centroid update logic for semantic space" },
      { id: "d4", text: "Angular widget dashboard for data heavy screens" },
    ],
  },
  {
    id: "ranking-reuse",
    query: "prefer validated reused solutions over pending ones in search ranking",
    relevantId: "d4",
    documents: [
      { id: "d1", text: "Ollama host configuration for local model server" },
      { id: "d2", text: "Health endpoint returns embedding runtime status" },
      { id: "d3", text: "Authentication policy for anonymous agents" },
      { id: "d4", text: "Search ranking boosts validated and reused solutions while demoting pending or failed ones" },
    ],
  },
  {
    id: "mongo-index",
    query: "mongodb index for agent id and outcome status",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "Command line help text for semantic search mode" },
      { id: "d2", text: "Mongo schema indexes agentId createdAt and outcome status for solution retrieval" },
      { id: "d3", text: "Tauri desktop shell with tray support" },
      { id: "d4", text: "JWT auth middleware for token validation" },
    ],
  },
  {
    id: "query-understanding",
    query: "interpret free text query into intent tags and vector",
    relevantId: "d3",
    documents: [
      { id: "d1", text: "Retry payment webhooks after network failures" },
      { id: "d2", text: "Render analytics charts with lazy widgets" },
      { id: "d3", text: "Query understanding module maps free text to intent tags and semantic vector" },
      { id: "d4", text: "Local sidecar health check endpoint for embeddings" },
    ],
  },
  {
    id: "intent-broadcasting",
    query: "agents send structured intent request with constraints and priority",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "CLI empty state tells user no semantic match found" },
      { id: "d2", text: "Intent broadcasting schema lets agents send structured requests with constraints priority and formats" },
      { id: "d3", text: "Mongo index on outcome status and createdAt for ranking" },
      { id: "d4", text: "WASM sandbox for safe code execution" },
    ],
  },
  {
    id: "validated-ranked-solutions",
    query: "return validated ranked solutions with confidence score and usage",
    relevantId: "d1",
    documents: [
      { id: "d1", text: "Solution retrieval engine returns ranked approaches with summaries confidence score and usage evidence" },
      { id: "d2", text: "Tauri desktop shell with cross platform tray support" },
      { id: "d3", text: "JWT auth middleware for refresh token rotation" },
      { id: "d4", text: "Request logger writes JSONL entries for each API call" },
    ],
  },
  {
    id: "safe-code-adaptation",
    query: "retrieve analyze rewrite validate return safe adapted code",
    relevantId: "d3",
    documents: [
      { id: "d1", text: "Reputation score grows with validated reused outcomes" },
      { id: "d2", text: "Semantic query interpreter turns English into tags and intent" },
      { id: "d3", text: "Safe code adaptation pipeline retrieves analyzes rewrites validates and returns transformed code" },
      { id: "d4", text: "Ollama provider embeds text using local model server" },
    ],
  },
  {
    id: "experience-cards",
    query: "context compression layer shares summaries embeddings and experience cards",
    relevantId: "d4",
    documents: [
      { id: "d1", text: "Outcome update endpoint patches validated reused or failed status" },
      { id: "d2", text: "Idea graph links problem approach variant and outcome nodes" },
      { id: "d3", text: "CLI query command defaults to semantic search mode" },
      { id: "d4", text: "Context compression layer stores summaries embeddings and compact experience cards for reuse" },
    ],
  },
  {
    id: "solution-outcome-update",
    query: "post outcome update for stored solution with metrics evidence and status transition",
    relevantId: "d1",
    documents: [
      { id: "d1", text: "Outcome update API patches solution outcome status summary metrics and evidence for stored records" },
      { id: "d2", text: "Embedding cache reuses vectors for repeated input text" },
      { id: "d3", text: "Google embedding provider calls gemini embedding endpoint" },
      { id: "d4", text: "Desktop app built with Tauri and Rust sidecar" },
    ],
  },
  {
    id: "dedicated-solution-store",
    query: "dedicated solution store keeps message as intake and solution as reusable record",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "Exact search endpoint filters on normalized intent tags" },
      { id: "d2", text: "Dedicated solution store keeps reusable solution records separate from raw message provenance" },
      { id: "d3", text: "Auth gateway middleware validates bearer tokens" },
      { id: "d4", text: "Local ollama embeddings use mxbai embed large by default" },
    ],
  },
  {
    id: "reputation-formula",
    query: "agent reputation depends on success rate reuse frequency and validation results",
    relevantId: "d3",
    documents: [
      { id: "d1", text: "Semantic search route returns explanation and empty reason" },
      { id: "d2", text: "Prompt compression layer stores embeddings and summaries" },
      { id: "d3", text: "Agent reputation system scores contributors using success rate reuse frequency and validation evidence" },
      { id: "d4", text: "Tauri desktop packaging for Linux and Mac" },
    ],
  },
  {
    id: "protocol-schema",
    query: "http for agents schema with intent constraints input format output format confidence",
    relevantId: "d1",
    documents: [
      { id: "d1", text: "Protocol design defines standard agent schema with intent constraints input format output format and confidence" },
      { id: "d2", text: "Outcome aware ranking prefers validated reused solutions" },
      { id: "d3", text: "Docker or WASM sandbox isolates code execution" },
      { id: "d4", text: "Ollama tags endpoint returns installed models" },
    ],
  },
  {
    id: "cli-mvp-query",
    query: "agent query angular dashboard should show top approaches outcome summaries usage confidence",
    relevantId: "d2",
    documents: [
      { id: "d1", text: "Message create endpoint normalizes incoming intent and stores it" },
      { id: "d2", text: "CLI MVP prints top approaches outcome summaries usage confidence and contributor trust signals" },
      { id: "d3", text: "Embedding runtime health endpoint shows available providers" },
      { id: "d4", text: "Graph retrieval links problems to outcomes through variants" },
    ],
  },
  {
    id: "proof-based-validation",
    query: "hallucinated solutions need proof based validation and evidence review",
    relevantId: "d4",
    documents: [
      { id: "d1", text: "Embedding benchmark compares google and ollama accuracy" },
      { id: "d2", text: "JWT middleware rejects expired refresh tokens" },
      { id: "d3", text: "Context compression packs summaries for cheaper sharing" },
      { id: "d4", text: "Validation workflow uses proof based evidence to reduce hallucinated solutions and malicious code risk" },
    ],
  },
];

const MODELS = [
  {
    id: "google",
    label: `google:${GOOGLE_MODEL}`,
    type: "google",
  },
  {
    id: "ollama-nomic",
    label: "ollama:nomic-embed-text",
    type: "ollama",
    model: "nomic-embed-text",
  },
  {
    id: "ollama-mxbai",
    label: "ollama:mxbai-embed-large",
    type: "ollama",
    model: "mxbai-embed-large",
  },
];

async function main() {
  const startedAt = new Date();
  const googleClient = new GoogleGenAI({ apiKey: mustGetGoogleApiKey() });

  await ensureOllamaReachable();

  const runResults = [];
  for (const model of MODELS) {
    runResults.push(await benchmarkModel(model, googleClient));
  }

  const googleResult = runResults.find((result) => result.id === "google");
  if (!googleResult) {
    throw new Error("Google benchmark result missing");
  }

  for (const result of runResults) {
    result.googleAgreement = buildGoogleAgreementSummary(googleResult, result);
  }

  const report = buildReport(startedAt, runResults);
  await fs.appendFile(LOG_PATH, `${report}\n`, "utf8");
  console.log(report);
  console.log(`\nSaved benchmark log to ${LOG_PATH}`);
}

async function benchmarkModel(model, googleClient) {
  const cache = new Map();
  const cases = [];
  let vectorDimension = 0;
  const uniqueTexts = collectUniqueTexts(BENCHMARK_CASES);
  const concurrency = model.type === "google" ? GOOGLE_CONCURRENCY : OLLAMA_CONCURRENCY;
  const embeddings = await embedManyTexts(uniqueTexts, async (text) => {
    const result = await embedText(model, text, googleClient, cache);
    vectorDimension = result.vector.length || vectorDimension;
    return result;
  }, concurrency);

  let totalLatencyMs = 0;
  let embedCalls = 0;
  for (const result of embeddings.values()) {
    totalLatencyMs += result.latencyMs;
    embedCalls += 1;
  }

  for (const testCase of BENCHMARK_CASES) {
    const queryEmbedding = embeddings.get(testCase.query);
    if (!queryEmbedding) {
      throw new Error(`Missing query embedding for ${testCase.id}`);
    }

    const scoredDocuments = [];
    for (const document of testCase.documents) {
      const docEmbedding = embeddings.get(document.text);
      if (!docEmbedding) {
        throw new Error(`Missing document embedding for ${document.id}`);
      }
      scoredDocuments.push({
        ...document,
        score: cosineSimilarity(queryEmbedding.vector, docEmbedding.vector),
      });
    }

    scoredDocuments.sort((a, b) => b.score - a.score);
    const relevantRank = scoredDocuments.findIndex((doc) => doc.id === testCase.relevantId) + 1;
    const top = scoredDocuments[0];
    const relevant = scoredDocuments.find((doc) => doc.id === testCase.relevantId);
    const bestIncorrect = scoredDocuments.find((doc) => doc.id !== testCase.relevantId);

    cases.push({
      id: testCase.id,
      relevantId: testCase.relevantId,
      topId: top?.id ?? null,
      topScore: top?.score ?? 0,
      relevantRank,
      relevantScore: relevant?.score ?? 0,
      marginVsBestIncorrect:
        relevant && bestIncorrect ? relevant.score - bestIncorrect.score : 0,
      ranking: scoredDocuments.map((doc) => doc.id),
    });
  }

  const top1Correct = cases.filter((item) => item.topId === item.relevantId).length;
  const mrr =
    cases.reduce((sum, item) => sum + (item.relevantRank > 0 ? 1 / item.relevantRank : 0), 0) /
    cases.length;

  return {
    id: model.id,
    label: model.label,
    vectorDimension,
    averageLatencyMs: totalLatencyMs / Math.max(1, embedCalls),
    top1Accuracy: top1Correct / cases.length,
    top3Accuracy:
      cases.filter((item) => item.relevantRank > 0 && item.relevantRank <= 3).length / cases.length,
    mrr,
    averageRelevantScore:
      cases.reduce((sum, item) => sum + item.relevantScore, 0) / Math.max(1, cases.length),
    averageMarginVsBestIncorrect:
      cases.reduce((sum, item) => sum + item.marginVsBestIncorrect, 0) / Math.max(1, cases.length),
    embedCalls,
    cases,
    googleAgreement: null,
  };
}

async function embedManyTexts(texts, embedder, concurrency = 4) {
  const results = new Map();
  let index = 0;

  async function worker() {
    while (index < texts.length) {
      const current = texts[index];
      index += 1;
      results.set(current, await embedder(current));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, () => worker())
  );

  return results;
}

function collectUniqueTexts(testCases) {
  return Array.from(
    new Set(
      testCases.flatMap((testCase) => [
        testCase.query,
        ...testCase.documents.map((document) => document.text),
      ])
    )
  );
}

async function embedText(model, text, googleClient, cache) {
  const cacheKey = `${model.id}::${text}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let result;
  if (model.type === "google") {
    result = await embedWithGoogle(googleClient, text);
  } else {
    result = await embedWithOllama(model.model, text);
  }

  cache.set(cacheKey, result);
  return result;
}

async function embedWithGoogle(client, text) {
  const started = Date.now();
  await throttleGoogleRequests();
  const response = await withRetry(
    async () => {
      const result = await client.models.embedContent({
        model: GOOGLE_MODEL,
        contents: text,
      });
      lastGoogleRequestAt = Date.now();
      return result;
    },
    { attempts: 12, baseDelayMs: 1500 }
  );
  const vector = response.embeddings?.[0]?.values ?? [];
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Google returned empty embedding");
  }

  return {
    vector,
    latencyMs: Date.now() - started,
  };
}

async function embedWithOllama(model, text) {
  const started = Date.now();
  const response = await withRetry(
    () =>
      fetch(`${OLLAMA_HOST}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: text,
        }),
      }),
    { attempts: 3, baseDelayMs: 500 }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama embed failed for ${model}: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const vector = Array.isArray(payload.embedding) ? payload.embedding : [];
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`Ollama returned invalid embedding payload for ${model}`);
  }

  return {
    vector,
    latencyMs: Date.now() - started,
  };
}

function buildGoogleAgreementSummary(googleResult, result) {
  const pairedCases = result.cases.map((item) => {
    const googleCase = googleResult.cases.find((candidate) => candidate.id === item.id);
    if (!googleCase) {
      throw new Error(`Missing google case for ${item.id}`);
    }
    return { modelCase: item, googleCase };
  });

  const top1Agreement =
    pairedCases.filter((pair) => pair.modelCase.topId === pair.googleCase.topId).length /
    pairedCases.length;

  const averageSpearman =
    pairedCases.reduce(
      (sum, pair) => sum + spearmanRho(pair.modelCase.ranking, pair.googleCase.ranking),
      0
    ) / pairedCases.length;

  return {
    top1Agreement,
    averageSpearman,
  };
}

function spearmanRho(leftRanking, rightRanking) {
  if (leftRanking.length !== rightRanking.length) {
    throw new Error("Ranking lengths must match");
  }

  const count = leftRanking.length;
  if (count <= 1) return 1;

  const rightPositions = new Map(rightRanking.map((id, index) => [id, index + 1]));
  let squaredDistanceSum = 0;

  for (let index = 0; index < leftRanking.length; index += 1) {
    const leftId = leftRanking[index];
    const leftRank = index + 1;
    const rightRank = rightPositions.get(leftId);
    if (!rightRank) {
      throw new Error(`Missing ranked id ${leftId}`);
    }
    squaredDistanceSum += (leftRank - rightRank) ** 2;
  }

  return 1 - (6 * squaredDistanceSum) / (count * (count ** 2 - 1));
}

function cosineSimilarity(left, right) {
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length !== right.length) {
    throw new Error(`Embedding dimension mismatch: ${left.length} vs ${right.length}`);
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function buildReport(startedAt, results) {
  const lines = [];
  lines.push("=== Embeddings Benchmark ===");
  lines.push(`Started: ${startedAt.toISOString()}`);
  lines.push(`Google model: ${GOOGLE_MODEL}`);
  lines.push(`Ollama host: ${OLLAMA_HOST}`);
  lines.push(`Cases: ${BENCHMARK_CASES.length}`);
  lines.push("");

  for (const result of results) {
    lines.push(`[Model] ${result.label}`);
    lines.push(`dimension=${result.vectorDimension}`);
    lines.push(`avg_latency_ms=${result.averageLatencyMs.toFixed(2)}`);
    lines.push(`top1_accuracy=${result.top1Accuracy.toFixed(4)}`);
    lines.push(`top3_accuracy=${result.top3Accuracy.toFixed(4)}`);
    lines.push(`mrr=${result.mrr.toFixed(4)}`);
    lines.push(`avg_relevant_score=${result.averageRelevantScore.toFixed(4)}`);
    lines.push(`avg_margin_vs_best_incorrect=${result.averageMarginVsBestIncorrect.toFixed(4)}`);

    if (result.googleAgreement) {
      lines.push(`top1_agreement_vs_google=${result.googleAgreement.top1Agreement.toFixed(4)}`);
      lines.push(`avg_spearman_vs_google=${result.googleAgreement.averageSpearman.toFixed(4)}`);
    }

    lines.push("cases:");
    for (const testCase of result.cases) {
      lines.push(
        `- ${testCase.id}: top=${testCase.topId} relevant=${testCase.relevantId} rank=${testCase.relevantRank} relevant_score=${testCase.relevantScore.toFixed(4)} margin=${testCase.marginVsBestIncorrect.toFixed(4)}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function ensureOllamaReachable() {
  const response = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama not reachable at ${OLLAMA_HOST}: ${response.status} ${detail}`);
  }
}

async function throttleGoogleRequests() {
  const now = Date.now();
  const waitMs = GOOGLE_MIN_INTERVAL_MS - (now - lastGoogleRequestAt);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function withRetry(fn, options) {
  const attempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn();
      if (result instanceof Response && !result.ok && shouldRetryHttpStatus(result.status)) {
        const detail = await result.text();
        throw new Error(`${result.status} ${detail}`.trim());
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableError(error)) {
        break;
      }
      await sleep(getRetryDelayMs(error, baseDelayMs * attempt));
    }
  }

  throw lastError;
}

function isRetryableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|quota|rate limit|ECONNRESET|ETIMEDOUT|timeout/i.test(message);
}

function shouldRetryHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function getRetryDelayMs(error, fallbackMs) {
  const message = error instanceof Error ? error.message : String(error);
  const retryDelayMatch = message.match(/"retryDelay":"(\d+)s"/i);
  if (retryDelayMatch) {
    return (Number(retryDelayMatch[1]) + 1) * 1000;
  }
  return fallbackMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mustGetGoogleApiKey() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY not set in environment, .env, or .env.local");
  }
  return apiKey;
}

main().catch(async (error) => {
  const lines = [
    "=== Embeddings Benchmark Failed ===",
    `Started: ${new Date().toISOString()}`,
    `Reason: ${error instanceof Error ? error.message : String(error)}`,
    "",
  ];
  const report = lines.join("\n");
  await fs.appendFile(LOG_PATH, report, "utf8").catch(() => {});
  console.error(report);
  process.exitCode = 1;
});
