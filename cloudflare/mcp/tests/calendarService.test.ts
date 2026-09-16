import { describe, expect, it, vi } from "vitest";

import { forwardCalendar } from "../src/calendarService";

describe("calendar service binding", () => {
  it("forwards the exact tool arguments and internal bearer secret", async () => {
    let captured: Request | undefined;
    const application = {
      fetch: vi.fn(async (request: Request) => {
        captured = request;
        return Response.json({ content: [{ type: "text", text: "ok" }] });
      }),
    };
    const result = await forwardCalendar(
      { APPLICATION: application, MCP_INTERNAL_TOKEN: "internal-secret" },
      { action: "create", title: "test", starts_at: "2026-09-15T10:00:00+08:00" },
    );
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(captured?.url).toBe("https://shared-page-app/internal/mcp/calendar");
    expect(captured?.headers.get("Authorization")).toBe("Bearer internal-secret");
    expect(await captured?.json()).toEqual({
      action: "create",
      title: "test",
      starts_at: "2026-09-15T10:00:00+08:00",
    });
  });

  it("preserves text and image content returned by application worker", async () => {
    const application = {
      fetch: vi.fn(async () => Response.json({
        content: [
          { type: "text", text: "exact DB text" },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ],
      })),
    };
    const result = await forwardCalendar(
      { APPLICATION: application, MCP_INTERNAL_TOKEN: "secret" },
      { action: "see", date: "2026-09-15" },
    );
    expect(result.content[1]).toEqual({
      type: "image", data: "iVBORw0KGgo=", mimeType: "image/png",
    });
  });

  it("turns application errors into MCP tool errors", async () => {
    const application = {
      fetch: vi.fn(async () => new Response("unavailable", { status: 503 })),
    };
    const result = await forwardCalendar(
      { APPLICATION: application, MCP_INTERNAL_TOKEN: "secret" },
      { action: "list" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
  });
});
