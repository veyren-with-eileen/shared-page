import { PRODUCT_TIME_ZONE } from "../domain/calendar";

const SESSION_KEY = "shared-page.connection.v1";

export interface ConnectionConfig {
  apiBaseUrl: string;
  token: string;
  productTimeZone: string;
}

declare global {
  interface Window {
    __SHARED_PAGE_CONFIG__?: Partial<{
      apiBaseUrl: string;
      token: string;
      productTimeZone: string;
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
    token: (runtime.token ?? "").trim(),
    productTimeZone: runtime.productTimeZone ?? PRODUCT_TIME_ZONE
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
      token: (local.token ?? runtime.token).trim(),
      productTimeZone: local.productTimeZone ?? runtime.productTimeZone
    };
  } catch {
    return runtime;
  }
}

export function saveSessionConnection(config: ConnectionConfig): ConnectionConfig {
  const normalized = {
    apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl),
    token: config.token.trim(),
    productTimeZone: PRODUCT_TIME_ZONE
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearSessionConnection() {
  sessionStorage.removeItem(SESSION_KEY);
}
