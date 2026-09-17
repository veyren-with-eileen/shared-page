export type StickerPickerAction =
  | "toggle"
  | "outside-dismiss"
  | "accepted-drop"
  | "rejected-drop"
  | "cancelled-drag";

export function nextStickerPickerOpen(open: boolean, action: StickerPickerAction): boolean {
  switch (action) {
    case "toggle":
      return !open;
    case "outside-dismiss":
    case "accepted-drop":
      return false;
    case "rejected-drop":
    case "cancelled-drag":
      return open;
  }
}

export type StickerDragIntent = "undecided" | "scroll" | "lift";
export type StickerDragCompletion = "none" | "drop" | "cancel";

/** The transient WebKit compositor layer must not rasterize a transparent-PNG shadow. */
export const STICKER_DRAG_PREVIEW_FILTER = "none" as const;

export function stickerDragCompletion(
  intent: StickerDragIntent,
  cancelled: boolean,
  endedInsidePicker: boolean
): StickerDragCompletion {
  if (cancelled) return "cancel";
  if (intent === "lift" && !endedInsidePicker) return "drop";
  return "none";
}

export function stickerPreviewTransform(
  clientX: number,
  clientY: number,
  width: number,
  height: number
): string {
  return `translate3d(${clientX - width / 2}px, ${clientY - height / 2}px, 0) rotate(-4deg) scale(1.06)`;
}
