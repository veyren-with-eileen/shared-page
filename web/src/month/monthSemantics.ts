import { isSpecialDayType } from "../domain/calendar";

export function hasSpecialDay(events: ReadonlyArray<{ eventType: string | null }>): boolean {
  return events.some((event) => isSpecialDayType(event.eventType));
}
