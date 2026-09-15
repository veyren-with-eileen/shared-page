import { useEffect, useMemo, useState } from "preact/hooks";
import { AUTHOR_LABEL, SPECIAL_DAY_TYPES, type Author, type CalendarSpan, type DayEvent, type EventDTO, type EventDraft } from "../domain/calendar";
import { materializeDay } from "../domain/calendarDTO";
import { adjacentDayKey, currentProductDay, monthFromDayKey, monthLabel, parseDayKey, productDateParts, weekdayLabelForDay, weekdayLetterForDay } from "../domain/calendarTime";
import { useCalendarMonth } from "../state/useCalendarMonth";
import type { CalendarStore } from "../state/calendarStore";
import { CanvasViewport } from "../app/CanvasViewport";
import { EventEditor } from "../editors/EventEditor";
import { SpanEditor } from "../editors/SpanEditor";
import "./day.css";

const FIRST_HOUR = 6;
const LAST_HOUR = 23;
const ROW_HEIGHT = 52;
const TIMELINE_HEIGHT = 10 + (LAST_HOUR - FIRST_HOUR + 1) * ROW_HEIGHT + 96;

interface DayPageProps {
  store: CalendarStore;
  dateKey: string;
  onBack(): void;
  onDayChange(dayKey: string): void;
}

function authorClass(author: Author): string { return `author-${author}`; }

function formatMinute(minute: number): string {
  const normalized = Math.max(0, Math.min(1440, minute));
  if (normalized === 1440) return "24:00";
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function originalClock(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = productDateParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function eventTimeLabel(event: DayEvent): string {
  if (event.isAllDay) return event.isSpan && event.spanIndex && event.spanLength ? `DAY ${event.spanIndex}/${event.spanLength}` : "ALL DAY";
  const start = originalClock(event.originalStartsAt) ?? formatMinute(event.startMinute);
  const end = originalClock(event.originalEndsAt) ?? formatMinute(event.endMinute);
  return `${event.continuesBefore ? "↤ " : ""}${start}–${end}${event.continuesAfter ? " ↦" : ""}`;
}

function eventStyle(event: DayEvent) {
  const start = Math.max(FIRST_HOUR * 60, event.startMinute);
  const end = Math.min(1440, event.endMinute);
  const top = 10 + ((start - FIRST_HOUR * 60) / 60) * ROW_HEIGHT;
  const height = Math.max(34, ((end - start) / 60) * ROW_HEIGHT - 3);
  return { top: `${top}px`, height: `${height}px` };
}

function stripDays(dateKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => adjacentDayKey(dateKey, index - 3)).filter((value): value is string => value !== null);
}

function EventDetail({ event, dateKey, onClose, onEdit }: { event: DayEvent; dateKey: string; onClose(): void; onEdit(): void }) {
  const parts = parseDayKey(dateKey)!;
  const editable = !event.isSpan && !event.continuesBefore && !event.continuesAfter;
  return (
    <div class="event-detail-backdrop" role="presentation" onClick={onClose}>
      <section class={`event-detail-sheet ${authorClass(event.author)}`} role="dialog" aria-modal="true" aria-labelledby="event-detail-title" onClick={(click) => click.stopPropagation()}>
        <div class="detail-handle" aria-hidden="true" />
        <div class="detail-kicker"><span>{AUTHOR_LABEL[event.author]}</span>{event.eventType && <span>{event.eventType.toUpperCase()}</span>}</div>
        <h2 id="event-detail-title">{event.title}</h2>
        <dl>
          <div><dt>DATE</dt><dd>{parts.year}-{String(parts.month).padStart(2, "0")}-{String(parts.day).padStart(2, "0")} · {weekdayLabelForDay(dateKey)}</dd></div>
          <div><dt>TIME</dt><dd>{eventTimeLabel(event)}</dd></div>
          {event.isSpan && event.spanIndex && event.spanLength && <div><dt>SPAN</dt><dd>day {event.spanIndex} of {event.spanLength}</dd></div>}
          {(event.continuesBefore || event.continuesAfter) && <div><dt>RANGE</dt><dd>{[event.continuesBefore ? "continues from the previous day" : "", event.continuesAfter ? "continues into the next day" : ""].filter(Boolean).join(" · ")}</dd></div>}
        </dl>
        {event.description && <p class="detail-description">{event.description}</p>}
        {!editable && <p class="detail-readonly">跨日安排會在 Checkpoint 3B 編輯</p>}
        <div class="detail-actions">
          {editable && <button type="button" class="detail-edit" onClick={onEdit}>edit</button>}
          <button type="button" class="detail-done" onClick={onClose}>done</button>
        </div>
      </section>
    </div>
  );
}

export function DayPage({ store, dateKey, onBack, onDayChange }: DayPageProps) {
  const month = monthFromDayKey(dateKey)!;
  const parts = parseDayKey(dateKey)!;
  const { status, dtos, payload: monthPayload, unseenDays, message, retry, mutationMessage } = useCalendarMonth(store, month);
  const payload = useMemo(() => materializeDay(dtos, dateKey), [dtos, dateKey]);
  const [selectedEvent, setSelectedEvent] = useState<DayEvent | null>(null);
  const [editorEvent, setEditorEvent] = useState<EventDTO | null | undefined>(undefined);
  const [editingSpan, setEditingSpan] = useState<CalendarSpan | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const today = currentProductDay() === dateKey;
  const unseen = unseenDays.has(dateKey);
  const strip = stripDays(dateKey);
  const visibleTimed = payload.timed.filter((event) => event.endMinute > FIRST_HOUR * 60 && event.startMinute < 1440);

  useEffect(() => {
    setSelectedEvent(null);
    setEditorEvent(undefined);
    setEditingSpan(null);
    setFabOpen(false);
    void store.markSeen(dateKey);
  }, [store, dateKey]);

  function beginEdit(event: DayEvent) {
    const dto = store.event(event.id);
    if (!dto || store.isPending(event.id)) return;
    setSelectedEvent(null);
    setEditorEvent(dto);
  }

  function openEvent(event: DayEvent) {
    if (event.isSpan) {
      const span = monthPayload.spans.find((item) => item.id === event.id);
      if (span) setEditingSpan(span);
      return;
    }
    setSelectedEvent(event);
  }

  function saveEditor(draft: EventDraft) {
    if (editorEvent) void store.updateEvent(editorEvent.id, draft);
    else void store.createEvent(draft);
    setEditorEvent(undefined);
  }

  function deleteEditor() {
    if (editorEvent) void store.deleteEvent(editorEvent.id);
    setEditorEvent(undefined);
    setSelectedEvent(null);
  }

  return (
    <CanvasViewport fitViewportHeight>
      <main class="calendar-canvas day-canvas" aria-busy={status === "loading"}>
        <header class="day-back-header"><button type="button" onClick={onBack} aria-label={`Back to ${monthLabel(month)}`}><span>‹</span>{monthLabel(month)}</button></header>
        <nav class="day-strip" aria-label="Nearby dates">
          {strip.map((key) => {
            const stripParts = parseDayKey(key)!;
            const selected = key === dateKey;
            const inMonth = stripParts.year === month.year && stripParts.month === month.month;
            return <button type="button" class={[selected ? "is-selected" : "", inMonth ? "" : "is-dim"].join(" ")} onClick={() => onDayChange(key)} aria-current={selected ? "date" : undefined} key={key}><span>{weekdayLetterForDay(key)}</span><i>{selected && <img src="/assets/pink-date-circle.png" alt="" aria-hidden="true" />}<b>{stripParts.day}</b></i></button>;
          })}
        </nav>

        <section class="day-title-row"><div><h1>{parts.month}月{parts.day}日</h1><p>{weekdayLabelForDay(dateKey)}{today ? " · today" : ""}</p></div>{unseen && <img class="day-new-badge" src="/assets/red-exclaim-double.png" alt="NEW" />}</section>
        {status === "error" && <button class="day-status is-error" type="button" onClick={retry}>{message}</button>}
        {status === "loading" && <p class="day-status">syncing…</p>}

        {payload.allDay.length > 0 && <section class="all-day-rows" aria-label="All-day events">
          {payload.allDay.map((event) => <button type="button" class={`all-day-event ${authorClass(event.author)} ${store.isPending(event.id) ? "is-pending" : ""}`} key={event.id} onClick={() => openEvent(event)}><strong>{event.title}</strong><span>{eventTimeLabel(event)} · {AUTHOR_LABEL[event.author]}</span>{event.eventType && SPECIAL_DAY_TYPES.has(event.eventType) && <img src="/assets/stamp-heart-mini.png" alt="" aria-hidden="true" />}</button>)}
        </section>}

        <section class="day-timeline" aria-label="Timeline from 06:00 to 23:00">
          <div class="timeline-content" style={{ height: `${TIMELINE_HEIGHT}px` }}>
            <div class="timeline-grid-paper" aria-hidden="true" />
            {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, index) => FIRST_HOUR + index).map((hour) => <div class="hour-row" style={{ top: `${10 + (hour - FIRST_HOUR) * ROW_HEIGHT}px` }} key={hour}><span>{String(hour).padStart(2, "0")}:00</span><i /></div>)}
            {visibleTimed.map((event) => <button type="button" class={`timed-event ${authorClass(event.author)} ${store.isPending(event.id) ? "is-pending" : ""}`} style={eventStyle(event)} key={`${event.id}-${event.startMinute}`} onClick={() => setSelectedEvent(event)}><strong>{event.title}</strong><span>{eventTimeLabel(event)} · {AUTHOR_LABEL[event.author]}</span></button>)}
            {status === "ready" && payload.allDay.length === 0 && payload.timed.length === 0 && <div class="day-empty"><span>這一天還空著</span><small>nothing here yet</small></div>}
          </div>
        </section>

        <div class={fabOpen ? "event-fab is-open" : "event-fab"}>
          {fabOpen && <button class="event-fab-action" type="button" aria-label="New event" onClick={() => { setEditorEvent(null); setFabOpen(false); }}><img src="/assets/ic-event.png" alt="" aria-hidden="true" /></button>}
          <button class="event-fab-main" type="button" aria-label="Add" onClick={() => setFabOpen((open) => !open)}><span aria-hidden="true">+</span></button>
        </div>

        {mutationMessage && <button class="mutation-toast" type="button" onClick={() => store.clearMutationMessage()}>{mutationMessage}</button>}
        {selectedEvent && <EventDetail event={selectedEvent} dateKey={dateKey} onClose={() => setSelectedEvent(null)} onEdit={() => beginEdit(selectedEvent)} />}
        {editorEvent !== undefined && <EventEditor dateKey={dateKey} editing={editorEvent} onClose={() => setEditorEvent(undefined)} onSave={saveEditor} onDelete={editorEvent ? deleteEditor : undefined} />}
        {editingSpan && <SpanEditor
          month={month}
          start={editingSpan.startDay}
          end={editingSpan.endDay}
          editing={editingSpan}
          deleteTitle="remove this day"
          deleteConfirm="confirm"
          onClose={() => setEditingSpan(null)}
          onSave={(draft) => { void store.updateSpan(editingSpan, draft); setEditingSpan(null); }}
          onDelete={() => { void store.removeSpanDay(editingSpan, month, parts.day); setEditingSpan(null); }}
        />}
      </main>
    </CanvasViewport>
  );
}
