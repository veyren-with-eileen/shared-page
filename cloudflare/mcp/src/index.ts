import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";

import { authHandler } from "./auth";
import { createCalendarServer } from "./calendarTool";
import type { Env } from "./types";

const mcpHandler = {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return createMcpHandler(() => createCalendarServer(env))(request, env, context);
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["calendar:read", "calendar:write"],
  accessTokenTTL: 3600,
  refreshTokenTTL: 2_592_000,
});
