import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type Author, type CalendarNote, type CalendarSpan, type DayEvent, type EventDTO, type EventDraft } from "../domain/calendar";
import { materializeDay } from "../domain/calendarDTO";
import { adjacentDayKey, currentProductDay, monthFromDayKey, monthLabel, parseDayKey, productDateParts, weekdayLabelForDay, weekdayLetterForDay } from "../domain/calendarTime";
import { useCalendarMonth } from "../state/useCalendarMonth";
import type { CalendarStore } from "../state/calendarStore";
import { CanvasViewport } from "../app/CanvasViewport";
import { EventEditor } from "../editors/EventEditor";
import { SpanEditor } from "../editors/SpanEditor";
import { TornNote } from "../notes/TornNote";
import { scrollTopForVisibleItem } from "../notes/noteLayout";
import { clampNoteY, linkedTimedEventId } from "../domain/noteWrite";
import { canonicalTimelinePoint } from "../domain/scrapbook";
import type { ScrapbookStore } from "../state/scrapbookStore";
import { useScrapbook } from "../state/useScrapbook";
import { PlacedLayer } from "../scrapbook/PlacedLayer";
import { StickerStrip } from "../scrapbook/StickerStrip";
import { nextStickerPickerOpen } from "../scrapbook/stickerPicker";
import { processPhoto } from "../scrapbook/imageProcessing";
import { timelineVisibility } from "./keyboardViewport";
import { eventVisualLayout } from "./eventLayout";
import { DISPLAY_NAME } from "../theme/identity";
import { eventTypeLabel } from "../theme/eventType";
import "./day.css";

const FIRST_HOUR = 6;
const LAST_HOUR = 23;
const ROW_HEIGHT = 52;
const TIMELINE_HEIGHT = 10 + (LAST_HOUR - FIRST_HOUR + 1) * ROW_HEIGHT + 96;

interface DayPageProps {
  store: CalendarStore;
  scrapbook: ScrapbookStore;
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
  const top = 10 + ((start - FIRST_HOUR * 60) / 60) * ROW_HEIGHT;
  return { top: `${top}px`, height: `${eventHeight(event)}px` };
}

function eventTop(event: DayEvent): number {
  const start = Math.max(FIRST_HOUR * 60, event.startMinute);
  return 10 + ((start - FIRST_HOUR * 60) / 60) * ROW_HEIGHT;
}

function eventHeight(event: DayEvent): number {
  const start = Math.max(FIRST_HOUR * 60, event.startMinute);
  const end = Math.min(1440, event.endMinute);
  return Math.max(34, ((end - start) / 60) * ROW_HEIGHT - 3);
}

function stripDays(dateKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => adjacentDayKey(dateKey, index - 3)).filter((value): value is string => value !== null);
}

function EventDetail({ event, dateKey, onClose, onEdit }: { event: DayEvent; dateKey: string; onClose(): void; onEdit(): void }) {
  const parts = parseDayKey(dateKey)!;
  const editable = !event.isSpan && !event.continuesBefore && !event.continuesAfter;
  const specialLabel = eventTypeLabel(event.eventType);
  return (
    <div class="event-detail-backdrop" role="presentation" onClick={onClose}>
      <section class={`event-detail-sheet ${authorClass(event.author)}`} role="dialog" aria-modal="true" aria-labelledby="event-detail-title" onClick={(click) => click.stopPropagation()}>
        <div class="detail-handle" aria-hidden="true" />
        <div class="detail-kicker"><span>{DISPLAY_NAME[event.author]}</span>{specialLabel && <span>{specialLabel}</span>}</div>
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

export function DayPage({ store, scrapbook, dateKey, onBack, onDayChange }: DayPageProps) {
  const month = monthFromDayKey(dateKey)!;
  const parts = parseDayKey(dateKey)!;
  const { status, dtos, payload: monthPayload, notesByDay, unseenDays, message, retry, mutationMessage } = useCalendarMonth(store, month);
  const scrapbookSnapshot = useScrapbook(scrapbook);
  const payload = useMemo(() => materializeDay(dtos, dateKey), [dtos, dateKey]);
  const [selectedEvent, setSelectedEvent] = useState<DayEvent | null>(null);
  const [editorEvent, setEditorEvent] = useState<EventDTO | null | undefined>(undefined);
  const [editingSpan, setEditingSpan] = useState<CalendarSpan | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteEditorFocused, setNoteEditorFocused] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [activeNoteOffset, setActiveNoteOffset] = useState(0);
  const [selectedPlacedId, setSelectedPlacedId] = useState<string | null>(null);
  const [placedBusy, setPlacedBusy] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const timelineRef = useRef<HTMLElement>(null);
  const activeNotePositionRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const noteGesture = useRef<{ id: string; pointerId: number; startY: number; originOffset: number; armed: boolean; timer?: number } | null>(null);
  const today = currentProductDay() === dateKey;
  const unseen = unseenDays.has(dateKey);
  const strip = stripDays(dateKey);
  const visibleTimed = payload.timed.filter((event) => event.endMinute > FIRST_HOUR * 60 && event.startMinute < 1440);
  const notes = notesByDay.get(parts.day) ?? [];
  const placed = scrapbookSnapshot.byDay.get(dateKey) ?? [];

  useEffect(() => {
    setSelectedEvent(null);
    setEditorEvent(undefined);
    setEditingSpan(null);
    setFabOpen(false);
    setActiveNoteId(null);
    setNoteEditorFocused(false);
    setDraggingNoteId(null);
    setActiveNoteOffset(0);
    setSelectedPlacedId(null);
    setPlacedBusy(false);
    setStickerOpen(false);
    void store.markSeen(dateKey);
  }, [store, dateKey]);

  function keepActiveNoteVisible(keyboardAware = noteEditorFocused) {
    const timeline = timelineRef.current;
    const position = activeNotePositionRef.current;
    const noteElement = position?.querySelector<HTMLElement>(".torn-note");
    if (!timeline || !position || !noteElement) return;
    const rect = timeline.getBoundingClientRect();
    const visibility = timelineVisibility(
      { top: rect.top, bottom: rect.bottom, width: rect.width },
      timeline.clientWidth,
      timeline.clientHeight,
      keyboardAware && window.visualViewport
        ? { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop }
        : null
    );
    timeline.style.setProperty(
      "--keyboard-scroll-spacer",
      `${keyboardAware ? visibility.bottomOcclusion : 0}px`
    );
    timeline.scrollTop = scrollTopForVisibleItem(
      timeline.scrollTop,
      timeline.clientHeight,
      timeline.scrollHeight,
      position.offsetTop + activeNoteOffset,
      noteElement.offsetHeight,
      visibility.topInset,
      visibility.visibleHeight
    );
  }

  function noteFocusChange(focused: boolean) {
    setNoteEditorFocused(focused);
    if (focused) {
      window.requestAnimationFrame(() => keepActiveNoteVisible(true));
    } else {
      timelineRef.current?.style.setProperty("--keyboard-scroll-spacer", "0px");
    }
  }

  useEffect(() => {
    if (!activeNoteId || !noteEditorFocused) {
      timelineRef.current?.style.setProperty("--keyboard-scroll-spacer", "0px");
      return;
    }
    const timeline = timelineRef.current;
    if (!timeline) return;
    let frame = 0;
    const scheduleVisibilityCheck = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => keepActiveNoteVisible(true));
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleVisibilityCheck);
    observer?.observe(timeline);
    const noteElement = activeNotePositionRef.current?.querySelector<HTMLElement>(".torn-note");
    if (noteElement) observer?.observe(noteElement);
    window.visualViewport?.addEventListener("resize", scheduleVisibilityCheck);
    window.visualViewport?.addEventListener("scroll", scheduleVisibilityCheck);
    window.addEventListener("resize", scheduleVisibilityCheck);
    scheduleVisibilityCheck();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.visualViewport?.removeEventListener("resize", scheduleVisibilityCheck);
      window.visualViewport?.removeEventListener("scroll", scheduleVisibilityCheck);
      window.removeEventListener("resize", scheduleVisibilityCheck);
      timeline.style.setProperty("--keyboard-scroll-spacer", "0px");
    };
  }, [activeNoteId, noteEditorFocused]);

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

  function noteBaseY(note: CalendarNote, index: number): number { return note.y ?? 34 + index * 116; }

  function finishActiveNote() {
    if (!activeNoteId) return;
    const index = notes.findIndex((note) => note.id === activeNoteId);
    const note = index >= 0 ? notes[index] : null;
    if (note) {
      if (activeNoteOffset !== 0) {
        const noteHeight = activeNotePositionRef.current?.querySelector<HTMLElement>(".torn-note")?.offsetHeight;
        const y = clampNoteY(noteBaseY(note, index) + activeNoteOffset, TIMELINE_HEIGHT, noteHeight);
        const linked = linkedTimedEventId(y + 42, visibleTimed, eventTop, eventHeight);
        store.placeNote(note.id, y, linked);
      }
      void store.commitNote(note.id);
    }
    setActiveNoteId(null);
    setNoteEditorFocused(false);
    setDraggingNoteId(null);
    setActiveNoteOffset(0);
  }

  function startBlankNote() {
    finishActiveNote();
    const note = store.addBlankNote(dateKey, Math.max(8, (timelineRef.current?.scrollTop ?? 0) + 96));
    setActiveNoteId(note.id);
    setActiveNoteOffset(0);
    setFabOpen(false);
  }

  function timelineCenter() {
    const timeline = timelineRef.current;
    return { x: 201, y: (timeline?.scrollTop ?? 0) + (timeline?.clientHeight ?? 400) / 2 };
  }

  async function dropSticker(stickerId: string, clientX: number, clientY: number): Promise<boolean> {
    const timeline = timelineRef.current;
    if (!timeline) return false;
    const rect = timeline.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const point = canonicalTimelinePoint({ x: clientX, y: clientY }, rect, timeline.scrollTop);
    if (!point) return false;
    const placedItem = await scrapbook.placeSticker(dateKey, stickerId, point);
    setStickerOpen((open) => nextStickerPickerOpen(open, placedItem ? "accepted-drop" : "rejected-drop"));
    return Boolean(placedItem);
  }

  async function importPhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      await scrapbook.placePhoto(dateKey, await processPhoto(file), timelineCenter());
    } catch {
      // A decode failure leaves both IndexedDB and the visible page unchanged.
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  function notePointerDown(note: CalendarNote, event: PointerEvent) {
    if (note.author !== "kitty" || (event.target as Element).closest("textarea,button")) return;
    const target = event.currentTarget as HTMLElement;
    const active = activeNoteId === note.id;
    const gesture: { id: string; pointerId: number; startY: number; originOffset: number; armed: boolean; timer?: number } = { id: note.id, pointerId: event.pointerId, startY: event.clientY, originOffset: activeNoteOffset, armed: active };
    noteGesture.current = gesture;
    if (active) {
      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      setDraggingNoteId(note.id);
    } else {
      gesture.timer = window.setTimeout(() => {
        if (noteGesture.current !== gesture) return;
        finishActiveNote();
        gesture.armed = true;
        setActiveNoteId(note.id);
        setActiveNoteOffset(0);
        setDraggingNoteId(note.id);
        target.setPointerCapture(event.pointerId);
      }, 500);
    }
  }

  function notePointerMove(event: PointerEvent) {
    const gesture = noteGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = event.clientY - gesture.startY;
    if (!gesture.armed && Math.abs(distance) > 10) {
      if (gesture.timer) window.clearTimeout(gesture.timer);
      noteGesture.current = null;
      return;
    }
    if (gesture.armed) {
      event.preventDefault();
      setActiveNoteOffset(gesture.originOffset + distance);
    }
  }

  function endNotePointer(event: PointerEvent) {
    const gesture = noteGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.timer) window.clearTimeout(gesture.timer);
    noteGesture.current = null;
    setDraggingNoteId(null);
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
          {payload.allDay.map((event) => {
            const specialLabel = eventTypeLabel(event.eventType);
            return <button type="button" class={`all-day-event ${authorClass(event.author)} ${specialLabel ? "has-special-decoration" : ""} ${store.isPending(event.id) ? "is-pending" : ""}`} key={event.id} onClick={() => openEvent(event)}><strong>{event.title}</strong><span>{eventTimeLabel(event)} · {DISPLAY_NAME[event.author]}{specialLabel && <b class="event-type-cue"> · {specialLabel}</b>}</span>{specialLabel && <img src="/assets/stamp-heart-mini.png" alt="" aria-hidden="true" />}</button>;
          })}
        </section>}

        <section ref={timelineRef} class={draggingNoteId || placedBusy ? "day-timeline is-note-busy" : "day-timeline"} aria-label="Timeline from 06:00 to 23:00">
          <div class="timeline-content" style={{ height: `${TIMELINE_HEIGHT}px` }} onPointerDown={(event) => {
            if (!(event.target as Element).closest(".torn-note")) finishActiveNote();
            if (!(event.target as Element).closest(".placed-item")) setSelectedPlacedId(null);
          }}>
            <div class="timeline-grid-paper" aria-hidden="true" />
            {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, index) => FIRST_HOUR + index).map((hour) => <div class="hour-row" style={{ top: `${10 + (hour - FIRST_HOUR) * ROW_HEIGHT}px` }} key={hour}><span>{String(hour).padStart(2, "0")}:00</span><i /></div>)}
            {visibleTimed.map((event) => {
              const layout = eventVisualLayout(eventHeight(event));
              return <button type="button" class={`timed-event density-${layout.density} ${authorClass(event.author)} ${store.isPending(event.id) ? "is-pending" : ""}`} style={eventStyle(event)} key={`${event.id}-${event.startMinute}`} onClick={() => setSelectedEvent(event)}><strong>{event.title}</strong>{layout.showMetadata && <span>{eventTimeLabel(event)} · {DISPLAY_NAME[event.author]}</span>}</button>;
            })}
            {notes.map((note, index) => {
              const linkedTitle = note.linkedEventId ? payload.timed.find((event) => event.id === note.linkedEventId)?.title : undefined;
              const active = activeNoteId === note.id;
              return <div ref={active ? activeNotePositionRef : undefined} class="note-position" style={{ left: `${note.author === "master" ? 58 : 214}px`, top: `${noteBaseY(note, index)}px` }} key={note.id}><TornNote note={note} index={index} linkedTitle={linkedTitle} active={active} dragging={draggingNoteId === note.id} offsetY={active ? activeNoteOffset : 0} onText={(body) => store.setNoteText(note.id, body)} onDelete={() => { setActiveNoteId(null); setNoteEditorFocused(false); setActiveNoteOffset(0); void store.deleteNote(note.id); }} onDoubleTap={() => void store.toggleNoteLike(note.id)} onPointerDown={(event) => notePointerDown(note, event)} onPointerMove={notePointerMove} onPointerUp={endNotePointer} onPointerCancel={endNotePointer} onFocusRequest={() => keepActiveNoteVisible(true)} onFocusChange={noteFocusChange} /></div>;
            })}
            <PlacedLayer
              store={scrapbook}
              items={placed}
              selectedId={selectedPlacedId}
              timeline={timelineRef.current}
              editable={!stickerOpen}
              onSelect={(id) => { finishActiveNote(); setSelectedPlacedId(id); }}
              onBusyChange={setPlacedBusy}
            />
            {status === "ready" && payload.allDay.length === 0 && payload.timed.length === 0 && notes.length === 0 && placed.length === 0 && <div class="day-empty"><span>這一天還空著</span><small>nothing here yet</small></div>}
          </div>
        </section>

        <div class={fabOpen ? "event-fab is-open" : "event-fab"}>
          {stickerOpen && <div
            class="sticker-dismiss-layer"
            role="presentation"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setStickerOpen((open) => nextStickerPickerOpen(open, "outside-dismiss"));
            }}
            onPointerCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setStickerOpen((open) => nextStickerPickerOpen(open, "outside-dismiss"));
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />}
          {fabOpen && <button class="event-fab-action note-fab-action" type="button" aria-label="New note" onClick={startBlankNote}><img src="/assets/ic-note.png" alt="" aria-hidden="true" /></button>}
          {fabOpen && <div class="event-fab-row sticker-fab-row">
            <StickerStrip
              store={scrapbook}
              stickers={scrapbook.stickers()}
              open={stickerOpen}
              onDrop={(item, point) => dropSticker(item.id, point.x, point.y)}
              onPickEmoji={(emoji) => void scrapbook.placeEmoji(dateKey, emoji, timelineCenter())}
            />
            <button class="event-fab-action" type="button" aria-label="Stickers" aria-expanded={stickerOpen} onClick={() => setStickerOpen((open) => nextStickerPickerOpen(open, "toggle"))}><img src="/assets/ic-sticker.png" alt="" aria-hidden="true" /></button>
          </div>}
          {fabOpen && <button class="event-fab-action" type="button" aria-label="Add photo" onClick={() => photoInputRef.current?.click()}>{photoBusy ? <span class="fab-progress">…</span> : <img src="/assets/ic-photo.png" alt="" aria-hidden="true" />}</button>}
          {fabOpen && <button class="event-fab-action" type="button" aria-label="New event" onClick={() => { setEditorEvent(null); setFabOpen(false); }}><img src="/assets/ic-event.png" alt="" aria-hidden="true" /></button>}
          <button class="event-fab-main" type="button" aria-label="Add" onClick={() => setFabOpen((open) => { if (open) setStickerOpen(false); return !open; })}><span aria-hidden="true">+</span></button>
        </div>
        <input ref={photoInputRef} class="scrapbook-file-input" type="file" accept="image/*" onChange={(event) => void importPhoto(event.currentTarget.files?.[0])} />

        {mutationMessage && <button class="mutation-toast" type="button" onClick={() => store.clearMutationMessage()}>{mutationMessage}</button>}
        {scrapbookSnapshot.message && <button class="scrapbook-toast" type="button" onClick={() => scrapbook.clearMessage()}>{scrapbookSnapshot.message}</button>}
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
