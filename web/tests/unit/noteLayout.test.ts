import { describe, expect, it } from "vitest";
import {
  NOTE_TEXT_MAX_HEIGHT,
  NOTE_TEXT_MIN_HEIGHT,
  noteTextHeight,
  scrollTopForVisibleItem
} from "../../src/notes/noteLayout";

describe("torn note layout", () => {
  it("grows with content between the readable minimum and maximum", () => {
    expect(noteTextHeight(18)).toBe(NOTE_TEXT_MIN_HEIGHT);
    expect(noteTextHeight(84)).toBe(84);
    expect(noteTextHeight(240)).toBe(NOTE_TEXT_MAX_HEIGHT);
  });

  it("keeps a visible active note at the current timeline position", () => {
    expect(scrollTopForVisibleItem(200, 400, 1042, 280, 120)).toBe(200);
  });

  it("moves only the timeline enough to reveal a note above or below", () => {
    expect(scrollTopForVisibleItem(200, 400, 1042, 170, 100)).toBe(158);
    expect(scrollTopForVisibleItem(200, 400, 1042, 540, 100)).toBe(252);
  });

  it("uses the keyboard-visible slice while preserving the Timeline as scroll owner", () => {
    expect(scrollTopForVisibleItem(200, 600, 1342, 620, 100, 0, 300)).toBe(432);
    expect(scrollTopForVisibleItem(200, 600, 1342, 210, 100, 40, 260)).toBe(158);
  });

  it("clamps keyboard visibility scrolling to the timeline range", () => {
    expect(scrollTopForVisibleItem(0, 400, 1042, -30, 100)).toBe(0);
    expect(scrollTopForVisibleItem(600, 400, 1042, 990, 120)).toBe(642);
  });
});
