import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_EXPIRED_EVENT, api, fallbackMessage, getToken, setToken } from "./api.js";

function respond(status, body, statusText = "") {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => body,
    blob: async () => new Blob([body]),
  });
}

describe("api error handling", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("turns the proxy's HTML 502 into a readable message", async () => {
    vi.stubGlobal("fetch", respond(502, "<html><body>502 Bad Gateway</body></html>", "Bad Gateway"));
    await expect(api.me()).rejects.toThrow("The server is briefly unavailable — try again in a moment.");
  });

  it("reports an HTML 413 as an oversized upload", async () => {
    vi.stubGlobal("fetch", respond(413, "<html>Request Entity Too Large</html>"));
    await expect(api.me()).rejects.toThrow("That upload is too large.");
  });

  it("still prefers FastAPI's detail when the body is JSON", async () => {
    vi.stubGlobal("fetch", respond(409, JSON.stringify({ detail: "Already applied" })));
    await expect(api.me()).rejects.toThrow("Already applied");
  });

  it("joins validation errors", async () => {
    vi.stubGlobal("fetch", respond(422, JSON.stringify({ detail: [{ msg: "too short" }, { msg: "bad email" }] })));
    await expect(api.me()).rejects.toThrow("too short, bad email");
  });

  it("rejects a 200 whose body isn't JSON instead of returning garbage", async () => {
    vi.stubGlobal("fetch", respond(200, "<html>captive portal</html>"));
    await expect(api.me()).rejects.toThrow("couldn't read");
  });

  it("returns null for an empty success body", async () => {
    vi.stubGlobal("fetch", respond(204, ""));
    await expect(api.me()).resolves.toBeNull();
  });

  it("explains a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.me()).rejects.toThrow("Can't reach DoAide AutoApply");
  });

  it("falls back to the status for other non-JSON errors", () => {
    expect(fallbackMessage({ status: 500, statusText: "" })).toBe("Request failed (HTTP 500)");
    expect(fallbackMessage({ status: 429, statusText: "" })).toMatch(/Too many requests/);
  });
});

describe("session expiry", () => {
  let heard;
  const listener = () => heard++;

  beforeEach(() => {
    localStorage.clear();
    heard = 0;
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);
  });
  afterEach(() => {
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    vi.unstubAllGlobals();
  });

  it("drops the token and announces expiry on a 401 that carried a token", async () => {
    setToken("stale");
    vi.stubGlobal("fetch", respond(401, JSON.stringify({ detail: "Not authenticated" })));
    await expect(api.me()).rejects.toThrow("Not authenticated");
    expect(getToken()).toBeNull();
    expect(heard).toBe(1);
  });

  it("does not announce expiry for a failed login", async () => {
    vi.stubGlobal("fetch", respond(401, JSON.stringify({ detail: "Incorrect email or password" })));
    await expect(api.login("a@b.co", "wrong")).rejects.toThrow("Incorrect email or password");
    expect(heard).toBe(0);
  });
});
