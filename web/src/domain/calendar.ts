export const PRODUCT_TIME_ZONE = "Asia/Shanghai";

export type Author = "kitty" | "master" | "system";

export const AUTHOR_LABEL: Record<Author, string> = {
  kitty: "USER",
  master: "ASSISTANT",
  system: "AUTO"
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface EventDTO {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string | null;
  precision: string | null;
  eventType: string | null;
  source: string | null;
  createdBy: string | null;
  revision: number | null;
  status: string | null;
  metadata: JsonValue | null;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export interface CalendarEvent {
  id: string;
  author: Author;
  title: string;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  isAllDay: boolean;
  isAutoSuggestion: boolean;
  eventType: string | null;
  revision: number | null;
  source: string | null;
}

export interface CalendarSpanClip {
  headStart?: string;
  tailEnd?: string;
}

export interface CalendarSpan {
  id: string;
  author: Author;
  title: string;
  startDay: number;
  endDay: number;
  clip?: CalendarSpanClip;
  revision: number | null;
}

export interface DayRange {
  start: number;
  end: number;
}

export interface MonthPayload {
  events: Map<number, CalendarEvent[]>;
  spans: CalendarSpan[];
  periods: DayRange[];
}

export const SPECIAL_DAY_TYPES = new Set(["anniversary", "birthday"]);
