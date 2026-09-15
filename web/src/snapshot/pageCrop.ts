import type { CalendarNote, DayEvent } from "../domain/calendar";
import type { PlacedItem } from "../domain/scrapbook";

export const PAGE_WIDTH = 402;
export const PAGE_RENDER_SCALE = 1.5;
export const PAGE_ROW_HEIGHT = 52;
export const PAGE_FIRST_HOUR = 6;
export const PAGE_LAST_HOUR = 23;
export const PAGE_TIMELINE_HEIGHT = 10 + (PAGE_LAST_HOUR - PAGE_FIRST_HOUR + 1) * PAGE_ROW_HEIGHT + 96;

export interface PageCropResult {
  top: number;
  height: number;
}

export function pageTimelineY(hour: number, minute = 0): number {
  return 10 + (hour - PAGE_FIRST_HOUR) * PAGE_ROW_HEIGHT + minute / 60 * PAGE_ROW_HEIGHT;
}

function placedRadius(item: PlacedItem): number {
  const [width, height] = item.kind === "photo"
    ? [92, 143]
    : item.kind === "emoji"
      ? [54, 54]
      : [92, 92];
  return Math.hypot(width, height) / 2 * item.scale;
}

/** Pure port of iOS PageCrop.compute. It works from canonical domain coordinates,
 * never DOM bounds or the current viewport. */
export function computePageCrop(
  events: DayEvent[],
  notes: CalendarNote[],
  placed: PlacedItem[]
): PageCropResult {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const cover = (top: number, bottom: number) => {
    minY = Math.min(minY, top);
    maxY = Math.max(maxY, bottom);
  };

  for (const event of events.filter((entry) => !entry.isAllDay)) {
    const startHour = Math.floor(event.startMinute / 60);
    const startMinute = event.startMinute % 60;
    const top = pageTimelineY(startHour, startMinute);
    const duration = Math.max(1, event.endMinute - event.startMinute);
    cover(top, top + Math.max(34, duration / 60 * PAGE_ROW_HEIGHT - 3));
  }

  notes.forEach((note, index) => {
    const baseY = note.y ?? 34 + index * 116;
    cover(baseY - 16, baseY + 110);
  });

  for (const item of placed) {
    const radius = placedRadius(item);
    cover(item.y - radius, item.y + radius);
  }

  if (minY > maxY) cover(96, 176);

  const topHour = Math.max(
    PAGE_FIRST_HOUR,
    Math.min(PAGE_LAST_HOUR, PAGE_FIRST_HOUR + Math.floor((minY - 10) / PAGE_ROW_HEIGHT))
  );
  const bottomHour = Math.max(
    PAGE_FIRST_HOUR,
    Math.min(PAGE_LAST_HOUR, PAGE_FIRST_HOUR + Math.ceil((maxY - 10) / PAGE_ROW_HEIGHT))
  );
  const top = Math.max(0, pageTimelineY(topHour) - 8);
  const bottom = Math.min(PAGE_TIMELINE_HEIGHT, pageTimelineY(bottomHour) + 12);
  return { top, height: Math.max(PAGE_ROW_HEIGHT, bottom - top) };
}
