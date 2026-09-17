import { describe, expect, it } from "vitest";
import { nextStickerPickerOpen, stickerDragCompletion, stickerPreviewTransform } from "../../src/scrapbook/stickerPicker";

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

  it("drops only a completed lift outside the picker", () => {
    expect(stickerDragCompletion("lift", false, false)).toBe("drop");
    expect(stickerDragCompletion("lift", false, true)).toBe("none");
    expect(stickerDragCompletion("scroll", false, false)).toBe("none");
    expect(stickerDragCompletion("lift", true, false)).toBe("cancel");
  });

  it("positions one compositor preview with a transform-only update", () => {
    expect(stickerPreviewTransform(120, 200, 40, 60)).toBe(
      "translate3d(100px, 170px, 0) rotate(-4deg) scale(1.06)"
    );
  });
});
