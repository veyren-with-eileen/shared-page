import {
  SPECIAL_DAY_TYPES,
  type Author,
  type CalendarMonth,
  type CalendarSpan,
  type DayRange,
  type MonthPayload
} from "../domain/calendar";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  WEEKDAY_HEADERS,
  dayKey,
  monthGrid,
  monthLabel,
  nextMonth,
  previousMonth,
  todayInMonth,
  weekRows
} from "../domain/calendarTime";
import { useCalendarMonth } from "../state/useCalendarMonth";
import type { CalendarStore } from "../state/calendarStore";
import { CanvasViewport } from "../app/CanvasViewport";
import { SpanEditor } from "../editors/SpanEditor";
import type { ScrapbookStore } from "../state/scrapbookStore";
import { useScrapbook } from "../state/useScrapbook";
import { PlacedThumbs } from "../scrapbook/PlacedLayer";
import {
  beginSpanGesture,
  hitSpanBand,
  SpanGestureSession,
  type SpanGestureEffect,
} from "./spanGesture";
import { DISPLAY_NAME } from "../theme/identity";
import "./month.css";

interface MonthPageProps {
  store: CalendarStore;
  scrapbook: ScrapbookStore;
  month: CalendarMonth;
  onMonthChange(month: CalendarMonth): void;
  onDayOpen(dayKey: string): void;
}

function authorClass(author: Author): string {
  return `author-${author}`;
}

function spanForDay(payload: MonthPayload, day: number): CalendarSpan[] {
  return payload.spans
    .filter((span) => day >= span.startDay && day <= span.endDay)
    .slice(0, 2);
}

function periodForDay(payload: MonthPayload, day: number): DayRange | undefined {
  return payload.periods.find((period) => day >= period.start && day <= period.end);
}

export function MonthPage({ store, scrapbook, month, onMonthChange, onDayOpen }: MonthPageProps) {
  const { status, payload, unseenDays, message, retry, mutationMessage } = useCalendarMonth(store, month);
  const scrapbookSnapshot = useScrapbook(scrapbook);
  const today = todayInMonth(month);
  const days = monthGrid(month);
  const gridRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef(new SpanGestureSession());
  const armTimerRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);
  const [spanSheet, setSpanSheet] = useState<{ start: number; end: number; editing?: CalendarSpan } | null>(null);

  function pointDay(clientX: number, clientY: number) {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * 7);
    const rows = weekRows(month);
    const row = Math.floor(((clientY - rect.top) / rect.height) * rows);
    if (col < 0 || col > 6 || row < 0 || row >= rows) return null;
    const cell = days[row * 7 + col];
    if (!cell) return null;
    return { cell, day: cell.inMonth ? cell.day : null, inCellY: (clientY - rect.top) - row * (rect.height / rows) };
  }

  function runGestureEffect(effect: SpanGestureEffect | null) {
    if (!effect) return;
    if (effect.type === "open-day") onDayOpen(effect.dayKey);
    if (effect.type === "new-span") setSpanSheet({ start: effect.startDay, end: effect.endDay });
    if (effect.type === "edit-span") {
      const editing = payload.spans.find((span) => span.id === effect.id);
      if (editing) setSpanSheet({ start: editing.startDay, end: editing.endDay, editing });
    }
  }

  function releasePointerCapture(pointerId: number | null) {
    const grid = gridRef.current;
    if (pointerId === null || !grid) return;
    try {
      if (grid.hasPointerCapture(pointerId)) grid.releasePointerCapture(pointerId);
    } catch {
      // Safari can report a stale capture after pointercancel/lostpointercapture.
    }
  }

  function clearGesture(pointerId?: number | null, updatePreview = true) {
    const activePointerId = gestureRef.current.cancel();
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    armTimerRef.current = null;
    releasePointerCapture(pointerId ?? activePointerId);
    if (updatePreview) setPreview(null);
  }

  useEffect(() => {
    clearGesture();
    setSpanSheet(null);
    return () => clearGesture(undefined, false);
  }, [month.year, month.month]);

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || gestureRef.current.state) return;
    const hit = pointDay(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    const bandId = hit.day === null ? null : hitSpanBand(payload.spans, hit.day, hit.inCellY);
    gestureRef.current.begin(beginSpanGesture(event.pointerId, { x: event.clientX, y: event.clientY }, hit.cell.key, hit.day, bandId));
    try {
      gridRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the active session still ends normally.
    }
    if (hit.day !== null) {
      armTimerRef.current = window.setTimeout(() => {
        armTimerRef.current = null;
        const armed = gestureRef.current.arm();
        if (!armed) return;
        if (armed.state.pickFrom !== null) setPreview({ start: armed.state.pickFrom, end: armed.state.pickTo ?? armed.state.pickFrom });
        if (armed.effect) clearGesture(armed.state.pointerId);
        runGestureEffect(armed.effect);
      }, 300);
    }
  }

  function pointerMove(event: PointerEvent) {
    const current = gestureRef.current.state;
    if (!current || current.pointerId !== event.pointerId) return;
    const hit = pointDay(event.clientX, event.clientY);
    const moved = gestureRef.current.move({ x: event.clientX, y: event.clientY }, hit?.day ?? null);
    if (!moved) return;
    if (moved.pickFrom !== null && moved.pickTo !== null) setPreview({ start: Math.min(moved.pickFrom, moved.pickTo), end: Math.max(moved.pickFrom, moved.pickTo) });
  }

  function pointerUp(event: PointerEvent) {
    const current = gestureRef.current.state;
    if (!current || current.pointerId !== event.pointerId) return;
    const effect = gestureRef.current.finish({ x: event.clientX, y: event.clientY });
    clearGesture(current.pointerId);
    runGestureEffect(effect);
  }

  function cancelPointer(event: PointerEvent) {
    if (gestureRef.current.state?.pointerId !== event.pointerId) return;
    clearGesture(event.pointerId);
  }

  function changeMonth(next: CalendarMonth) {
    clearGesture();
    setSpanSheet(null);
    onMonthChange(next);
  }

  function closeSpanEditor() {
    clearGesture();
    setSpanSheet(null);
  }

  return (
    <CanvasViewport fitWholeViewport>
      <main class="calendar-canvas" aria-busy={status === "loading"}>
        <header class="month-header">
          <div>
            <div class="month-heading">
              <h1>{monthLabel(month)}</h1>
              <span>{month.year}</span>
            </div>
            <button
              class={status === "error" ? "month-subtitle is-error" : "month-subtitle"}
              type="button"
              onClick={retry}
              disabled={status !== "error"}
            >
              {message}
            </button>
          </div>

          <nav class="month-nav" aria-label="Month navigation">
            <button type="button" aria-label="Previous month" onClick={() => changeMonth(previousMonth(month))}>
              ◀
            </button>
            <button type="button" aria-label="Next month" onClick={() => changeMonth(nextMonth(month))}>
              ▶
            </button>
          </nav>
        </header>

        <section class="month-card" aria-label={`${monthLabel(month)} ${month.year}`}>
          <div class="weekday-row">
            {WEEKDAY_HEADERS.map((weekday) => (
              <div key={weekday}>{weekday}</div>
            ))}
          </div>

          <div
            class="month-grid"
            ref={gridRef}
            style={{ gridTemplateRows: `repeat(${weekRows(month)}, var(--month-cell-height))` }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={cancelPointer}
            onLostPointerCapture={cancelPointer}
            onContextMenu={(event) => event.preventDefault()}
          >
            {days.map((cell) => {
              const events = cell.inMonth ? payload.events.get(cell.day) ?? [] : [];
              const spans = cell.inMonth ? spanForDay(payload, cell.day) : [];
              const period = cell.inMonth ? periodForDay(payload, cell.day) : undefined;
              const isToday = cell.inMonth && cell.day === today;
              const isSpecial = events.some((event) =>
                event.eventType ? SPECIAL_DAY_TYPES.has(event.eventType) : false
              );
              const unseen = cell.inMonth && unseenDays.has(dayKey(month, cell.day));
              const isPreview = cell.inMonth && preview && cell.day >= preview.start && cell.day <= preview.end;

              return (
                <div
                  class={cell.inMonth ? "month-cell" : "month-cell is-dim"}
                  key={cell.key}
                >
                  <span class="grid-paper" aria-hidden="true" />
                  {!cell.inMonth && <span class="dim-hatch" aria-hidden="true" />}

                  {isPreview && <span class="span-drag-preview" aria-hidden="true" />}

                  {spans.map((span, lane) => (
                    <span
                      class={`span-band lane-${lane} ${authorClass(span.author)}`}
                      key={span.id}
                      aria-hidden="true"
                    />
                  ))}

                  {period && (
                    <span
                      class={[
                        "period-band",
                        cell.day === period.start ? "is-start" : "",
                        cell.day === period.end ? "is-end" : ""
                      ].join(" ")}
                      aria-hidden="true"
                    />
                  )}

                  {isSpecial && (
                    <img class="special-stamp" src="/assets/stamp-heart-mini.png" alt="" aria-hidden="true" />
                  )}

                  <span class="cell-copy">
                    <span class={isToday ? "day-number is-today" : "day-number"}>{cell.day}</span>
                    {cell.inMonth &&
                      spans
                        .filter((span) => span.startDay === cell.day)
                        .map((span) => (
                          <span class={`entry-title span-title ${authorClass(span.author)}`} key={`title-${span.id}`}>
                            {span.title}
                          </span>
                        ))}
                    {cell.inMonth &&
                      events
                        .filter((event) => !event.isAutoSuggestion)
                        .map((event) => (
                          <span class={`entry-title ${authorClass(event.author)}`} key={event.id}>
                            {event.title}
                          </span>
                        ))}
                  </span>

                  {cell.inMonth && (scrapbookSnapshot.byDay.get(cell.key)?.length ?? 0) > 0 && (
                    <PlacedThumbs store={scrapbook} items={scrapbookSnapshot.byDay.get(cell.key)!} />
                  )}

                  {unseen && (
                    <img class="new-badge" src="/assets/red-exclaim-double.png" alt="NEW" />
                  )}
                  <button
                    class="month-cell-hit-target"
                    type="button"
                    aria-label={`Open ${cell.key}`}
                    onClick={(event) => { if (event.detail === 0) onDayOpen(cell.key); }}
                  />
                </div>
              );
            })}
          </div>

          <footer class="month-legend">
            {(["kitty", "master", "system"] as const).map((author) => (
              <span class="legend-item" key={author}>
                <i class={authorClass(author)} />
                {DISPLAY_NAME[author]}
              </span>
            ))}
            <span class="legend-spacer" />
            <span class="period-legend">
              <i />
              生理期
            </span>
          </footer>
        </section>
        {mutationMessage && (
          <button class="mutation-toast" type="button" onClick={() => store.clearMutationMessage()}>
            {mutationMessage}
          </button>
        )}
        {scrapbookSnapshot.message && (
          <button class="scrapbook-toast" type="button" onClick={() => scrapbook.clearMessage()}>
            {scrapbookSnapshot.message}
          </button>
        )}
        {spanSheet && <SpanEditor
          month={month}
          start={spanSheet.start}
          end={spanSheet.end}
          editing={spanSheet.editing}
          onClose={closeSpanEditor}
          onSave={(draft) => {
            if (spanSheet.editing) void store.updateSpan(spanSheet.editing, draft);
            else void store.createSpan(draft);
            closeSpanEditor();
          }}
          onDelete={spanSheet.editing ? () => { void store.deleteSpan(spanSheet.editing!); closeSpanEditor(); } : undefined}
        />}
      </main>
    </CanvasViewport>
  );
}
