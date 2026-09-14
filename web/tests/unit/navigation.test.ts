import { describe, expect, it } from "vitest";
import { dayRouteUrl, routeFromUrl } from "../../src/app/navigation";
import { monthGrid } from "../../src/domain/calendarTime";

describe("calendar URL navigation", () => {
  it("uses the true date for a previous-month gray cell", () => {
    const grayCell = monthGrid({ year: 2026, month: 9 })[0];

    expect(grayCell).toMatchObject({
      key: "2026-08-31",
      inMonth: false,
      month: { year: 2026, month: 8 }
    });
    expect(dayRouteUrl(grayCell.key)).toBe("/day/2026-08-31");
    expect(routeFromUrl(new URL(`https://calendar.test${dayRouteUrl(grayCell.key)}`))).toEqual({
      kind: "day",
      dayKey: "2026-08-31",
      month: { year: 2026, month: 8 }
    });

    const nextGrayCell = monthGrid({ year: 2026, month: 9 }).at(-1)!;
    expect(nextGrayCell).toMatchObject({
      key: "2026-10-04",
      inMonth: false,
      month: { year: 2026, month: 10 }
    });
    expect(dayRouteUrl(nextGrayCell.key)).toBe("/day/2026-10-04");
  });

  it("restores an addressable day and a month query after reload", () => {
    expect(routeFromUrl(new URL("https://calendar.test/day/2026-09-15"))).toMatchObject({
      kind: "day",
      dayKey: "2026-09-15"
    });
    expect(routeFromUrl(new URL("https://calendar.test/?month=2026-10"))).toEqual({
      kind: "month",
      month: { year: 2026, month: 10 }
    });
  });
});
