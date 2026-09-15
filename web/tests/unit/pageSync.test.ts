import { describe, expect, it, vi } from "vitest";
import { PageSync } from "../../src/snapshot/pageSync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const png = () => new Blob(["png"], { type: "image/png" });

describe("PageSync generations", () => {
  it("clears a successful unchanged generation", async () => {
    const sync = new PageSync(vi.fn().mockResolvedValue(png()), vi.fn().mockResolvedValue(undefined));
    sync.markDirty("2026-09-15");
    await sync.flush();
    expect(sync.dirtyDayKeys()).toEqual([]);
  });

  it("keeps a newer generation dirtied during upload", async () => {
    const upload = deferred<void>();
    const sync = new PageSync(vi.fn().mockResolvedValue(png()), vi.fn().mockReturnValue(upload.promise));
    sync.markDirty("2026-09-15");
    const first = sync.flush();
    await vi.waitFor(() => expect(sync.dirtyGeneration("2026-09-15")).toBe(1));
    sync.markDirty("2026-09-15");
    upload.resolve();
    await first;
    expect(sync.dirtyGeneration("2026-09-15")).toBe(2);
    sync.dispose();
  });

  it("keeps dirty when rendering fails", async () => {
    const sync = new PageSync(vi.fn().mockRejectedValue(new Error("render")), vi.fn());
    sync.markDirty("2026-09-15");
    await sync.flush();
    expect(sync.dirtyDayKeys()).toEqual(["2026-09-15"]);
  });

  it("keeps dirty when upload fails", async () => {
    const sync = new PageSync(vi.fn().mockResolvedValue(png()), vi.fn().mockRejectedValue(new Error("upload")));
    sync.markDirty("2026-09-15");
    await sync.flush();
    expect(sync.dirtyDayKeys()).toEqual(["2026-09-15"]);
  });

  it("drops an invalid day key", async () => {
    const render = vi.fn();
    const sync = new PageSync(render, vi.fn());
    sync.markDirty("2026-02-31");
    await sync.flush();
    expect(sync.dirtyDayKeys()).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it("does not duplicate an active batch", async () => {
    const upload = deferred<void>();
    const uploader = vi.fn().mockReturnValue(upload.promise);
    const renderer = vi.fn().mockResolvedValue(png());
    const sync = new PageSync(renderer, uploader);
    sync.markDirty("2026-09-15");
    const first = sync.flush();
    const second = sync.flush();
    expect(first).toBe(second);
    upload.resolve();
    await Promise.all([first, second]);
    expect(renderer).toHaveBeenCalledTimes(1);
    sync.dispose();
  });

  it("processes a dirty batch sequentially", async () => {
    const order: string[] = [];
    const sync = new PageSync(async (day) => { order.push(`render:${day}`); return png(); }, async (day) => { order.push(`upload:${day}`); });
    sync.markDirty("2026-09-15"); sync.markDirty("2026-09-16");
    await sync.flush();
    expect(order).toEqual(["render:2026-09-15", "upload:2026-09-15", "render:2026-09-16", "upload:2026-09-16"]);
  });

  it("does not form a retry loop after failure", async () => {
    vi.useFakeTimers();
    const render = vi.fn().mockRejectedValue(new Error("no"));
    const sync = new PageSync(render, vi.fn(), 1_500);
    sync.markDirty("2026-09-15");
    await sync.flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(render).toHaveBeenCalledTimes(1);
    sync.dispose();
    vi.useRealTimers();
  });

  it("quiet-period debounce coalesces marks", async () => {
    vi.useFakeTimers();
    const render = vi.fn().mockResolvedValue(png());
    const sync = new PageSync(render, vi.fn().mockResolvedValue(undefined), 1_500);
    sync.markDirty("2026-09-15");
    await vi.advanceTimersByTimeAsync(1_000);
    sync.markDirty("2026-09-15");
    await vi.advanceTimersByTimeAsync(1_499);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
    sync.dispose();
    vi.useRealTimers();
  });
});
