export const NOTE_TEXT_MIN_HEIGHT = 42;
export const NOTE_TEXT_MAX_HEIGHT = 126;

export function noteTextHeight(scrollHeight: number): number {
  return Math.min(NOTE_TEXT_MAX_HEIGHT, Math.max(NOTE_TEXT_MIN_HEIGHT, scrollHeight));
}

export function scrollTopForVisibleItem(
  currentScrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  itemTop: number,
  itemHeight: number,
  inset = 12
): number {
  let next = currentScrollTop;
  if (itemTop < currentScrollTop + inset) {
    next = itemTop - inset;
  } else if (itemTop + itemHeight > currentScrollTop + viewportHeight - inset) {
    next = itemTop + itemHeight - viewportHeight + inset;
  }
  return Math.min(Math.max(0, next), Math.max(0, scrollHeight - viewportHeight));
}
