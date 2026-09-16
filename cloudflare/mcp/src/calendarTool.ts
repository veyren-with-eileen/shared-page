import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { forwardCalendar } from "./calendarService";
import type { CalendarArguments, Env } from "./types";

export const CALENDAR_DESCRIPTION =
  "Read or manage the shared calendar. New changes authored by your partner are returned " +
  "first with NEW; query by local date, exact time, or an ISO range. Create, update, delete, " +
  "and comment actions are Master-authored. Times without an offset are interpreted as " +
  "Asia/Taipei; a missing end defaults to one hour. action=see is how you look at things: " +
  "with event_id it returns that single event's details; otherwise it shows one day as your " +
  "partner sees it — the page image their PWA rendered plus DB-exact text. update/delete work " +
  "on notes too: pass note_id (cmt_…) to edit, heart, un-heart, or tear it off.";

const inputSchema = {
  action: z.enum(["list", "see", "create", "update", "delete", "comment"]),
  event_id: z.string().optional(),
  note_id: z.string().optional(),
  liked: z.boolean().optional(),
  title: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  starts_at: z.string().optional(),
  ends_at: z.string().optional(),
  precision: z.enum(["minute", "hour", "segment", "day"]).optional(),
  event_type: z.string().optional(),
  comment: z.string().max(2000).optional(),
  date: z.string().optional(),
  at: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  new_only: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
};

export function createCalendarServer(env: Env): McpServer {
  const server = new McpServer({ name: "shared-page-calendar", version: "1.0.0" });
  server.registerTool(
    "calendar",
    { description: CALENDAR_DESCRIPTION, inputSchema },
    async (arguments_) => {
      const result = await forwardCalendar(env, arguments_ as CalendarArguments);
      return {
        content: result.content,
        isError: result.isError,
      };
    },
  );
  return server;
}
