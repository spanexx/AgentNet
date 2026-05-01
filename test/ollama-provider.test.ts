import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "../src/core/embeddings/providers/ollama-provider";

const originalFetch = global.fetch;

describe("OllamaProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OLLAMA_EMBEDDING_MODEL;
    delete process.env.OLLAMA_HOST;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses mxbai-embed-large as the default local model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new OllamaProvider();
    const result = await provider.embed("agent memory graph");

    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "mxbai-embed-large",
          input: "agent memory graph",
        }),
      })
    );
  });

  it("uses configured ollama model override when present", async () => {
    process.env.OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.4, 0.5] }),
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new OllamaProvider();
    await provider.embed("semantic query");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({
        body: JSON.stringify({
          model: "nomic-embed-text",
          input: "semantic query",
        }),
      })
    );
  });

  it("reports availability from ollama tags endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = new OllamaProvider();
    await expect(provider.isAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:11434/api/tags");
  });
});
