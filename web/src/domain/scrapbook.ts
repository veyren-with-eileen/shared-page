export const SCRAPBOOK_CANVAS_WIDTH = 402;
export const SCRAPBOOK_TIMELINE_HEIGHT = 1042;
export const PLACED_MIN_SCALE = 0.35;
export const PLACED_MAX_SCALE = 3;
export const PLACED_EDGE_INSET = 8;
export const PLACED_LONG_SIDE = 92;
export const EMOJI_BASE_SIZE = 54;
export const INSTAX_WIDTH = 92;
export const INSTAX_HEIGHT = 143;

export type PlacedKind = "sticker" | "photo" | "emoji";

export interface PlacedItem {
  id: string;
  dayKey: string;
  kind: PlacedKind;
  stickerId?: string;
  photoKey?: string;
  emoji?: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  placedAt: string;
}

export interface StickerLibraryItem {
  id: string;
  builtIn?: string;
  blobKey?: string;
  width: number;
  height: number;
  addedAt: string;
  hasAlpha?: boolean;
}

export const BUILT_IN_STICKERS: readonly StickerLibraryItem[] = [
  { id: "5713ca70-0000-4000-a000-000000000001", builtIn: "halftone-cat-sleeping", width: 919, height: 967, addedAt: "2001-01-01T00:00:01.000Z" },
  { id: "5713ca70-0000-4000-a000-000000000002", builtIn: "halftone-camera", width: 968, height: 887, addedAt: "2001-01-01T00:00:02.000Z" },
  { id: "5713ca70-0000-4000-a000-000000000003", builtIn: "halftone-coffee-cup", width: 950, height: 563, addedAt: "2001-01-01T00:00:03.000Z" },
  { id: "5713ca70-0000-4000-a000-000000000004", builtIn: "admit-one-ticket", width: 934, height: 410, addedAt: "2001-01-01T00:00:04.000Z" },
  { id: "5713ca70-0000-4000-a000-000000000005", builtIn: "red-heart-outline", width: 400, height: 377, addedAt: "2001-01-01T00:00:05.000Z" }
] as const;

export interface Point { x: number; y: number }
export interface RectLike { left: number; top: number; width: number; height: number }

export function pointInRect(point: Point, rect: RectLike): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampPlacedPoint(point: Point): Point {
  return {
    x: clamp(point.x, PLACED_EDGE_INSET, SCRAPBOOK_CANVAS_WIDTH - PLACED_EDGE_INSET),
    y: clamp(point.y, PLACED_EDGE_INSET, SCRAPBOOK_TIMELINE_HEIGHT - PLACED_EDGE_INSET)
  };
}

export function clampPlacedScale(scale: number): number {
  return clamp(scale, PLACED_MIN_SCALE, PLACED_MAX_SCALE);
}

export function canonicalTimelinePoint(
  client: Point,
  timelineRect: RectLike,
  scrollTop: number
): Point | null {
  if (timelineRect.width <= 0) return null;
  const scale = timelineRect.width / SCRAPBOOK_CANVAS_WIDTH;
  const point = {
    x: (client.x - timelineRect.left) / scale,
    y: scrollTop + (client.y - timelineRect.top) / scale
  };
  return clampPlacedPoint(point);
}

export function stickerBaseSize(item: StickerLibraryItem): Point {
  const width = Math.max(1, item.width);
  const height = Math.max(1, item.height);
  const ratio = PLACED_LONG_SIDE / Math.max(width, height);
  return { x: width * ratio, y: height * ratio };
}

export function itemBaseSize(item: PlacedItem, sticker?: StickerLibraryItem): Point {
  if (item.kind === "photo") return { x: INSTAX_WIDTH, y: INSTAX_HEIGHT };
  if (item.kind === "emoji") return { x: EMOJI_BASE_SIZE, y: EMOJI_BASE_SIZE };
  return sticker ? stickerBaseSize(sticker) : { x: PLACED_LONG_SIDE, y: PLACED_LONG_SIDE };
}

export function normalizeAngleDelta(delta: number): number {
  let normalized = delta;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

export function transformStep(
  originScale: number,
  currentRotation: number,
  startDistance: number,
  currentDistance: number,
  previousAngle: number,
  currentAngle: number
): { scale: number; rotation: number } {
  const ratio = startDistance > 0 ? currentDistance / startDistance : 1;
  return {
    scale: clampPlacedScale(originScale * ratio),
    rotation: currentRotation + normalizeAngleDelta(currentAngle - previousAngle)
  };
}

export type StripGestureIntent = "undecided" | "scroll" | "lift";
export type PlacedGestureIntent = "pending" | "scroll" | "drag";

export function placedGestureIntent(selected: boolean, armed: boolean, distance: number, threshold = 10): PlacedGestureIntent {
  if (selected || armed) return "drag";
  return distance > threshold ? "scroll" : "pending";
}

export function stripGestureIntent(dx: number, dy: number, threshold = 6): StripGestureIntent {
  if (Math.hypot(dx, dy) < threshold) return "undecided";
  return Math.abs(dx) >= Math.abs(dy) ? "scroll" : "lift";
}

export function recentPlacedItems(items: readonly PlacedItem[], limit = 3): PlacedItem[] {
  const newest = [...items]
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
    .slice(0, Math.max(0, limit));
  return newest.reverse();
}

export function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? "";
  }
  return Array.from(trimmed)[0] ?? "";
}

export function boundedImageSize(width: number, height: number, maxPixel = 1600): Point {
  if (width <= 0 || height <= 0) return { x: 1, y: 1 };
  const ratio = Math.min(1, maxPixel / Math.max(width, height));
  return { x: Math.round(width * ratio), y: Math.round(height * ratio) };
}

export function provisionalPlacedItem(
  dayKey: string,
  kind: PlacedKind,
  point: Point,
  source: Pick<PlacedItem, "stickerId" | "photoKey" | "emoji"> = {}
): PlacedItem {
  const clamped = clampPlacedPoint(point);
  return {
    id: `placed_${crypto.randomUUID()}`,
    dayKey,
    kind,
    ...source,
    x: clamped.x,
    y: clamped.y,
    scale: 1,
    rotation: 0,
    placedAt: new Date().toISOString()
  };
}
