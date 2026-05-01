import { describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  buildSemanticSearchUrl,
  formatHelp,
  formatSearchResults,
  formatSemanticResults,
  parseCliArgs,
} from "../src/cli";

describe("parseCliArgs", () => {
  it("parses the query command with tags and limit", () => {
    const command = parseCliArgs([
      "query",
      "angular dashboard",
      "--tags",
      "angular,dashboard",
      "--limit",
      "3",
      "--base-url",
      "http://localhost:4100",
    ]);

    expect(command).toEqual({
      kind: "query",
      options: {
        queryText: "angular dashboard",
        tags: ["angular", "dashboard"],
        limit: 3,
        baseUrl: "http://localhost:4100",
        exact: false,
      },
    });
  });

  it("returns help when no arguments are provided", () => {
    expect(parseCliArgs([])).toEqual({ kind: "help" });
  });

  it("rejects a missing query string", () => {
    expect(() => parseCliArgs(["query"])).toThrow(
      'Missing query text. Example: agent query "angular dashboard"'
    );
  });

  it("defaults to semantic mode (exact=false)", () => {
    const command = parseCliArgs(["query", "tauri desktop app"]);
    expect(command).toMatchObject({
      kind: "query",
      options: { exact: false },
    });
  });

  it("sets exact=true when --exact flag is present", () => {
    const command = parseCliArgs(["query", "tauri", "--exact"]);
    expect(command).toMatchObject({
      kind: "query",
      options: { exact: true, queryText: "tauri" },
    });
  });
});

describe("buildSemanticSearchUrl", () => {
  it("builds a semantic search URL with q parameter", () => {
    const url = buildSemanticSearchUrl({
      queryText: "tauri desktop app",
      tags: [],
      limit: 5,
      baseUrl: "http://localhost:3000",
      exact: false,
    });

    expect(url).toContain("/api/semantic-search");
    expect(url).toContain("q=tauri+desktop+app");
    expect(url).toContain("limit=5");
  });
});

describe("buildSearchUrl", () => {
  it("builds a structured search URL with intent parameter", () => {
    const url = buildSearchUrl({
      queryText: "angular dashboard",
      tags: ["angular", "dashboard"],
      limit: 5,
      baseUrl: "http://localhost:3000",
      exact: true,
    });

    expect(url).toContain("/api/search");
    expect(url).toContain("intent=angular+dashboard");
    expect(url).toContain("tags=angular%2Cdashboard");
  });
});

describe("formatSemanticResults", () => {
  it("renders semantic results with query interpretation and explanation", () => {
    const output = formatSemanticResults(
      {
        count: 1,
        total: 1,
        limit: 5,
        skip: 0,
        query: {
          original: "tauri desktop app",
          interpretedIntent: "desktop_application",
          interpretedTags: ["tauri", "desktop"],
          confidence: 0.87,
          degraded: false,
        },
        emptyReason: null,
        data: [
          {
            id: "sol-1",
            summary: "Desktop app → Tauri framework",
            score: 0.92,
            usage: 3,
            intent: "desktop_application",
            tags: ["tauri", "desktop"],
            confidence: 0.87,
            agentId: "agent-desktop",
            createdAt: "2026-04-30T12:00:00.000Z",
            reputation: { score: 1.5, multiplier: 1.2 },
            solution: {
              problem: "Cross-platform desktop app",
              approach: "Tauri framework",
              variant: "tauri, desktop",
              outcome: {
                status: "validated",
                summary: "Running in production",
              },
            },
            explanation: {
              matchedIntent: "desktop_application",
              matchedTags: ["tauri"],
              topSignals: ["Semantic similarity (0.91)", "Intent match"],
            },
          },
        ],
      },
      {
        queryText: "tauri desktop app",
        tags: [],
        limit: 5,
        baseUrl: "http://localhost:3000",
        exact: false,
      }
    );

    expect(output).toContain("AgentNet query: tauri desktop app");
    expect(output).toContain("Mode: semantic");
    expect(output).toContain("Interpreted intent: desktop_application");
    expect(output).toContain("Interpreted tags: tauri, desktop");
    expect(output).toContain("1. Tauri framework (tauri, desktop)");
    expect(output).toContain("Why: Semantic similarity (0.91), Intent match");
  });

  it("explains empty state when no solutions are indexed", () => {
    const output = formatSemanticResults(
      {
        count: 0,
        total: 0,
        limit: 5,
        skip: 0,
        query: {
          original: "tauri",
          interpretedIntent: null,
          interpretedTags: [],
          confidence: 0,
          degraded: true,
        },
        emptyReason: "no_solutions",
        data: [],
      },
      {
        queryText: "tauri",
        tags: [],
        limit: 5,
        baseUrl: "http://localhost:3000",
        exact: false,
      }
    );

    expect(output).toContain("No solutions indexed yet");
  });

  it("explains empty state when no semantic match found", () => {
    const output = formatSemanticResults(
      {
        count: 0,
        total: 0,
        limit: 5,
        skip: 0,
        query: {
          original: "quantum computing",
          interpretedIntent: null,
          interpretedTags: [],
          confidence: 0.3,
          degraded: false,
        },
        emptyReason: "no_semantic_match",
        data: [],
      },
      {
        queryText: "quantum computing",
        tags: [],
        limit: 5,
        baseUrl: "http://localhost:3000",
        exact: false,
      }
    );

    expect(output).toContain("No semantic match found");
  });
});

describe("formatSearchResults (exact mode)", () => {
  it("renders exact results with mode label", () => {
    const output = formatSearchResults(
      {
        count: 1,
        total: 1,
        limit: 5,
        skip: 0,
        data: [
          {
            id: "sol-1",
            summary: "angular dashboard -> widget layout",
            score: 1.24,
            usage: 7,
            intent: "frontend_dashboard",
            tags: ["angular", "dashboard"],
            confidence: 0.91,
            agentId: "agent-ui",
            createdAt: "2026-04-30T12:00:00.000Z",
            reputation: { score: 1.7, multiplier: 1.24 },
            solution: {
              problem: "Heavy analytics dashboard",
              approach: "Widget layout",
              variant: "Angular",
              outcome: {
                status: "validated",
                summary: "Stable in production",
              },
            },
          },
        ],
      },
      {
        queryText: "angular dashboard",
        tags: ["angular", "dashboard"],
        limit: 5,
        baseUrl: "http://localhost:3000",
        exact: true,
      }
    );

    expect(output).toContain("AgentNet query: angular dashboard");
    expect(output).toContain("Mode: exact");
    expect(output).toContain("1. Widget layout (Angular)");
    expect(output).toContain("Outcome: validated - Stable in production");
  });
});

describe("formatHelp", () => {
  it("documents both semantic and exact modes", () => {
    const help = formatHelp();
    expect(help).toContain("Search by meaning");
    expect(help).toContain("--exact");
    expect(help).toContain("Exact structured search");
  });
});
