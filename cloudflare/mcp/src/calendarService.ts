import type { CalendarArguments, CalendarServiceResult, Env } from "./types";

export async function forwardCalendar(
  env: Pick<Env, "APPLICATION" | "MCP_INTERNAL_TOKEN">,
  arguments_: CalendarArguments,
): Promise<CalendarServiceResult> {
  const response = await env.APPLICATION.fetch(
    new Request("https://shared-page-app/internal/mcp/calendar", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MCP_INTERNAL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(arguments_),
    }),
  );
  if (!response.ok) {
    const detail = await response.text();
    return {
      content: [{ type: "text", text: `calendar service error (${response.status}): ${detail}` }],
      isError: true,
    };
  }
  return await response.json<CalendarServiceResult>();
}
