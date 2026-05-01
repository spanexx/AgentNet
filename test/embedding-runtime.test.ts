import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbeddingRuntimeStatus } from "../src/core/embedding-runtime";
import { getEnsemble } from "../src/core/normalize";

vi.mock("../src/core/normalize", () => ({
  getEnsemble: vi.fn(),
}));

describe("getEmbeddingRuntimeStatus", () => {
  beforeEach(() => {
    vi.mocked(getEnsemble).mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({
        openai: false,
        google: false,
        local: false,
      }),
    } as unknown as ReturnType<typeof getEnsemble>);

    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LOCAL_EMBEDDING_URL;
  });

  it("reports real_provider_available when a remote provider is live", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    vi.mocked(getEnsemble).mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({
        openai: true,
        google: false,
        local: false,
      }),
    } as unknown as ReturnType<typeof getEnsemble>);

    const status = await getEmbeddingRuntimeStatus();

    expect(status.mode).toBe("real_provider_available");
    expect(status.realProviderAvailable).toBe(true);
    expect(status.availableProviders).toContain("openai");
    expect(status.providers.openai.available).toBe(true);
    expect(status.providers.openai.configured).toBe(true);
  });

  it("reports local_only when only the local sidecar is reachable", async () => {
    vi.mocked(getEnsemble).mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({
        openai: false,
        google: false,
        local: true,
      }),
    } as unknown as ReturnType<typeof getEnsemble>);

    const status = await getEmbeddingRuntimeStatus();

    expect(status.mode).toBe("local_only");
    expect(status.realProviderAvailable).toBe(false);
    expect(status.availableProviders).toEqual(["local"]);
  });

  it("reports configured_but_unavailable when keys exist but providers are down", async () => {
    process.env.GOOGLE_API_KEY = "test-key";

    const status = await getEmbeddingRuntimeStatus();

    expect(status.mode).toBe("configured_but_unavailable");
    expect(status.realProviderAvailable).toBe(false);
    expect(status.providers.google.configured).toBe(true);
    expect(status.providers.google.available).toBe(false);
  });
});
