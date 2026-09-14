import { useEffect, useState } from "preact/hooks";
import type { ConnectionConfig } from "../config/connection";
import {
  AUTHOR_LABEL,
  SPECIAL_DAY_TYPES,
  type Author,
  type CalendarMonth,
  type CalendarSpan,
  type DayRange,
  type MonthPayload
} from "../domain/calendar";
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
import "./month.css";

const CANVAS_WIDTH = 402;
const CANVAS_HEIGHT = 874;

interface MonthPageProps {
  config: ConnectionConfig;
  month: CalendarMonth;
  onMonthChange(month: CalendarMonth): void;
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

function useCanvasScale(): number {
  const [scale, setScale] = useState(() => Math.min(1, window.innerWidth / CANVAS_WIDTH));

  useEffect(() => {
    const updateScale = () => setScale(Math.min(1, window.innerWidth / CANVAS_WIDTH));
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return scale;
}

export function MonthPage({ config, month, onMonthChange }: MonthPageProps) {
  const { status, payload, unseenDays, message, retry } = useCalendarMonth(config, month);
  const scale = useCanvasScale();
  const today = todayInMonth(month);
  const days = monthGrid(month);

  return (
    <div
      class="canvas-viewport"
      style={{
        width: `${CANVAS_WIDTH * scale}px`,
        height: `${CANVAS_HEIGHT * scale}px`
      }}
    >
      <main
        class="calendar-canvas"
        style={{ transform: `scale(${scale})` }}
        aria-busy={status === "loading"}
      >
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
            <button type="button" aria-label="Previous month" onClick={() => onMonthChange(previousMonth(month))}>
              ◀
            </button>
            <button type="button" aria-label="Next month" onClick={() => onMonthChange(nextMonth(month))}>
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
            style={{ gridTemplateRows: `repeat(${weekRows(month)}, var(--month-cell-height))` }}
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

              return (
                <div
                  class={cell.inMonth ? "month-cell" : "month-cell is-dim"}
                  key={cell.key}
                  aria-label={cell.key}
                >
                  <div class="grid-paper" aria-hidden="true" />
                  {!cell.inMonth && <div class="dim-hatch" aria-hidden="true" />}

                  {spans.map((span, lane) => (
                    <div
                      class={`span-band lane-${lane} ${authorClass(span.author)}`}
                      key={span.id}
                      aria-hidden="true"
                    />
                  ))}

                  {period && (
                    <div
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

                  <div class="cell-copy">
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
                  </div>

                  {unseen && (
                    <img class="new-badge" src="/assets/red-exclaim-double.png" alt="NEW" />
                  )}
                </div>
              );
            })}
          </div>

          <footer class="month-legend">
            {(["kitty", "master", "system"] as const).map((author) => (
              <span class="legend-item" key={author}>
                <i class={authorClass(author)} />
                {AUTHOR_LABEL[author]}
              </span>
            ))}
            <span class="legend-spacer" />
            <span class="period-legend">
              <i />
              生理期
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}
