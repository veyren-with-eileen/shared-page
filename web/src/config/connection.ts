const SESSION_KEY = "shared-page.connection.v1";

export interface ConnectionConfig {
  apiBaseUrl: string;
  token: string;
}

declare global {
  interface Window {
    __SHARED_PAGE_CONFIG__?: Partial<{
      apiBaseUrl: string;
      token: string;
    }>;
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "/api/v1/calendar";
  return trimmed.replace(/\/+$/, "");
}

function runtimeConfig(): ConnectionConfig {
  const runtime = window.__SHARED_PAGE_CONFIG__ ?? {};
  return {
    apiBaseUrl: normalizeBaseUrl(runtime.apiBaseUrl ?? "/api/v1/calendar"),
    token: (runtime.token ?? "").trim()
  };
}

export function loadConnection(): ConnectionConfig {
  const runtime = runtimeConfig();
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return runtime;
    const local = JSON.parse(saved) as Partial<ConnectionConfig>;
    return {
      apiBaseUrl: normalizeBaseUrl(local.apiBaseUrl ?? runtime.apiBaseUrl),
      token: (local.token ?? runtime.token).trim()
    };
  } catch {
    return runtime;
  }
}

export function saveSessionConnection(config: ConnectionConfig): ConnectionConfig {
  const normalized = {
    apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl),
    token: config.token.trim()
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearSessionConnection() {
  sessionStorage.removeItem(SESSION_KEY);
}
