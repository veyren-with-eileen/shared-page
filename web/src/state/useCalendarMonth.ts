import { useCallback, useEffect, useState } from "preact/hooks";
import type { ConnectionConfig } from "../config/connection";
import type { CalendarMonth, MonthPayload } from "../domain/calendar";
import { materializeEvents } from "../domain/calendarDTO";
import { monthKey } from "../domain/calendarTime";
import {
  CalendarApiError,
  listCalendarMonth,
  listUnseenDays
} from "../api/calendarAPI";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

function emptyPayload(): MonthPayload {
  return { events: new Map(), spans: [], periods: [] };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof CalendarApiError)) return "couldn't load · tap to retry";
  switch (error.kind) {
    case "unauthorized":
      return "token rejected · check connection";
    case "not-found":
      return "calendar route not found";
    case "bad-request":
      return "calendar request was rejected";
    default:
      return "couldn't load · tap to retry";
  }
}

export function useCalendarMonth(config: ConnectionConfig, month: CalendarMonth) {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [payload, setPayload] = useState<MonthPayload>(emptyPayload);
  const [unseenDays, setUnseenDays] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("tap a day to open it");
  const [revision, setRevision] = useState(0);

  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!config.token) {
      setStatus("idle");
      setPayload(emptyPayload());
      setUnseenDays(new Set());
      setMessage("calendar connection required");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setMessage("syncing…");

    Promise.all([
      listCalendarMonth(config, month, controller.signal),
      listUnseenDays(config, controller.signal)
    ])
      .then(([events, unseen]) => {
        if (controller.signal.aborted) return;
        setPayload(materializeEvents(events, month));
        setUnseenDays(unseen);
        setStatus("ready");
        setMessage("tap a day to open it");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(emptyPayload());
        setStatus("error");
        setMessage(errorMessage(error));
      });

    return () => controller.abort();
  }, [config.apiBaseUrl, config.token, monthKey(month), revision]);

  return { status, payload, unseenDays, message, retry };
}
