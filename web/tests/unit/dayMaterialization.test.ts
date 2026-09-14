import { describe, expect, it } from "vitest";
import { materializeDay, parseEventList } from "../../src/domain/calendarDTO";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal_fixture",
    title: "fixture",
    starts_at: "2026-09-15T02:30:00Z",
    ends_at: "2026-09-15T03:30:00Z",
    precision: "hour",
    created_by: "kitty",
    revision: 4,
    status: "active",
    metadata: {},
    ...overrides
  };
}

describe("Day View materialization", () => {
  it("places a timed event at its Asia/Taipei clock time", () => {
    const [dto] = parseEventList({ events: [event()] });
    expect(materializeDay([dto], "2026-09-15").timed[0]).toMatchObject({
      author: "kitty",
      startMinute: 10 * 60 + 30,
      endMinute: 11 * 60 + 30,
      revision: 4
    });
  });

  it("materializes a one-day all-day event", () => {
    const [dto] = parseEventList({
      events: [
        event({
          starts_at: "2026-09-14T16:00:00Z",
          ends_at: "2026-09-15T16:00:00Z",
          precision: "day",
          created_by: "assistant"
        })
      ]
    });

    expect(materializeDay([dto], "2026-09-15").allDay[0]).toMatchObject({
      author: "master",
      isAllDay: true,
      isSpan: false,
      spanIndex: null
    });
  });

  it("clips a cross-midnight timed event into both product days", () => {
    const [dto] = parseEventList({
      events: [
        event({
          starts_at: "2026-09-15T15:30:00Z",
          ends_at: "2026-09-16T01:00:00Z"
        })
      ]
    });

    expect(materializeDay([dto], "2026-09-15").timed[0]).toMatchObject({
      startMinute: 23 * 60 + 30,
      endMinute: 1440,
      continuesAfter: true
    });
    expect(materializeDay([dto], "2026-09-16").timed[0]).toMatchObject({
      startMinute: 0,
      endMinute: 9 * 60,
      continuesBefore: true
    });
  });

  it("clips an all-day span across a month boundary with a stable day index", () => {
    const [dto] = parseEventList({
      events: [
        event({
          id: "cross-month",
          starts_at: "2026-08-30T16:00:00Z",
          ends_at: "2026-09-02T16:00:00Z",
          precision: "day",
          metadata: { kind: "span" }
        })
      ]
    });

    expect(materializeDay([dto], "2026-09-01").allDay[0]).toMatchObject({
      id: "cross-month",
      isSpan: true,
      spanIndex: 3,
      spanLength: 4,
      continuesBefore: true,
      continuesAfter: true
    });
    expect(materializeDay([dto], "2026-09-02").allDay[0]).toMatchObject({
      spanIndex: 4,
      continuesAfter: false
    });
  });

  it("honors exclusive ends_at at the Taipei midnight boundary", () => {
    const [dto] = parseEventList({
      events: [
        event({
          starts_at: "2026-09-14T15:00:00Z",
          ends_at: "2026-09-14T16:00:00Z"
        })
      ]
    });

    expect(materializeDay([dto], "2026-09-14").timed).toHaveLength(1);
    expect(materializeDay([dto], "2026-09-15").timed).toHaveLength(0);
  });

  it("maps the UTC instant after 16:00 to the next Asia/Taipei date and maps authors", () => {
    const dtos = parseEventList({
      events: [
        event({ id: "assistant", created_by: "master", starts_at: "2026-09-14T16:15:00Z" }),
        event({ id: "auto", created_by: "extractor", starts_at: "2026-09-14T17:00:00Z" })
      ]
    });

    expect(materializeDay(dtos, "2026-09-14").timed).toHaveLength(0);
    expect(materializeDay(dtos, "2026-09-15").timed.map(({ id, author }) => ({ id, author }))).toEqual([
      { id: "assistant", author: "master" },
      { id: "auto", author: "system" }
    ]);
  });
});
