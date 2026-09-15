import { render } from "preact";
import { toBlob } from "html-to-image";
import type { CalendarStore } from "../state/calendarStore";
import type { ScrapbookStore } from "../state/scrapbookStore";
import { DayPageSnapshot, type SnapshotDayState } from "./DayPageSnapshot";
import { PAGE_RENDER_SCALE, PAGE_WIDTH } from "./pageCrop";

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return;
    try { await image.decode(); } catch { /* The rasterizer will surface an actual missing asset. */ }
  }));
}

async function settleRender(root: HTMLElement): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await waitForImages(root);
}

export async function renderSnapshotState(state: SnapshotDayState, scrapbook: ScrapbookStore): Promise<Blob> {
  const host = document.createElement("div");
  host.className = "snapshot-render-host";
  document.body.append(host);
  try {
    render(<DayPageSnapshot state={state} scrapbook={scrapbook} />, host);
    await settleRender(host);
    const page = host.querySelector<HTMLElement>(".day-page-snapshot");
    if (!page) throw new Error("static page did not mount");
    const blob = await toBlob(page, {
      backgroundColor: "#ffffff",
      cacheBust: false,
      pixelRatio: PAGE_RENDER_SCALE,
      width: PAGE_WIDTH,
      height: page.scrollHeight,
      skipAutoScale: true
    });
    if (!blob || blob.type !== "image/png") throw new Error("static page did not produce a PNG");
    return blob;
  } finally {
    render(null, host);
    host.remove();
  }
}

export async function renderCalendarPage(calendar: CalendarStore, scrapbook: ScrapbookStore, dayKey: string): Promise<Blob> {
  const current = calendar.pageState(dayKey);
  return renderSnapshotState({ ...current, dayKey, placed: scrapbook.items(dayKey) }, scrapbook);
}
