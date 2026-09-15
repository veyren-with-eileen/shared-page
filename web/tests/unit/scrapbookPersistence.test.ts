import { describe, expect, it } from "vitest";
import type { PlacedItem, StickerLibraryItem } from "../../src/domain/scrapbook";
import { MemoryScrapbookRepository } from "../../src/persistence/scrapbookRepository";

function item(id: string, dayKey: string): PlacedItem {
  return { id, dayKey, kind: "emoji", emoji: "🌷", x: 100, y: 200, scale: 1, rotation: 0, placedAt: "2026-09-15T00:00:00Z" };
}

describe("scrapbook repository", () => {
  it("places and reads records without mixing day keys", async () => {
    const repository = new MemoryScrapbookRepository();
    await repository.putPlacement(item("a", "2026-09-15"));
    await repository.putPlacement(item("b", "2026-09-16"));
    const loaded = await repository.load();
    expect(loaded.placements.filter((entry) => entry.dayKey === "2026-09-15").map((entry) => entry.id)).toEqual(["a"]);
    expect(loaded.placements.filter((entry) => entry.dayKey === "2026-09-16").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("updates placement position, scale, and rotation", async () => {
    const repository = new MemoryScrapbookRepository();
    await repository.putPlacement(item("a", "2026-09-15"));
    await repository.putPlacement({ ...item("a", "2026-09-15"), x: 210, y: 410, scale: 2, rotation: 37 });
    expect(repository.placements.get("a")).toMatchObject({ x: 210, y: 410, scale: 2, rotation: 37 });
  });

  it("removes a placement and its unreferenced photo blob", async () => {
    const repository = new MemoryScrapbookRepository();
    const photo = { ...item("photo", "2026-09-15"), kind: "photo" as const, emoji: undefined, photoKey: "photo_blob" };
    await repository.putPhoto(photo, "photo_blob", new Blob(["photo"]));
    await repository.removePlacement(photo, true);
    expect(repository.placements.has("photo")).toBe(false);
    expect(repository.blobs.has("photo_blob")).toBe(false);
  });

  it("deletes a custom sticker and prunes all associated placements", async () => {
    const repository = new MemoryScrapbookRepository();
    const sticker: StickerLibraryItem = { id: "custom", blobKey: "sticker_blob", width: 10, height: 10, addedAt: "2026-09-15T00:00:00Z" };
    await repository.putSticker(sticker, "sticker_blob", new Blob(["sticker"]));
    await repository.putPlacement({ ...item("a", "2026-09-15"), kind: "sticker", emoji: undefined, stickerId: "custom" });
    await repository.putPlacement({ ...item("b", "2026-09-16"), kind: "sticker", emoji: undefined, stickerId: "custom" });
    await repository.removeSticker(sticker, ["a", "b"]);
    expect(repository.stickers.size).toBe(0);
    expect(repository.placements.size).toBe(0);
    expect(repository.blobs.size).toBe(0);
  });

  it("does not destructively reset storage after a malformed/read failure", async () => {
    const repository = new MemoryScrapbookRepository();
    repository.placements.set("safe", item("safe", "2026-09-15"));
    repository.failReads = true;
    await expect(repository.load()).rejects.toThrow("read failed");
    expect(repository.placements.get("safe")?.dayKey).toBe("2026-09-15");
  });
});
