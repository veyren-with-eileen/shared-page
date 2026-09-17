import type { CalendarSpan } from "../domain/calendar";

export interface GesturePoint { x: number; y: number }

export interface SpanGestureState {
  pointerId: number;
  start: GesturePoint;
  last: GesturePoint;
  tapDayKey: string;
  pressDay: number | null;
  bandId: string | null;
  pickFrom: number | null;
  pickTo: number | null;
  handled: boolean;
}

export type SpanGestureEffect =
  | { type: "edit-span"; id: string }
  | { type: "new-span"; startDay: number; endDay: number }
  | { type: "open-day"; dayKey: string };

export class SpanGestureSession {
  private currentState: SpanGestureState | null = null;

  get state(): SpanGestureState | null {
    return this.currentState;
  }

  begin(state: SpanGestureState): boolean {
    if (this.currentState) return false;
    this.currentState = state;
    return true;
  }

  move(point: GesturePoint, day: number | null): SpanGestureState | null {
    if (!this.currentState) return null;
    this.currentState = moveSpanGesture(this.currentState, point, day);
    return this.currentState;
  }

  arm(): { state: SpanGestureState; effect: SpanGestureEffect | null } | null {
    if (!this.currentState) return null;
    const armed = armSpanGesture(this.currentState);
    this.currentState = armed.state;
    return armed;
  }

  finish(point: GesturePoint): SpanGestureEffect | null {
    if (!this.currentState) return null;
    const state = this.currentState;
    this.currentState = null;
    return endSpanGesture(state, point);
  }

  cancel(): number | null {
    const pointerId = this.currentState?.pointerId ?? null;
    this.currentState = null;
    return pointerId;
  }
}

function distance(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function beginSpanGesture(
  pointerId: number,
  point: GesturePoint,
  tapDayKey: string,
  pressDay: number | null,
  bandId: string | null
): SpanGestureState {
  return {
    pointerId,
    start: point,
    last: point,
    tapDayKey,
    pressDay,
    bandId,
    pickFrom: null,
    pickTo: null,
    handled: false
  };
}

export function moveSpanGesture(state: SpanGestureState, point: GesturePoint, day: number | null): SpanGestureState {
  if (state.handled) return { ...state, last: point };
  return {
    ...state,
    last: point,
    pickTo: state.pickFrom !== null && day !== null ? day : state.pickTo
  };
}

export function armSpanGesture(state: SpanGestureState): { state: SpanGestureState; effect: SpanGestureEffect | null } {
  if (state.handled || state.pressDay === null || distance(state.start, state.last) >= 14) {
    return { state, effect: null };
  }
  if (state.bandId) {
    return {
      state: { ...state, handled: true },
      effect: { type: "edit-span", id: state.bandId }
    };
  }
  return {
    state: { ...state, pickFrom: state.pressDay, pickTo: state.pressDay },
    effect: null
  };
}

export function endSpanGesture(state: SpanGestureState, point: GesturePoint): SpanGestureEffect | null {
  if (state.handled) return null;
  if (state.pickFrom !== null && state.pickTo !== null) {
    return {
      type: "new-span",
      startDay: Math.min(state.pickFrom, state.pickTo),
      endDay: Math.max(state.pickFrom, state.pickTo)
    };
  }
  return distance(state.start, point) < 12
    ? { type: "open-day", dayKey: state.tapDayKey }
    : null;
}

export function hitSpanBand(spans: CalendarSpan[], day: number, inCellY: number): string | null {
  const visible = spans.filter((span) => day >= span.startDay && day <= span.endDay).slice(0, 2);
  for (let lane = 0; lane < visible.length; lane += 1) {
    const top = 17 + lane * 36;
    if (inCellY >= top - 5 && inCellY <= top + 38) return visible[lane].id;
  }
  return null;
}
