import type { CalendarMonth } from "../domain/calendar";
import {
  currentProductMonth,
  monthFromDayKey,
  monthKey,
  parseDayKey,
  parseMonthKey
} from "../domain/calendarTime";

export type AppRoute =
  | { kind: "month"; month: CalendarMonth }
  | { kind: "day"; dayKey: string; month: CalendarMonth };

export function routeFromUrl(url: URL, fallbackMonth = currentProductMonth()): AppRoute {
  const dayMatch = /^\/day\/(\d{4}-\d{2}-\d{2})\/?$/.exec(url.pathname);
  if (dayMatch && parseDayKey(dayMatch[1])) {
    return {
      kind: "day",
      dayKey: dayMatch[1],
      month: monthFromDayKey(dayMatch[1])!
    };
  }

  return {
    kind: "month",
    month: parseMonthKey(url.searchParams.get("month") ?? "") ?? fallbackMonth
  };
}

export function monthRouteUrl(month: CalendarMonth): string {
  return `/?month=${monthKey(month)}`;
}

export function dayRouteUrl(day: string): string {
  if (!parseDayKey(day)) throw new Error("invalid calendar day");
  return `/day/${day}`;
}
