import { describe, expect, it } from "vitest";
import { materializeEvents, parseEventList } from "../../src/domain/calendarDTO";

const month = { year: 2026, month: 8 };

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal_fixture",
    title: "fixture",
    starts_at: "2026-08-05T06:30:00+00:00",
    ends_at: "2026-08-05T07:30:00+00:00",
    precision: "hour",
    created_by: "kitty",
    revision: 3,
    status: "active",
    metadata: {},
    ...overrides
  };
}

describe("calendar DTO parity", () => {
  it("preserves wire fields and maps authors", () => {
    const [dto] = parseEventList({ events: [event()] });
    const payload = materializeEvents([dto], month);
    const item = payload.events.get(5)?.[0];

    expect(item).toMatchObject({
      author: "kitty",
      startHour: 14,
      startMinute: 30,
      durationMinutes: 60,
      revision: 3
    });
  });

  it("treats day precision ends_at as exclusive after snapping to product midnight", () => {
    const dto = parseEventList({
      events: [
        event({
          id: "cal_day",
          starts_at: "2026-08-08T01:00:00+00:00",
          ends_at: "2026-08-09T01:00:00+00:00",
          precision: "day",
          created_by: "master"
        })
      ]
    });

    const payload = materializeEvents(dto, month);
    expect(payload.spans).toHaveLength(0);
    expect(payload.events.get(8)?.[0]).toMatchObject({
      author: "master",
      isAllDay: true
    });
  });

  it("materializes marked and implicit multi-day spans", () => {
    const dtos = parseEventList({
      events: [
        event({
          id: "marked",
          starts_at: "2026-08-20T00:00:00+00:00",
          ends_at: "2026-08-23T00:00:00+00:00",
          precision: "day",
          metadata: { kind: "span" },
          created_by: "assistant"
        }),
        event({
          id: "implicit",
          starts_at: "2026-08-25T00:00:00+00:00",
          ends_at: "2026-08-28T00:00:00+00:00",
          precision: "day",
          metadata: {}
        })
      ]
    });

    const payload = materializeEvents(dtos, month);
    expect(payload.spans.map(({ id, startDay, endDay }) => ({ id, startDay, endDay }))).toEqual([
      { id: "marked", startDay: 20, endDay: 22 },
      { id: "implicit", startDay: 25, endDay: 27 }
    ]);
  });

  it("materializes period bands separately", () => {
    const [dto] = parseEventList({
      events: [
        event({
          id: "period",
          event_type: "period",
          starts_at: "2026-08-13T00:00:00+00:00",
          ends_at: "2026-08-19T00:00:00+00:00",
          precision: "day"
        })
      ]
    });

    expect(materializeEvents([dto], month).periods).toEqual([{ start: 13, end: 18 }]);
  });

  it("clips cross-month spans without losing the hidden head", () => {
    const [dto] = parseEventList({
      events: [
        event({
          id: "cross-month",
          starts_at: "2026-07-29T16:00:00+00:00",
          ends_at: "2026-08-02T16:00:00+00:00",
          precision: "day",
          metadata: { kind: "span" }
        })
      ]
    });

    expect(materializeEvents([dto], month).spans[0]).toMatchObject({
      startDay: 1,
      endDay: 2,
      clip: { headStart: "2026-07-29T16:00:00+00:00" }
    });
  });

  it("keeps timed cross-midnight events on their start day and filters deleted records", () => {
    const dtos = parseEventList({
      events: [
        event({
          id: "late",
          starts_at: "2026-08-10T15:00:00+00:00",
          ends_at: "2026-08-10T17:00:00+00:00"
        }),
        event({ id: "deleted", status: "deleted" })
      ]
    });

    const payload = materializeEvents(dtos, month);
    expect(payload.spans).toHaveLength(0);
    expect(payload.events.get(10)?.map((item) => item.id)).toEqual(["late"]);
    expect([...payload.events.values()].flat().some((item) => item.id === "deleted")).toBe(false);
  });
});
