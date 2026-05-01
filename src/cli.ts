#!/usr/bin/env node

import axios from "axios";

// ---------- Response types ----------

type SemanticSearchResultItem = {
  id: string;
  summary: string;
  score: number;
  usage: number;
  intent: string;
  tags: string[];
  confidence: number;
  agentId: string;
  createdAt: string;
  reputation: {
    score: number;
    multiplier: number;
  };
  solution: {
    problem: string;
    approach: string;
    variant: string;
    outcome: {
      status: string;
      summary: string;
    };
  };
  explanation?: {
    matchedIntent: string | null;
    matchedTags: string[];
    topSignals: string[];
  };
};

type SemanticSearchResponse = {
  count: number;
  total: number;
  limit: number;
  skip: number;
  query: {
    original: string;
    interpretedIntent: string | null;
    interpretedTags: string[];
    confidence: number;
    degraded: boolean;
  };
  emptyReason: string | null;
  data: SemanticSearchResultItem[];
};

// Legacy structured search types (backward compat)
type SearchResult = {
  id: string;
  summary: string;
  score: number;
  usage: number;
  intent: string;
  tags: string[];
  confidence: number;
  agentId: string;
  createdAt: string;
  reputation: {
    score: number;
    multiplier: number;
  };
  solution: {
    problem: string;
    approach: string;
    variant: string;
    outcome: {
      status: string;
      summary: string;
    };
  };
};

type SearchResponse = {
  count: number;
  total: number;
  limit: number;
  skip: number;
  data: SearchResult[];
};

// ---------- CLI types ----------

type QueryCommandOptions = {
  queryText: string;
  tags: string[];
  limit: number;
  baseUrl: string;
  exact: boolean;
};

type ParsedCommand =
  | { kind: "help" }
  | { kind: "query"; options: QueryCommandOptions };

// ---------- Parsing ----------

/**
 * Parses the AgentNet CLI arguments into an executable command.
 */
export function parseCliArgs(argv: string[]): ParsedCommand {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }

  const [command, ...rest] = argv;

  if (command !== "query") {
    throw new Error(`Unknown command "${command}".`);
  }

  const positional: string[] = [];
  let tags: string[] = [];
  let limit = 5;
  let baseUrl = process.env.AGENTNET_BASE_URL ?? "http://localhost:3000";
  let exact = false;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--tags") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("Missing value for --tags.");
      }

      tags = value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (token === "--limit") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("Missing value for --limit.");
      }

      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer.");
      }

      limit = parsed;
      index += 1;
      continue;
    }

    if (token === "--base-url") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("Missing value for --base-url.");
      }

      baseUrl = value;
      index += 1;
      continue;
    }

    if (token === "--exact") {
      exact = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option "${token}".`);
    }

    positional.push(token);
  }

  const queryText = positional.join(" ").trim();
  if (!queryText) {
    throw new Error('Missing query text. Example: agent query "angular dashboard"');
  }

  return {
    kind: "query",
    options: {
      queryText,
      tags,
      limit,
      baseUrl,
      exact,
    },
  };
}

// ---------- URL builders ----------

/**
 * Builds the semantic search URL (default mode).
 */
export function buildSemanticSearchUrl(options: QueryCommandOptions): string {
  const url = new URL("/api/semantic-search", ensureTrailingSlash(options.baseUrl));
  url.searchParams.set("q", options.queryText);
  url.searchParams.set("limit", String(options.limit));
  return url.toString();
}

/**
 * Builds the exact/structured search URL (--exact mode).
 */
export function buildSearchUrl(options: QueryCommandOptions): string {
  const url = new URL("/api/search", ensureTrailingSlash(options.baseUrl));
  url.searchParams.set("intent", options.queryText);
  url.searchParams.set("limit", String(options.limit));

  if (options.tags.length > 0) {
    url.searchParams.set("tags", options.tags.join(","));
  }

  return url.toString();
}

// ---------- Result formatters ----------

/**
 * Renders semantic search results with explanation and query interpretation.
 */
export function formatSemanticResults(
  response: SemanticSearchResponse,
  options: QueryCommandOptions
): string {
  const lines = [
    `AgentNet query: ${options.queryText}`,
    `Mode: semantic`,
    `Base URL: ${options.baseUrl}`,
  ];

  // Show query interpretation
  if (response.query) {
    const q = response.query;
    if (q.interpretedIntent) {
      lines.push(`Interpreted intent: ${q.interpretedIntent}`);
    }
    if (q.interpretedTags.length > 0) {
      lines.push(`Interpreted tags: ${q.interpretedTags.join(", ")}`);
    }
    lines.push(`Confidence: ${q.confidence.toFixed(2)}${q.degraded ? " (degraded)" : ""}`);
  }

  lines.push(`Results: ${response.count} shown of ${response.total}`);

  if (response.data.length === 0) {
    lines.push("");
    if (response.emptyReason === "no_solutions") {
      lines.push("No solutions indexed yet. Store a message first with POST /api/message.");
    } else if (response.emptyReason === "no_semantic_match") {
      lines.push("No semantic match found for this query. Try different wording or broader terms.");
    } else {
      lines.push("No matching solutions found.");
    }
    return lines.join("\n");
  }

  for (const [index, item] of response.data.entries()) {
    lines.push("");
    lines.push(`${index + 1}. ${item.solution.approach} (${item.solution.variant})`);
    lines.push(`   Problem: ${item.solution.problem}`);
    lines.push(`   Outcome: ${item.solution.outcome.status} - ${item.solution.outcome.summary}`);
    lines.push(
      `   Score: ${item.score.toFixed(2)} | Confidence: ${item.confidence.toFixed(2)} | Usage: ${item.usage}`
    );
    lines.push(
      `   Agent: ${item.agentId} | Reputation: ${item.reputation.score.toFixed(2)} (${item.reputation.multiplier.toFixed(2)}x)`
    );
    lines.push(`   Intent: ${item.intent} | Tags: ${item.tags.join(", ") || "none"}`);
    lines.push(`   Summary: ${item.summary}`);

    // Explanation (semantic mode only)
    if (item.explanation) {
      const signals = item.explanation.topSignals.join(", ");
      lines.push(`   Why: ${signals}`);
    }
  }

  return lines.join("\n");
}

/**
 * Renders structured search results (--exact mode, backward compat).
 */
export function formatSearchResults(response: SearchResponse, options: QueryCommandOptions): string {
  const lines = [
    `AgentNet query: ${options.queryText}`,
    `Mode: exact`,
    `Base URL: ${options.baseUrl}`,
    `Results: ${response.count} shown of ${response.total}`,
  ];

  if (options.tags.length > 0) {
    lines.push(`Tags: ${options.tags.join(", ")}`);
  }

  if (response.data.length === 0) {
    lines.push("");
    lines.push("No matching solutions found.");
    return lines.join("\n");
  }

  for (const [index, item] of response.data.entries()) {
    lines.push("");
    lines.push(`${index + 1}. ${item.solution.approach} (${item.solution.variant})`);
    lines.push(`   Problem: ${item.solution.problem}`);
    lines.push(`   Outcome: ${item.solution.outcome.status} - ${item.solution.outcome.summary}`);
    lines.push(
      `   Score: ${item.score.toFixed(2)} | Confidence: ${item.confidence.toFixed(2)} | Usage: ${item.usage}`
    );
    lines.push(
      `   Agent: ${item.agentId} | Reputation: ${item.reputation.score.toFixed(2)} (${item.reputation.multiplier.toFixed(2)}x)`
    );
    lines.push(`   Intent: ${item.intent} | Tags: ${item.tags.join(", ") || "none"}`);
    lines.push(`   Summary: ${item.summary}`);
  }

  return lines.join("\n");
}

// ---------- Help ----------

/**
 * Prints usage for the current CLI surface.
 */
export function formatHelp(): string {
  return [
    "AgentNet CLI",
    "",
    "Usage:",
    '  agent query "tauri desktop app"              Search by meaning (default)',
    '  agent query "tauri" --exact                   Exact structured search',
    '  agent query "angular" --tags angular,charts   Filter by tags (exact mode)',
    '  agent query "dashboard" --limit 10            Limit results',
    '  agent query "api" --base-url http://host:3000',
    "",
    "Options:",
    "  --exact      Use exact structured search instead of semantic search",
    "  --tags       Comma-separated tag filter (exact mode only)",
    "  --limit      Maximum number of results (default: 5)",
    "  --base-url   AgentNet API base URL",
    "  -h, --help   Show this help message",
    "",
    "Environment:",
    "  AGENTNET_BASE_URL  Default base URL for the AgentNet API",
  ].join("\n");
}

// ---------- Query execution ----------

async function query(options: QueryCommandOptions): Promise<number> {
  try {
    if (options.exact) {
      return await queryExact(options);
    }
    return await querySemantic(options);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message =
        typeof error.response?.data?.error === "string"
          ? error.response.data.error
          : error.message;
      console.error(`AgentNet query failed${status ? ` (${status})` : ""}: ${message}`);
      return 1;
    }

    console.error(`AgentNet query failed: ${String(error)}`);
    return 1;
  }
}

async function querySemantic(options: QueryCommandOptions): Promise<number> {
  const url = buildSemanticSearchUrl(options);
  const response = await axios.get<SemanticSearchResponse>(url, {
    timeout: 15_000,
    headers: { Accept: "application/json" },
  });

  console.log(formatSemanticResults(response.data, options));
  return 0;
}

async function queryExact(options: QueryCommandOptions): Promise<number> {
  const url = buildSearchUrl(options);
  const response = await axios.get<SearchResponse>(url, {
    timeout: 10_000,
    headers: { Accept: "application/json" },
  });

  console.log(formatSearchResults(response.data, options));
  return 0;
}

// ---------- CLI entry ----------

/**
 * Executes the CLI command and returns a process exit code.
 */
export async function runCli(argv: string[]): Promise<number> {
  try {
    const command = parseCliArgs(argv);

    if (command.kind === "help") {
      console.log(formatHelp());
      return 0;
    }

    return query(command.options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(formatHelp());
    return 1;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
