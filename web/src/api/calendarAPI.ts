import type { ConnectionConfig } from "../config/connection";
import type { CalendarMonth, EventDTO } from "../domain/calendar";
import { parseEventList } from "../domain/calendarDTO";
import { apiMonthRange } from "../domain/calendarTime";

export class CalendarApiError extends Error {
  constructor(
    message: string,
    readonly kind: "offline" | "unauthorized" | "bad-request" | "not-found" | "server",
    readonly status?: number
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

function apiUrl(baseUrl: string, path: string, query?: URLSearchParams): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = `${base}/${path.replace(/^\/+/, "")}`;
  return query?.size ? `${suffix}?${query.toString()}` : suffix;
}

async function requestJson(
  config: ConnectionConfig,
  path: string,
  query: URLSearchParams | undefined,
  signal: AbortSignal
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(apiUrl(config.apiBaseUrl, path, query), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Calendar-Token": config.token
      },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    if (response.ok) return await response.json();

    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      detail = "";
    }

    if (response.status === 401 || response.status === 403) {
      throw new CalendarApiError(detail || "Calendar token was rejected.", "unauthorized", response.status);
    }
    if (response.status === 404) {
      throw new CalendarApiError(detail || "Calendar endpoint was not found.", "not-found", response.status);
    }
    if (response.status === 400 || response.status === 422) {
      throw new CalendarApiError(detail || "Calendar request was invalid.", "bad-request", response.status);
    }
    throw new CalendarApiError(detail || `Calendar server returned ${response.status}.`, "server", response.status);
  } catch (error) {
    if (error instanceof CalendarApiError) throw error;
    if (signal.aborted) throw error;
    throw new CalendarApiError("Could not reach the calendar backend.", "offline");
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function listCalendarMonth(
  config: ConnectionConfig,
  month: CalendarMonth,
  signal: AbortSignal
): Promise<EventDTO[]> {
  const range = apiMonthRange(month);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  return parseEventList(await requestJson(config, "events", query, signal));
}

export async function listUnseenDays(
  config: ConnectionConfig,
  signal: AbortSignal
): Promise<Set<string>> {
  const response = await requestJson(config, "unseen", undefined, signal);
  if (!response || typeof response !== "object" || !Array.isArray((response as { days?: unknown }).days)) {
    throw new CalendarApiError("Unseen response did not contain a days array.", "server");
  }
  return new Set(
    (response as { days: unknown[] }).days.filter((day): day is string => typeof day === "string")
  );
}
