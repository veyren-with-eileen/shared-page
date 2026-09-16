import { describe, expect, it, vi } from "vitest";

import { authHandler } from "../src/auth";
import type { Env } from "../src/types";

class MemoryKv {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

function fixture() {
  const kv = new MemoryKv();
  const request = {
    responseType: "code",
    clientId: "chatgpt-client",
    redirectUri: "https://chatgpt.com/callback",
    scope: ["calendar:read", "calendar:write"],
    state: "state",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
  };
  const oauth = {
    parseAuthRequest: vi.fn(async () => request),
    lookupClient: vi.fn(async () => ({ clientId: "chatgpt-client", clientName: "ChatGPT" })),
    completeAuthorization: vi.fn(async () => ({ redirectTo: "https://chatgpt.com/callback?code=ok" })),
  };
  const env = {
    OAUTH_KV: kv,
    OAUTH_PROVIDER: oauth,
    MCP_OWNER_PASSWORD: "owner-password",
    MCP_INTERNAL_TOKEN: "internal",
    APPLICATION: { fetch: vi.fn() },
  } as unknown as Env;
  return { env, kv, oauth };
}

describe("owner OAuth authorization", () => {
  it("stores validated OAuth state and renders a password form", async () => {
    const { env, kv } = fixture();
    const response = await authHandler.fetch!(
      new Request("https://mcp.test/authorize?client_id=x") as any, env, {} as ExecutionContext,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("ChatGPT");
    expect(html).not.toContain("owner-password");
    expect(kv.values.size).toBe(1);
  });

  it("rejects a wrong password without completing authorization", async () => {
    const { env, kv, oauth } = fixture();
    kv.values.set("owner-auth:nonce", JSON.stringify(await oauth.parseAuthRequest()));
    const response = await authHandler.fetch!(new Request("https://mcp.test/authorize", {
      method: "POST",
      headers: { Origin: "https://mcp.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: "nonce=nonce&password=wrong",
    }) as any, env, {} as ExecutionContext);
    expect(response.status).toBe(401);
    expect(oauth.completeAuthorization).not.toHaveBeenCalled();
  });

  it("grants the calendar scopes only after owner authentication", async () => {
    const { env, kv, oauth } = fixture();
    kv.values.set("owner-auth:nonce", JSON.stringify(await oauth.parseAuthRequest()));
    const response = await authHandler.fetch!(new Request("https://mcp.test/authorize", {
      method: "POST",
      headers: { Origin: "https://mcp.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: "nonce=nonce&password=owner-password",
    }) as any, env, {} as ExecutionContext);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("chatgpt.com/callback");
    expect(oauth.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      userId: "shared-page-owner",
      scope: ["calendar:read", "calendar:write"],
    }));
    expect(kv.values.size).toBe(0);
  });
});
