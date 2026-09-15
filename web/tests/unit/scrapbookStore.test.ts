import { describe, expect, it } from "vitest";
import { MemoryScrapbookRepository } from "../../src/persistence/scrapbookRepository";
import { ScrapbookStore } from "../../src/state/scrapbookStore";

describe("ScrapbookStore", () => {
  it("hydrates placements after a browser-style reload", async () => {
    const repository = new MemoryScrapbookRepository();
    const first = new ScrapbookStore(repository);
    await first.hydrate();
    const placed = await first.placeEmoji("2026-09-15", "👨‍👩‍👧‍👦", { x: 100, y: 220 });
    await first.updatePlacement(placed!.id, { x: 210, y: 430, scale: 1.8, rotation: 28 });

    const reloaded = new ScrapbookStore(repository);
    await reloaded.hydrate();
    expect(reloaded.items("2026-09-15")[0]).toMatchObject({ emoji: "👨‍👩‍👧‍👦", x: 210, y: 430, scale: 1.8, rotation: 28 });
    expect(reloaded.items("2026-09-16")).toEqual([]);
  });

  it("rolls back a failed placement write precisely", async () => {
    const repository = new MemoryScrapbookRepository();
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    const good = await store.placeEmoji("2026-09-15", "✨", { x: 100, y: 200 });
    repository.failWrites = true;
    const failed = await store.placeEmoji("2026-09-15", "🌷", { x: 200, y: 300 });
    expect(failed).toBeNull();
    expect(store.items("2026-09-15").map((entry) => entry.id)).toEqual([good!.id]);
  });

  it("stores photo blob and placement, then removes the last reference", async () => {
    const repository = new MemoryScrapbookRepository();
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    const photo = await store.placePhoto("2026-09-15", { blob: new Blob(["jpeg"]), width: 1200, height: 900, hasAlpha: false }, { x: 201, y: 400 });
    expect(photo?.photoKey).toMatch(/^photo_/);
    expect(repository.blobs.has(photo!.photoKey!)).toBe(true);
    await store.removePlacement(photo!.id);
    expect(repository.blobs.has(photo!.photoKey!)).toBe(false);
    expect(store.items("2026-09-15")).toEqual([]);
  });

  it("hydrates photo placement and blob after reload", async () => {
    const repository = new MemoryScrapbookRepository();
    const first = new ScrapbookStore(repository);
    await first.hydrate();
    const photo = await first.placePhoto("2026-09-16", { blob: new Blob(["jpeg"]), width: 1600, height: 1200, hasAlpha: false }, { x: 201, y: 350 });
    const reloaded = new ScrapbookStore(repository);
    await reloaded.hydrate();
    expect(reloaded.items("2026-09-16")[0].photoKey).toBe(photo!.photoKey);
    expect(repository.blobs.get(photo!.photoKey!)?.size).toBe(4);
  });

  it("rolls back only the failed move", async () => {
    const repository = new MemoryScrapbookRepository();
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    const first = await store.placeEmoji("2026-09-15", "✨", { x: 100, y: 200 });
    const other = await store.placeEmoji("2026-09-15", "🌷", { x: 300, y: 400 });
    repository.failWrites = true;
    await store.updatePlacement(first!.id, { x: 250, y: 500 });
    expect(store.items("2026-09-15").find((entry) => entry.id === first!.id)).toMatchObject({ x: 100, y: 200 });
    expect(store.items("2026-09-15").find((entry) => entry.id === other!.id)).toMatchObject({ x: 300, y: 400 });
  });

  it("restores a precisely removed item when persistence fails", async () => {
    const repository = new MemoryScrapbookRepository();
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    const placed = await store.placeEmoji("2026-09-15", "🐾", { x: 150, y: 280 });
    repository.failWrites = true;
    await store.removePlacement(placed!.id);
    expect(store.items("2026-09-15").map((entry) => entry.id)).toEqual([placed!.id]);
  });

  it("persists a custom sticker and prunes its placements on library delete", async () => {
    const repository = new MemoryScrapbookRepository();
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    const sticker = await store.addCustomSticker({ blob: new Blob(["png"]), width: 300, height: 200, hasAlpha: true });
    await store.placeSticker("2026-09-15", sticker!.id, { x: 100, y: 200 });
    await store.placeSticker("2026-09-16", sticker!.id, { x: 200, y: 300 });
    await store.removeCustomSticker(sticker!.id);
    expect(store.sticker(sticker!.id)).toBeUndefined();
    expect(store.items("2026-09-15")).toEqual([]);
    expect(store.items("2026-09-16")).toEqual([]);
    expect(repository.blobs.size).toBe(0);
  });

  it("removes a torn item and it does not return after reload", async () => {
    const repository = new MemoryScrapbookRepository();
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    const placed = await store.placeEmoji("2026-09-15", "🐾", { x: 201, y: 500 });
    await store.removePlacement(placed!.id);
    const reloaded = new ScrapbookStore(repository);
    await reloaded.hydrate();
    expect(reloaded.items("2026-09-15")).toEqual([]);
  });

  it("reports a read failure without overwriting repository data", async () => {
    const repository = new MemoryScrapbookRepository();
    repository.placements.set("safe", { id: "safe", dayKey: "2026-09-15", kind: "emoji", emoji: "♡", x: 201, y: 200, scale: 1, rotation: 0, placedAt: "2026-09-15T00:00:00Z" });
    repository.failReads = true;
    const store = new ScrapbookStore(repository);
    await store.hydrate();
    expect(store.snapshot().status).toBe("error");
    expect(repository.placements.has("safe")).toBe(true);
  });
});
