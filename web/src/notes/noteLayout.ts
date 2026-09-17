export const NOTE_TEXT_MIN_HEIGHT = 44;
export const NOTE_TEXT_MAX_HEIGHT = 132;

export function noteTextHeight(scrollHeight: number): number {
  return Math.min(NOTE_TEXT_MAX_HEIGHT, Math.max(NOTE_TEXT_MIN_HEIGHT, scrollHeight));
}

export function scrollTopForVisibleItem(
  currentScrollTop: number,
  viewportHeight: number,
  scrollHeight: number,
  itemTop: number,
  itemHeight: number,
  visibleTopInset = 0,
  visibleHeight = viewportHeight - visibleTopInset,
  inset = 12
): number {
  const safeVisibleHeight = Math.max(0, visibleHeight);
  const visibleTop = currentScrollTop + visibleTopInset;
  const visibleBottom = visibleTop + safeVisibleHeight;
  let next = currentScrollTop;
  if (itemHeight + inset * 2 >= safeVisibleHeight || itemTop < visibleTop + inset) {
    next = itemTop - visibleTopInset - inset;
  } else if (itemTop + itemHeight > visibleBottom - inset) {
    next = itemTop + itemHeight - visibleTopInset - safeVisibleHeight + inset;
  }
  return Math.min(Math.max(0, next), Math.max(0, scrollHeight - viewportHeight));
}
