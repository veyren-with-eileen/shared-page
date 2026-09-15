import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarApiError, uploadCalendarPage } from "../../src/api/calendarAPI";

const config = { apiBaseUrl: "/api/v1/calendar", token: "secret" };

afterEach(() => vi.unstubAllGlobals());

describe("page upload API", () => {
  it("sends the existing multipart contract without a manual boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob(["\x89PNG\r\n\x1a\npage"], { type: "image/png" });
    await uploadCalendarPage(config, "2026-09-15", blob);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/calendar/pages/2026-09-15/render");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({ Accept: "application/json", "X-Calendar-Token": "secret" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const file = (init.body as FormData).get("file") as File;
    expect(file.name).toBe("2026-09-15.png");
    expect(file.type).toBe("image/png");
    expect(await file.text()).toBe(await blob.text());
  });

  it("validates day and PNG type locally", async () => {
    await expect(uploadCalendarPage(config, "2026-02-31", new Blob([], { type: "image/png" }))).rejects.toBeInstanceOf(CalendarApiError);
    await expect(uploadCalendarPage(config, "2026-09-15", new Blob([], { type: "image/jpeg" }))).rejects.toBeInstanceOf(CalendarApiError);
  });

  it("propagates a rejected upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too large", { status: 413 })));
    await expect(uploadCalendarPage(config, "2026-09-15", new Blob(["png"], { type: "image/png" }))).rejects.toMatchObject({ kind: "bad-request", status: 413 });
  });
});
