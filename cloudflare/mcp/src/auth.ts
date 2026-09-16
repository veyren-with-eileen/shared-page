import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import { constantTimeEqual, escapeHtml } from "./security";
import type { Env } from "./types";

const STATE_PREFIX = "owner-auth:";
const STATE_TTL_SECONDS = 600;
const ALLOWED_SCOPES = new Set(["calendar:read", "calendar:write"]);

type OAuthAuthorizationError = Error & {
  code: string;
  description: string;
  redirectUri?: string;
  state?: string;
  issuer?: string;
};

function isAuthorizationError(error: unknown): error is OAuthAuthorizationError {
  return error instanceof Error
    && typeof (error as Partial<OAuthAuthorizationError>).code === "string"
    && typeof (error as Partial<OAuthAuthorizationError>).description === "string";
}

function oauthError(error: OAuthAuthorizationError): Response {
  if (!error.redirectUri) {
    return new Response(error.description, { status: 400 });
  }
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect, 302);
}

function loginPage(clientName: string, nonce: string, message = ""): Response {
  const notice = message ? `<p class="error">${escapeHtml(message)}</p>` : "";
  return new Response(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Authorize shared-page</title><style>
body{font-family:system-ui,sans-serif;background:#f7f0df;color:#453a31;margin:0;min-height:100vh;display:grid;place-items:center}
main{width:min(88vw,360px);background:#fffaf0;border:1px solid #d8c9ad;padding:28px;box-shadow:6px 7px 0 #d6b7ab}
h1{font-size:1.35rem;margin-top:0}label{display:block;margin:18px 0 7px}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #aa9481;background:white}
button{margin-top:18px;width:100%;padding:11px;border:0;background:#704f55;color:white;font-weight:700}.error{color:#9d2f36}
</style></head><body><main><h1>Connect shared-page</h1>
<p><strong>${escapeHtml(clientName)}</strong> 想要存取這本共享日曆。</p>${notice}
<form method="post" action="/authorize"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
<label for="password">Owner password</label><input id="password" name="password" type="password" required autocomplete="current-password">
<button type="submit">Authorize</button></form></main></body></html>`, {
    status: message ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function beginAuthorization(request: Request, env: Env): Promise<Response> {
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (isAuthorizationError(error)) return oauthError(error);
    throw error;
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return new Response("Unknown OAuth client", { status: 400 });
  const nonce = crypto.randomUUID();
  await env.OAUTH_KV.put(`${STATE_PREFIX}${nonce}`, JSON.stringify(oauthRequest), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return loginPage(client.clientName || oauthRequest.clientId, nonce);
}

async function finishAuthorization(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response("Invalid origin", { status: 403 });
  }
  const form = await request.formData();
  const nonce = String(form.get("nonce") || "");
  const password = String(form.get("password") || "");
  const key = `${STATE_PREFIX}${nonce}`;
  const stored = nonce ? await env.OAUTH_KV.get(key) : null;
  if (!stored || !env.MCP_OWNER_PASSWORD || !constantTimeEqual(password, env.MCP_OWNER_PASSWORD)) {
    return loginPage("the requesting MCP client", nonce, "密碼不正確或授權已逾時。請重新連線。 ");
  }
  await env.OAUTH_KV.delete(key);
  const oauthRequest = JSON.parse(stored) as AuthRequest;
  const grantedScopes = oauthRequest.scope.filter((scope) => ALLOWED_SCOPES.has(scope));
  const scopes = grantedScopes.length ? grantedScopes : ["calendar:read", "calendar:write"];
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: "shared-page-owner",
    metadata: { purpose: "official-chatgpt-calendar" },
    scope: scopes,
    props: { userId: "shared-page-owner", scopes },
  });
  return Response.redirect(redirectTo, 302);
}

export const authHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("shared-page MCP", { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });
    if (request.method === "GET") return beginAuthorization(request, env);
    if (request.method === "POST") return finishAuthorization(request, env);
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  },
};
