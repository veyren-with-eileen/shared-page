import {
  BUILT_IN_STICKERS,
  clampPlacedPoint,
  clampPlacedScale,
  provisionalPlacedItem,
  type PlacedItem,
  type Point,
  type StickerLibraryItem
} from "../domain/scrapbook";
import type { ProcessedImage } from "../scrapbook/imageProcessing";
import type { ScrapbookRepository } from "../persistence/scrapbookRepository";
import { NOOP_PAGE_DIRTY, type PageDirtySink } from "../snapshot/pageDirty";

export type ScrapbookStatus = "idle" | "loading" | "ready" | "error";

export interface ScrapbookSnapshot {
  status: ScrapbookStatus;
  byDay: Map<string, PlacedItem[]>;
  customStickers: StickerLibraryItem[];
  message: string | null;
}

export class ScrapbookStore {
  private byDay = new Map<string, PlacedItem[]>();
  private customStickers: StickerLibraryItem[] = [];
  private blobs = new Map<string, Blob>();
  private urls = new Map<string, string>();
  private listeners = new Set<() => void>();
  private mutationQueues = new Map<string, Promise<void>>();
  private loadPromise?: Promise<void>;
  private status: ScrapbookStatus = "idle";
  private message: string | null = null;

  constructor(
    private readonly repository: ScrapbookRepository,
    private readonly pageDirty: PageDirtySink = NOOP_PAGE_DIRTY
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ScrapbookSnapshot {
    return {
      status: this.status,
      byDay: new Map([...this.byDay].map(([day, items]) => [day, [...items]])),
      customStickers: [...this.customStickers],
      message: this.message
    };
  }

  private emit() { for (const listener of this.listeners) listener(); }

  async hydrate(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.status = "loading";
    this.emit();
    this.loadPromise = (async () => {
      try {
        const loaded = await this.repository.load();
        const map = new Map<string, PlacedItem[]>();
        for (const item of loaded.placements) map.set(item.dayKey, [...(map.get(item.dayKey) ?? []), item]);
        this.byDay = map;
        this.customStickers = loaded.stickers.sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
        this.blobs = loaded.blobs;
        this.status = "ready";
      } catch {
        // A read failure never clears or rewrites IndexedDB. Keep the current in-memory view intact.
        this.status = "error";
        this.message = "scrapbook couldn't be loaded · storage was left untouched";
      }
      this.emit();
    })();
    return this.loadPromise;
  }

  dispose() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.listeners.clear();
  }

  items(dayKey: string): PlacedItem[] { return this.byDay.get(dayKey) ?? []; }

  stickers(): StickerLibraryItem[] {
    return [...this.customStickers].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)).concat(BUILT_IN_STICKERS);
  }

  sticker(id: string): StickerLibraryItem | undefined {
    return this.stickers().find((item) => item.id === id);
  }

  stickerUrl(item: StickerLibraryItem): string | null {
    if (item.builtIn) return `/assets/${item.builtIn}.png`;
    return item.blobKey ? this.blobUrl(item.blobKey) : null;
  }

  photoUrl(key: string): string | null { return this.blobUrl(key); }

  private blobUrl(key: string): string | null {
    const existing = this.urls.get(key);
    if (existing) return existing;
    const blob = this.blobs.get(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  }

  clearMessage() { this.message = null; this.emit(); }

  private replace(item: PlacedItem | null, previousId?: string) {
    const id = previousId ?? item?.id;
    if (!id) return;
    const before = [...this.byDay.values()].flat().find((entry) => entry.id === id || entry.id === item?.id);
    for (const [day, list] of this.byDay) {
      const next = list.filter((entry) => entry.id !== id && entry.id !== item?.id);
      if (next.length) this.byDay.set(day, next);
      else this.byDay.delete(day);
    }
    if (item) this.byDay.set(item.dayKey, [...(this.byDay.get(item.dayKey) ?? []), item]);
    for (const day of new Set([before?.dayKey, item?.dayKey].filter((value): value is string => Boolean(value)))) {
      this.pageDirty.markDirty(day);
    }
    this.emit();
  }

  private fail(message = "scrapbook couldn't be saved · your change was restored") {
    this.message = message;
    this.emit();
  }

  async placeSticker(dayKey: string, stickerId: string, point: Point): Promise<PlacedItem | null> {
    const item = provisionalPlacedItem(dayKey, "sticker", point, { stickerId });
    return this.place(item);
  }

  async placeEmoji(dayKey: string, emoji: string, point: Point): Promise<PlacedItem | null> {
    const item = provisionalPlacedItem(dayKey, "emoji", point, { emoji });
    return this.place(item);
  }

  private async place(item: PlacedItem): Promise<PlacedItem | null> {
    this.message = null;
    this.replace(item);
    try {
      await this.repository.putPlacement(item);
      return item;
    } catch {
      this.replace(null, item.id);
      this.fail();
      return null;
    }
  }

  async placePhoto(dayKey: string, image: ProcessedImage, point: Point): Promise<PlacedItem | null> {
    const photoKey = `photo_${crypto.randomUUID()}`;
    const item = provisionalPlacedItem(dayKey, "photo", point, { photoKey });
    this.blobs.set(photoKey, image.blob);
    this.replace(item);
    try {
      await this.repository.putPhoto(item, photoKey, image.blob);
      return item;
    } catch {
      this.replace(null, item.id);
      this.blobs.delete(photoKey);
      this.revoke(photoKey);
      this.fail();
      return null;
    }
  }

  updatePlacement(id: string, changes: Partial<Pick<PlacedItem, "x" | "y" | "scale" | "rotation">>): Promise<void> {
    const before = [...this.byDay.values()].flat().find((item) => item.id === id);
    if (!before) return Promise.resolve();
    const point = clampPlacedPoint({ x: changes.x ?? before.x, y: changes.y ?? before.y });
    const next = {
      ...before,
      ...changes,
      x: point.x,
      y: point.y,
      scale: clampPlacedScale(changes.scale ?? before.scale)
    };
    this.replace(next, id);
    const previous = this.mutationQueues.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      try {
        await this.repository.putPlacement(next);
      } catch {
        const current = [...this.byDay.values()].flat().find((item) => item.id === id);
        if (current === next || (current && current.x === next.x && current.y === next.y && current.scale === next.scale && current.rotation === next.rotation)) {
          this.replace(before, id);
        }
        this.fail();
      }
    }).finally(() => { if (this.mutationQueues.get(id) === queued) this.mutationQueues.delete(id); });
    this.mutationQueues.set(id, queued);
    return queued;
  }

  async removePlacement(id: string): Promise<void> {
    const item = [...this.byDay.values()].flat().find((entry) => entry.id === id);
    if (!item) return;
    this.replace(null, id);
    const removePhotoBlob = Boolean(item.photoKey) && ![...this.byDay.values()].flat().some((entry) => entry.photoKey === item.photoKey);
    try {
      await (this.mutationQueues.get(id) ?? Promise.resolve());
      await this.repository.removePlacement(item, removePhotoBlob);
      if (removePhotoBlob && item.photoKey) {
        this.blobs.delete(item.photoKey);
        this.revoke(item.photoKey);
      }
    } catch {
      this.replace(item);
      this.fail();
    }
  }

  async addCustomSticker(image: ProcessedImage): Promise<StickerLibraryItem | null> {
    const id = crypto.randomUUID();
    const blobKey = `sticker_${id}`;
    const item: StickerLibraryItem = {
      id,
      blobKey,
      width: image.width,
      height: image.height,
      addedAt: new Date().toISOString(),
      hasAlpha: image.hasAlpha
    };
    this.customStickers = [item, ...this.customStickers];
    this.blobs.set(blobKey, image.blob);
    this.emit();
    try {
      await this.repository.putSticker(item, blobKey, image.blob);
      return item;
    } catch {
      this.customStickers = this.customStickers.filter((entry) => entry.id !== id);
      this.blobs.delete(blobKey);
      this.revoke(blobKey);
      this.fail();
      return null;
    }
  }

  async removeCustomSticker(id: string): Promise<void> {
    const item = this.customStickers.find((entry) => entry.id === id);
    if (!item) return;
    const placements = [...this.byDay.values()].flat().filter((entry) => entry.stickerId === id);
    this.customStickers = this.customStickers.filter((entry) => entry.id !== id);
    for (const placement of placements) this.replace(null, placement.id);
    try {
      await this.repository.removeSticker(item, placements.map((entry) => entry.id));
      if (item.blobKey) {
        this.blobs.delete(item.blobKey);
        this.revoke(item.blobKey);
      }
      this.emit();
    } catch {
      this.customStickers = [item, ...this.customStickers];
      for (const placement of placements) this.replace(placement);
      this.fail();
    }
  }

  private revoke(key: string) {
    const url = this.urls.get(key);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(key);
  }
}
