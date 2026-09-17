import { AUTHOR_LABEL, SPECIAL_DAY_TYPES, type Author, type CalendarNote, type DayEvent, type DayPayload } from "../domain/calendar";
import { parseDayKey, productDateParts, weekdayLabelForDay } from "../domain/calendarTime";
import { itemBaseSize, type PlacedItem } from "../domain/scrapbook";
import { TornNote } from "../notes/TornNote";
import { PlacedArt, placedItemSource } from "../scrapbook/PlacedLayer";
import type { ScrapbookStore } from "../state/scrapbookStore";
import {
  PAGE_FIRST_HOUR,
  PAGE_LAST_HOUR,
  PAGE_ROW_HEIGHT,
  PAGE_TIMELINE_HEIGHT,
  PAGE_WIDTH,
  computePageCrop,
  pageTimelineY
} from "./pageCrop";
import "./snapshot.css";

export interface SnapshotDayState {
  dayKey: string;
  payload: DayPayload;
  notes: CalendarNote[];
  placed: PlacedItem[];
}

function authorClass(author: Author): string { return `author-${author}`; }

function minuteLabel(minute: number): string {
  const value = Math.max(0, Math.min(1440, minute));
  if (value === 1440) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function originalClock(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = productDateParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function eventLabel(event: DayEvent): string {
  if (event.isAllDay) {
    return event.isSpan && event.spanIndex && event.spanLength
      ? `DAY ${event.spanIndex}/${event.spanLength}`
      : "ALL DAY";
  }
  const start = originalClock(event.originalStartsAt) ?? minuteLabel(event.startMinute);
  const end = originalClock(event.originalEndsAt) ?? minuteLabel(event.endMinute);
  return `${event.continuesBefore ? "↤ " : ""}${start}–${end}${event.continuesAfter ? " ↦" : ""}`;
}

function eventStyle(event: DayEvent) {
  const start = Math.max(PAGE_FIRST_HOUR * 60, event.startMinute);
  const end = Math.min(1440, event.endMinute);
  return {
    top: `${pageTimelineY(Math.floor(start / 60), start % 60)}px`,
    height: `${Math.max(34, (end - start) / 60 * PAGE_ROW_HEIGHT - 3)}px`
  };
}

function StaticPlacedLayer({ store, items }: { store: ScrapbookStore; items: PlacedItem[] }) {
  return <div class="snapshot-placed-layer" aria-hidden="true">
    {items.map((item) => {
      const sticker = item.stickerId ? store.sticker(item.stickerId) : undefined;
      const source = placedItemSource(item, sticker, store);
      const size = itemBaseSize(item, sticker);
      return <span class="snapshot-placed-position" style={{ left: `${item.x}px`, top: `${item.y}px` }} key={item.id}>
        <span class="snapshot-placed-item" style={{ width: `${size.x}px`, height: `${size.y}px`, transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})` }}>
          <PlacedArt item={item} source={source} />
        </span>
      </span>;
    })}
  </div>;
}

export function DayPageSnapshot({ state, scrapbook }: { state: SnapshotDayState; scrapbook: ScrapbookStore }) {
  const parts = parseDayKey(state.dayKey);
  if (!parts) return null;
  const crop = computePageCrop(state.payload.timed, state.notes, state.placed);
  const empty = state.payload.allDay.length === 0 && state.payload.timed.length === 0 && state.notes.length === 0 && state.placed.length === 0;

  return <article class="day-page-snapshot" data-page-day={state.dayKey} style={{ width: `${PAGE_WIDTH}px` }}>
    <header class="snapshot-title-row">
      <div><h1>{parts.month}月{parts.day}日</h1><p>{weekdayLabelForDay(state.dayKey)}</p></div>
    </header>

    {state.payload.allDay.length > 0 && <section class="snapshot-all-day-rows">
      {state.payload.allDay.map((event) => <div class={`snapshot-all-day-event ${authorClass(event.author)}`} key={`${event.id}-${event.spanIndex ?? 0}`}>
        <strong>{event.title}</strong>
        <span>{eventLabel(event)} · {AUTHOR_LABEL[event.author]}</span>
        {event.eventType && SPECIAL_DAY_TYPES.has(event.eventType) && <img src="/assets/stamp-heart-mini.png" alt="" />}
      </div>)}
    </section>}

    <section class="snapshot-timeline-window" style={{ height: `${crop.height}px` }}>
      <div class="snapshot-timeline-content" style={{ height: `${PAGE_TIMELINE_HEIGHT}px`, transform: `translateY(${-crop.top}px)` }}>
        <div class="snapshot-grid-paper" />
        {Array.from({ length: PAGE_LAST_HOUR - PAGE_FIRST_HOUR + 1 }, (_, index) => PAGE_FIRST_HOUR + index).map((hour) => <div class="snapshot-hour-row" style={{ top: `${pageTimelineY(hour)}px` }} key={hour}><span>{String(hour).padStart(2, "0")}:00</span><i /></div>)}
        {state.payload.timed.filter((event) => event.endMinute > PAGE_FIRST_HOUR * 60 && event.startMinute < 1440).map((event) => <div class={`snapshot-timed-event ${authorClass(event.author)}`} style={eventStyle(event)} key={`${event.id}-${event.startMinute}`}>
          <strong>{event.title}</strong><span>{eventLabel(event)} · {AUTHOR_LABEL[event.author]}</span>
        </div>)}
        {state.notes.map((note, index) => {
          const linkedTitle = note.linkedEventId ? state.payload.timed.find((event) => event.id === note.linkedEventId)?.title : undefined;
          return <div class="snapshot-note-position" style={{ left: `${note.author === "master" ? 58 : 214}px`, top: `${note.y ?? 34 + index * 116}px` }} key={note.id}>
            <TornNote note={note} index={index} linkedTitle={linkedTitle} active={false} dragging={false} offsetY={0} onText={() => undefined} onDelete={() => undefined} onDoubleTap={() => undefined} onPointerDown={() => undefined} onPointerMove={() => undefined} onPointerUp={() => undefined} onPointerCancel={() => undefined} onFocusRequest={() => undefined} />
          </div>;
        })}
        <StaticPlacedLayer store={scrapbook} items={state.placed} />
        {empty && <div class="snapshot-empty"><span>這一天還空著</span><small>nothing here yet</small></div>}
      </div>
    </section>
  </article>;
}
