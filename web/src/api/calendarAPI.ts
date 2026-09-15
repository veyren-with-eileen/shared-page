import type { ConnectionConfig } from "../config/connection";
import type { CalendarMonth, EventDTO, EventWritePayload, NoteDTO, NoteWritePayload } from "../domain/calendar";
import { parseEventDTO, parseEventList, parseNoteDTO, parseNoteList } from "../domain/calendarDTO";
import { apiMonthRange, dayKey, nextMonth } from "../domain/calendarTime";

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
  signal: AbortSignal | undefined,
  method = "GET",
  body?: EventWritePayload | NoteWritePayload | { date: string }
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(apiUrl(config.apiBaseUrl, path, query), {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-Calendar-Token": config.token
      },
      body: body ? JSON.stringify(body) : undefined,
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
    if (signal?.aborted) throw error;
    throw new CalendarApiError("Could not reach the calendar backend.", "offline");
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export interface CalendarGateway {
  listMonth(month: CalendarMonth, signal: AbortSignal): Promise<EventDTO[]>;
  listUnseen(signal: AbortSignal): Promise<Set<string>>;
  listNotes(month: CalendarMonth, signal: AbortSignal): Promise<NoteDTO[]>;
  createEvent(payload: EventWritePayload): Promise<EventDTO>;
  updateEvent(id: string, payload: EventWritePayload): Promise<EventDTO>;
  deleteEvent(id: string): Promise<EventDTO>;
  markSeen(day: string): Promise<void>;
  createNote(payload: NoteWritePayload): Promise<NoteDTO>;
  updateNote(id: string, payload: NoteWritePayload): Promise<NoteDTO>;
  deleteNote(id: string): Promise<NoteDTO>;
}

export async function listCalendarNotes(config: ConnectionConfig, month: CalendarMonth, signal: AbortSignal): Promise<NoteDTO[]> {
  const query = new URLSearchParams({ from: dayKey(month, 1), to: dayKey(nextMonth(month), 1) });
  return parseNoteList(await requestJson(config, "notes", query, signal));
}

export async function createCalendarNote(config: ConnectionConfig, payload: NoteWritePayload): Promise<NoteDTO> {
  return parseNoteDTO(await requestJson(config, "notes", undefined, undefined, "POST", payload));
}

export async function updateCalendarNote(config: ConnectionConfig, id: string, payload: NoteWritePayload): Promise<NoteDTO> {
  return parseNoteDTO(await requestJson(config, `notes/${encodeURIComponent(id)}`, undefined, undefined, "PATCH", payload));
}

export async function deleteCalendarNote(config: ConnectionConfig, id: string): Promise<NoteDTO> {
  return parseNoteDTO(await requestJson(config, `notes/${encodeURIComponent(id)}`, undefined, undefined, "DELETE"));
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

export async function createCalendarEvent(
  config: ConnectionConfig,
  payload: EventWritePayload
): Promise<EventDTO> {
  return parseEventDTO(await requestJson(config, "events", undefined, undefined, "POST", payload));
}

export async function updateCalendarEvent(
  config: ConnectionConfig,
  id: string,
  payload: EventWritePayload
): Promise<EventDTO> {
  return parseEventDTO(await requestJson(config, `events/${encodeURIComponent(id)}`, undefined, undefined, "PATCH", payload));
}

export async function deleteCalendarEvent(
  config: ConnectionConfig,
  id: string
): Promise<EventDTO> {
  return parseEventDTO(await requestJson(config, `events/${encodeURIComponent(id)}`, undefined, undefined, "DELETE"));
}

export async function markCalendarDaySeen(config: ConnectionConfig, day: string): Promise<void> {
  await requestJson(config, "unseen/seen", undefined, undefined, "POST", { date: day });
}

export function createCalendarGateway(config: ConnectionConfig): CalendarGateway {
  return {
    listMonth: (month, signal) => listCalendarMonth(config, month, signal),
    listUnseen: (signal) => listUnseenDays(config, signal),
    listNotes: (month, signal) => listCalendarNotes(config, month, signal),
    createEvent: (payload) => createCalendarEvent(config, payload),
    updateEvent: (id, payload) => updateCalendarEvent(config, id, payload),
    deleteEvent: (id) => deleteCalendarEvent(config, id),
    markSeen: (day) => markCalendarDaySeen(config, day),
    createNote: (payload) => createCalendarNote(config, payload),
    updateNote: (id, payload) => updateCalendarNote(config, id, payload),
    deleteNote: (id) => deleteCalendarNote(config, id)
  };
}
