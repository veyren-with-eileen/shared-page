import { useCallback, useEffect, useState } from "preact/hooks";
import type { CalendarMonth } from "../domain/calendar";
import type { CalendarStore } from "./calendarStore";
import { monthKey } from "../domain/calendarTime";

export function useCalendarMonth(store: CalendarStore, month: CalendarMonth) {
  const [, setRevision] = useState(0);
  const retry = useCallback(() => void store.loadMonth(month, true), [store, monthKey(month)]);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setRevision((value) => value + 1));
    void store.loadMonth(month);
    return unsubscribe;
  }, [store, monthKey(month)]);

  return { ...store.snapshot(month), retry };
}
