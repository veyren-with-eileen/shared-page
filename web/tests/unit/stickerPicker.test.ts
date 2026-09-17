import { describe, expect, it } from "vitest";
import { nextStickerPickerOpen } from "../../src/scrapbook/stickerPicker";

describe("sticker picker lifecycle", () => {
  it("toggles open and closed from the sticker button", () => {
    expect(nextStickerPickerOpen(false, "toggle")).toBe(true);
    expect(nextStickerPickerOpen(true, "toggle")).toBe(false);
  });

  it("closes only for an outside dismissal or an accepted drop", () => {
    expect(nextStickerPickerOpen(true, "outside-dismiss")).toBe(false);
    expect(nextStickerPickerOpen(true, "accepted-drop")).toBe(false);
  });

  it("stays open after a rejected or cancelled drag", () => {
    expect(nextStickerPickerOpen(true, "rejected-drop")).toBe(true);
    expect(nextStickerPickerOpen(true, "cancelled-drag")).toBe(true);
  });
});
