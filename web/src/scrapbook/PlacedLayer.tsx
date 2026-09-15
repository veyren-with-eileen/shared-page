import { useRef, useState } from "preact/hooks";
import {
  SCRAPBOOK_CANVAS_WIDTH,
  clampPlacedPoint,
  itemBaseSize,
  placedGestureIntent,
  recentPlacedItems,
  transformStep,
  type PlacedItem,
  type Point,
  type StickerLibraryItem
} from "../domain/scrapbook";
import type { ScrapbookStore } from "../state/scrapbookStore";
import "./scrapbook.css";

interface PlacedLayerProps {
  store: ScrapbookStore;
  items: PlacedItem[];
  selectedId: string | null;
  timeline: HTMLElement | null;
  editable: boolean;
  onSelect(id: string | null): void;
  onBusyChange(busy: boolean): void;
}

interface GestureState {
  pointerId: number;
  startClient: Point;
  startPoint: Point;
  startScroll: number;
  scale: number;
  armed: boolean;
  scrolling: boolean;
  timer?: number;
}

interface TransformState {
  pointerId: number;
  startScale: number;
  startDistance: number;
  lastAngle: number;
  rotation: number;
}

function itemSource(item: PlacedItem, sticker: StickerLibraryItem | undefined, store: ScrapbookStore): string | null {
  if (item.kind === "photo") return item.photoKey ? store.photoUrl(item.photoKey) : null;
  if (item.kind === "sticker" && sticker) return store.stickerUrl(sticker);
  return null;
}

function PlacedArt({ item, source }: { item: PlacedItem; source: string | null }) {
  if (item.kind === "emoji") return <span class="placed-emoji">{item.emoji}</span>;
  if (item.kind === "photo") return (
    <span class="placed-photo">
      {source ? <img class="placed-photo-image" src={source} alt="" draggable={false} /> : <span class="placed-photo-missing" />}
      <img class="placed-photo-frame" src="/assets/instax-mini-frame.png" alt="" draggable={false} />
    </span>
  );
  return source
    ? <img class="placed-sticker-image" src={source} alt="" draggable={false} />
    : <span class="placed-missing" aria-label="Missing sticker" />;
}

function PlacedItemView({ item, sticker, store, timeline, selected, editable, onSelect, onDeselect, onBusyChange }: {
  item: PlacedItem;
  sticker?: StickerLibraryItem;
  store: ScrapbookStore;
  timeline: HTMLElement | null;
  selected: boolean;
  editable: boolean;
  onSelect(): void;
  onDeselect(): void;
  onBusyChange(busy: boolean): void;
}) {
  const size = itemBaseSize(item, sticker);
  const source = itemSource(item, sticker, store);
  const [livePoint, setLivePoint] = useState<Point | null>(null);
  const [liveTransform, setLiveTransform] = useState<{ scale: number; rotation: number } | null>(null);
  const [lifted, setLifted] = useState(false);
  const [tearing, setTearing] = useState(false);
  const gesture = useRef<GestureState | null>(null);
  const transforming = useRef<TransformState | null>(null);
  const displayPoint = livePoint ?? item;
  const displayScale = liveTransform?.scale ?? item.scale;
  const displayRotation = liveTransform?.rotation ?? item.rotation;

  function timelineScale(): number {
    const width = timeline?.getBoundingClientRect().width ?? SCRAPBOOK_CANVAS_WIDTH;
    return width > 0 ? width / SCRAPBOOK_CANVAS_WIDTH : 1;
  }

  function armMove(target: HTMLElement, state: GestureState) {
    state.armed = true;
    setLifted(true);
    onSelect();
    onBusyChange(true);
    if (!target.hasPointerCapture(state.pointerId)) target.setPointerCapture(state.pointerId);
  }

  function pointerDown(event: PointerEvent) {
    if (!editable || event.button !== 0 || (event.target as Element).closest(".placed-control")) return;
    const target = event.currentTarget as HTMLElement;
    const state: GestureState = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPoint: { x: item.x, y: item.y },
      startScroll: timeline?.scrollTop ?? 0,
      scale: timelineScale(),
      armed: selected,
      scrolling: false
    };
    gesture.current = state;
    target.setPointerCapture(event.pointerId);
    if (selected) {
      event.preventDefault();
      armMove(target, state);
    } else {
      state.timer = window.setTimeout(() => {
        if (gesture.current === state && !state.scrolling) armMove(target, state);
      }, 500);
    }
  }

  function pointerMove(event: PointerEvent) {
    const state = gesture.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startClient.x;
    const dy = event.clientY - state.startClient.y;
    if (!state.armed && !state.scrolling && placedGestureIntent(selected, state.armed, Math.hypot(dx, dy)) === "scroll") {
      if (state.timer) window.clearTimeout(state.timer);
      state.scrolling = true;
    }
    if (state.scrolling) {
      event.preventDefault();
      if (timeline) timeline.scrollTop = state.startScroll - dy / state.scale;
      return;
    }
    if (state.armed) {
      event.preventDefault();
      setLivePoint(clampPlacedPoint({ x: state.startPoint.x + dx / state.scale, y: state.startPoint.y + dy / state.scale }));
    }
  }

  function pointerEnd(event: PointerEvent) {
    const state = gesture.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.timer) window.clearTimeout(state.timer);
    gesture.current = null;
    if (state.armed && livePoint) void store.updatePlacement(item.id, livePoint);
    setLivePoint(null);
    setLifted(false);
    if (state.armed) onBusyChange(false);
  }

  function transformDown(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const rect = timeline?.getBoundingClientRect();
    const scale = timelineScale();
    const center = {
      x: (rect?.left ?? 0) + item.x * scale,
      y: (rect?.top ?? 0) + (item.y - (timeline?.scrollTop ?? 0)) * scale
    };
    const vector = { x: event.clientX - center.x, y: event.clientY - center.y };
    transforming.current = {
      pointerId: event.pointerId,
      startScale: item.scale,
      startDistance: Math.max(1, Math.hypot(vector.x, vector.y)),
      lastAngle: Math.atan2(vector.y, vector.x) * 180 / Math.PI,
      rotation: item.rotation
    };
    setLifted(true);
    onBusyChange(true);
  }

  function transformMove(event: PointerEvent) {
    const state = transforming.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = timeline?.getBoundingClientRect();
    const scale = timelineScale();
    const centerX = (rect?.left ?? 0) + item.x * scale;
    const centerY = (rect?.top ?? 0) + (item.y - (timeline?.scrollTop ?? 0)) * scale;
    const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
    const next = transformStep(state.startScale, state.rotation, state.startDistance, distance, state.lastAngle, angle);
    state.rotation = next.rotation;
    state.lastAngle = angle;
    setLiveTransform(next);
  }

  function transformEnd(event: PointerEvent) {
    const state = transforming.current;
    if (!state || state.pointerId !== event.pointerId) return;
    transforming.current = null;
    if (liveTransform) void store.updatePlacement(item.id, liveTransform);
    setLiveTransform(null);
    setLifted(false);
    onBusyChange(false);
  }

  function tear(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setTearing(true);
    onDeselect();
    window.setTimeout(() => void store.removePlacement(item.id), 340);
  }

  return (
    <span class="placed-position" style={{ left: `${displayPoint.x}px`, top: `${displayPoint.y}px`, zIndex: selected || lifted ? 19 : 8 }}>
      <span
        class={["placed-item", selected ? "is-selected" : "", lifted ? "is-lifted" : "", tearing ? "is-tearing" : ""].filter(Boolean).join(" ")}
        style={{
          width: `${size.x}px`,
          height: `${size.y}px`,
          "--placed-scale": displayScale,
          "--placed-inverse-scale": 1 / Math.max(displayScale, 0.01),
          "--placed-rotation": `${displayRotation}deg`,
          "--placed-inverse-rotation": `${-displayRotation}deg`
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onContextMenu={(event) => event.preventDefault()}
      >
        <PlacedArt item={item} source={source} />
        {selected && editable && <>
          <span class="placed-marquee" aria-hidden="true" />
          <button class="placed-control placed-tear" type="button" aria-label="Tear off" onClick={tear}>×</button>
          <button
            class="placed-control placed-transform-handle"
            type="button"
            aria-label="Resize and rotate"
            onPointerDown={transformDown}
            onPointerMove={transformMove}
            onPointerUp={transformEnd}
            onPointerCancel={transformEnd}
          >↖↘</button>
        </>}
      </span>
    </span>
  );
}

export function PlacedLayer({ store, items, selectedId, timeline, editable, onSelect, onBusyChange }: PlacedLayerProps) {
  return <div class="placed-layer" aria-label="Scrapbook layer">
    {items.map((item) => <PlacedItemView
      key={item.id}
      item={item}
      sticker={item.stickerId ? store.sticker(item.stickerId) : undefined}
      store={store}
      timeline={timeline}
      selected={selectedId === item.id}
      editable={editable}
      onSelect={() => onSelect(item.id)}
      onDeselect={() => onSelect(null)}
      onBusyChange={onBusyChange}
    />)}
  </div>;
}

export function PlacedThumbs({ store, items }: { store: ScrapbookStore; items: PlacedItem[] }) {
  return <span class="placed-thumbs" aria-hidden="true">
    {recentPlacedItems(items).map((item, index) => {
      const sticker = item.stickerId ? store.sticker(item.stickerId) : undefined;
      const source = itemSource(item, sticker, store);
      return <span class={`placed-thumb kind-${item.kind}`} style={{ "--thumb-index": index }} key={item.id}>
        {item.kind === "emoji" ? item.emoji : source && <img src={source} alt="" />}
      </span>;
    })}
  </span>;
}
