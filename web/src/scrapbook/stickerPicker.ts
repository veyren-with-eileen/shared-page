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
