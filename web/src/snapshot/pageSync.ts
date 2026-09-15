import { isValidPageDayKey, type PageDirtySink } from "./pageDirty";

export type RenderPage = (dayKey: string) => Promise<Blob>;
export type UploadPage = (dayKey: string, png: Blob) => Promise<void>;

export class PageSync implements PageDirtySink {
  private readonly dirty = new Map<string, number>();
  private generation = 0;
  private quietTimer: number | undefined;
  private activeFlush: Promise<void> | null = null;
  private flushRequested = false;
  private detachLifecycle: (() => void) | null = null;

  constructor(
    private readonly renderPage: RenderPage,
    private readonly uploadPage: UploadPage,
    private readonly quietDelay = 1_500
  ) {}

  markDirty(dayKey: string): void {
    this.dirty.set(dayKey, ++this.generation);
    this.scheduleQuietFlush();
  }

  dirtyGeneration(dayKey: string): number | undefined { return this.dirty.get(dayKey); }
  dirtyDayKeys(): string[] { return [...this.dirty.keys()]; }

  private scheduleQuietFlush() {
    if (this.quietTimer !== undefined) globalThis.clearTimeout(this.quietTimer);
    this.quietTimer = globalThis.setTimeout(() => {
      this.quietTimer = undefined;
      void this.flush();
    }, this.quietDelay);
  }

  flush(): Promise<void> {
    if (this.quietTimer !== undefined) {
      globalThis.clearTimeout(this.quietTimer);
      this.quietTimer = undefined;
    }
    if (this.activeFlush) {
      this.flushRequested = true;
      return this.activeFlush;
    }
    if (this.dirty.size === 0) return Promise.resolve();

    const batch = [...this.dirty.entries()];
    this.flushRequested = false;
    const flight = this.flushBatch(batch).finally(() => {
      this.activeFlush = null;
      if (this.flushRequested && this.dirty.size > 0) this.scheduleQuietFlush();
    });
    this.activeFlush = flight;
    return flight;
  }

  private async flushBatch(batch: [string, number][]): Promise<void> {
    for (const [dayKey, generation] of batch) {
      if (!isValidPageDayKey(dayKey)) {
        if (this.dirty.get(dayKey) === generation) this.dirty.delete(dayKey);
        continue;
      }
      try {
        const png = await this.renderPage(dayKey);
        await this.uploadPage(dayKey, png);
        if (this.dirty.get(dayKey) === generation) this.dirty.delete(dayKey);
      } catch {
        // Keep the generation dirty. A later mutation/navigation/lifecycle trigger retries it.
      }
    }
  }

  attachLifecycle(doc: Document = document, view: Window = window): () => void {
    this.detachLifecycle?.();
    const visibility = () => { if (doc.visibilityState === "hidden") void this.flush(); };
    const pageHide = () => { void this.flush(); };
    doc.addEventListener("visibilitychange", visibility);
    view.addEventListener("pagehide", pageHide);
    const detach = () => {
      doc.removeEventListener("visibilitychange", visibility);
      view.removeEventListener("pagehide", pageHide);
      if (this.detachLifecycle === detach) this.detachLifecycle = null;
    };
    this.detachLifecycle = detach;
    return detach;
  }

  dispose() {
    this.detachLifecycle?.();
    if (this.quietTimer !== undefined) globalThis.clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
  }
}
