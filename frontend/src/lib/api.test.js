import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const TOKEN_KEY = "autoapply_token";
const LEGACY_TOKEN_KEY = "talentping_token";

const store = {};
const mockStorage = {
  getItem: (key) => (key in store ? store[key] : null),
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true });

describe("token migration", () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.resetModules();
  });

  it("migrates legacy talentping_token to autoapply_token on import", async () => {
    mockStorage.setItem(LEGACY_TOKEN_KEY, "jwt-from-old-app");
    const { getToken } = await import("./api.js");
    expect(getToken()).toBe("jwt-from-old-app");
    expect(mockStorage.getItem(TOKEN_KEY)).toBe("jwt-from-old-app");
    expect(mockStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it("does not overwrite an existing new token with the legacy one", async () => {
    mockStorage.setItem(TOKEN_KEY, "already-migrated");
    mockStorage.setItem(LEGACY_TOKEN_KEY, "stale-old-jwt");
    const { getToken } = await import("./api.js");
    expect(getToken()).toBe("already-migrated");
  });

  it("works when neither key exists", async () => {
    const { getToken } = await import("./api.js");
    expect(getToken()).toBeNull();
  });

  it("setToken(null) clears both keys", async () => {
    mockStorage.setItem(TOKEN_KEY, "current");
    mockStorage.setItem(LEGACY_TOKEN_KEY, "leftover");
    const { setToken } = await import("./api.js");
    setToken(null);
    expect(mockStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(mockStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });
});

describe("email AI consent requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a JSON object rather than a JSON-encoded string", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ enabled: true, version: "2026-10-13" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("./api.js");
    await api.setGmailAIConsent(true, "2026-10-13");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/gmail/ai-consent");
    expect(options.method).toBe("PUT");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ enabled: true, version: "2026-10-13" });
  });
});
