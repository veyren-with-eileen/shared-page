import type { EventDTO } from "../domain/calendar";
import { dayKeyFromSerial, productDaySerial } from "../domain/calendarTime";

export interface PageDirtySink {
  markDirty(dayKey: string): void;
}

export const NOOP_PAGE_DIRTY: PageDirtySink = { markDirty: () => undefined };

export function isValidPageDayKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]);
}

export function eventRenderedDayKeys(event: EventDTO | null | undefined): string[] {
  if (!event) return [];
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt ?? event.startsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return [];
  const startSerial = productDaySerial(starts);
  const endProbe = ends.getTime() > starts.getTime() ? new Date(ends.getTime() - 1) : starts;
  const endSerial = Math.max(startSerial, productDaySerial(endProbe));
  const keys: string[] = [];
  for (let serial = startSerial; serial <= endSerial; serial += 1) keys.push(dayKeyFromSerial(serial));
  return keys;
}

export function markEventTransition(
  sink: PageDirtySink,
  before: EventDTO | null | undefined,
  after: EventDTO | null | undefined
) {
  const keys = new Set([...eventRenderedDayKeys(before), ...eventRenderedDayKeys(after)]);
  for (const key of keys) sink.markDirty(key);
}
