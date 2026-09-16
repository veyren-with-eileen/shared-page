import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface ApplicationService {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  APPLICATION: ApplicationService;
  MCP_OWNER_PASSWORD: string;
  MCP_INTERNAL_TOKEN: string;
}

export interface AuthProps {
  userId: string;
  scopes: string[];
}

export type CalendarArguments = {
  action: "list" | "see" | "create" | "update" | "delete" | "comment";
  event_id?: string;
  note_id?: string;
  liked?: boolean;
  title?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  precision?: "minute" | "hour" | "segment" | "day";
  event_type?: string;
  comment?: string;
  date?: string;
  at?: string;
  from?: string;
  to?: string;
  new_only?: boolean;
  limit?: number;
};

export type CalendarContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface CalendarServiceResult {
  content: CalendarContent[];
  isError?: boolean;
}
