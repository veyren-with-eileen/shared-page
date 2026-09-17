import type { SpecialDayType } from "../domain/calendar";
import { isSpecialDayType } from "../domain/calendar";

export const EVENT_TYPE_LABEL: Readonly<Record<SpecialDayType, string>> = {
  anniversary: "紀念日",
  birthday: "生日"
};

export function eventTypeLabel(value: string | null | undefined): string | null {
  return isSpecialDayType(value) ? EVENT_TYPE_LABEL[value] : null;
}
