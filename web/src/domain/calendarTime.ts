import { PRODUCT_TIME_ZONE, type CalendarMonth } from "./calendar";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
] as const;

const WEEKDAY_LABELS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
] as const;

export const WEEKDAY_HEADERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const productFormatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
  timeZone: PRODUCT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export interface ProductDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface DayKeyParts {
  year: number;
  month: number;
  day: number;
}

export interface MonthGridDay {
  key: string;
  day: number;
  inMonth: boolean;
  month: CalendarMonth;
}

export function normalizeMonth(year: number, month: number): CalendarMonth {
  const index = year * 12 + (month - 1);
  const normalizedYear = Math.floor(index / 12);
  return {
    year: normalizedYear,
    month: index - normalizedYear * 12 + 1
  };
}

export function parseMonthKey(key: string): CalendarMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

export function monthKey(value: CalendarMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

export function monthLabel(value: CalendarMonth): string {
  return MONTH_LABELS[value.month - 1];
}

export function previousMonth(value: CalendarMonth): CalendarMonth {
  return normalizeMonth(value.year, value.month - 1);
}

export function nextMonth(value: CalendarMonth): CalendarMonth {
  return normalizeMonth(value.year, value.month + 1);
}

export function daysInMonth(value: CalendarMonth): number {
  return new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
}

export function leadingBlanks(value: CalendarMonth): number {
  const sundayBased = new Date(Date.UTC(value.year, value.month - 1, 1)).getUTCDay();
  return (sundayBased + 6) % 7;
}

export function weekRows(value: CalendarMonth): number {
  return Math.ceil((leadingBlanks(value) + daysInMonth(value)) / 7);
}

export function dayKey(value: CalendarMonth, day: number): string {
  return `${monthKey(value)}-${String(day).padStart(2, "0")}`;
}

export function parseDayKey(key: string): DayKeyParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (parts.month < 1 || parts.month > 12) return null;
  if (parts.day < 1 || parts.day > daysInMonth(parts)) return null;
  return parts;
}

export function monthFromDayKey(key: string): CalendarMonth | null {
  const parts = parseDayKey(key);
  return parts ? { year: parts.year, month: parts.month } : null;
}

export function productDateParts(date: Date): ProductDateParts {
  const fields = Object.fromEntries(
    productFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second
  };
}

export function productDaySerial(date: Date): number {
  const parts = productDateParts(date);
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

export function monthFirstSerial(value: CalendarMonth): number {
  return Date.UTC(value.year, value.month - 1, 1) / 86_400_000;
}

export function dayIndex(date: Date, value: CalendarMonth): number {
  return productDaySerial(date) - monthFirstSerial(value) + 1;
}

export function daySerialFromKey(key: string): number | null {
  const parts = parseDayKey(key);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000 : null;
}

export function dayKeyFromSerial(serial: number): string {
  const date = new Date(serial * 86_400_000);
  return dayKey(
    { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 },
    date.getUTCDate()
  );
}

export function adjacentDayKey(key: string, offset: number): string | null {
  const serial = daySerialFromKey(key);
  return serial === null ? null : dayKeyFromSerial(serial + offset);
}

export function productDayRange(key: string): { start: Date; end: Date } | null {
  const parts = parseDayKey(key);
  if (!parts) return null;
  const start = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - TAIPEI_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function weekdayLabelForDay(key: string): string {
  const serial = daySerialFromKey(key);
  if (serial === null) return "";
  return WEEKDAY_LABELS[new Date(serial * 86_400_000).getUTCDay()];
}

export function weekdayLetterForDay(key: string): string {
  const serial = daySerialFromKey(key);
  if (serial === null) return "";
  const sundayBased = new Date(serial * 86_400_000).getUTCDay();
  return WEEKDAY_LETTERS[(sundayBased + 6) % 7];
}

export function currentProductMonth(now = new Date()): CalendarMonth {
  const parts = productDateParts(now);
  return { year: parts.year, month: parts.month };
}

export function currentProductDay(now = new Date()): string {
  const parts = productDateParts(now);
  return dayKey({ year: parts.year, month: parts.month }, parts.day);
}

export function todayInMonth(value: CalendarMonth, now = new Date()): number | null {
  const parts = productDateParts(now);
  return parts.year === value.year && parts.month === value.month ? parts.day : null;
}

function productMonthMidnightUtc(value: CalendarMonth): Date {
  return new Date(Date.UTC(value.year, value.month - 1, 1) - TAIPEI_OFFSET_MS);
}

export function apiMonthRange(value: CalendarMonth): { from: string; to: string } {
  return {
    from: productMonthMidnightUtc(value).toISOString().replace(".000", ""),
    to: productMonthMidnightUtc(nextMonth(value)).toISOString().replace(".000", "")
  };
}

export function monthGrid(value: CalendarMonth): MonthGridDay[] {
  const previous = previousMonth(value);
  const next = nextMonth(value);
  const leading = leadingBlanks(value);
  const total = weekRows(value) * 7;
  const previousDays = daysInMonth(previous);
  const currentDays = daysInMonth(value);

  return Array.from({ length: total }, (_, index) => {
    const number = index - leading + 1;
    if (number < 1) {
      const day = previousDays + number;
      return { key: dayKey(previous, day), day, inMonth: false, month: previous };
    }
    if (number > currentDays) {
      const day = number - currentDays;
      return { key: dayKey(next, day), day, inMonth: false, month: next };
    }
    return { key: dayKey(value, number), day: number, inMonth: true, month: value };
  });
}
