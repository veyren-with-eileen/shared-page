import { useEffect, useRef, useState } from "preact/hooks";
import { firstGrapheme, pointInRect, stickerBaseSize, stripGestureIntent, type Point, type StickerLibraryItem } from "../domain/scrapbook";
import { processCustomSticker } from "./imageProcessing";
import type { ScrapbookStore } from "../state/scrapbookStore";
import "./scrapbook.css";

const CELL = 48;
const GAP = 8;
const STRIP_WIDTH = 268;
const QUICK_EMOJI = ["♡", "✨", "🌷", "🐾", "🍓", "☕", "🌙", "🎀"];

interface StickerStripProps {
  store: ScrapbookStore;
  stickers: StickerLibraryItem[];
  open: boolean;
  onDrop(item: StickerLibraryItem, client: Point): void;
  onPickEmoji(emoji: string): void;
}

interface DragState {
  item: StickerLibraryItem;
  pointerId: number;
  start: Point;
  current: Point;
  startScroll: number;
  intent: "undecided" | "scroll" | "lift";
  deleteTimer?: number;
}

export function StickerStrip({ store, stickers, open, onDrop, onPickEmoji }: StickerStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLInputElement>(null);
  const drag = useRef<DragState | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const [lifted, setLifted] = useState<{ item: StickerLibraryItem; point: Point } | null>(null);
  const [markedId, setMarkedId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const contentWidth = (stickers.length + 2) * CELL + (stickers.length + 1) * GAP + 18;
  const minScroll = Math.min(0, STRIP_WIDTH - contentWidth);

  useEffect(() => {
    if (!open) {
      setEmojiOpen(false);
      setMarkedId(null);
      setLifted(null);
    }
  }, [open]);

  useEffect(() => setScrollX((value) => Math.max(minScroll, value)), [minScroll]);

  function chooseEmoji(value: string) {
    const emoji = firstGrapheme(value);
    if (!emoji) return;
    onPickEmoji(emoji);
    setEmojiOpen(false);
    if (emojiRef.current) emojiRef.current.value = "";
  }

  async function importSticker(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      await store.addCustomSticker(await processCustomSticker(file));
    } catch {
      // Store owns persistent errors; decode failures simply leave the strip unchanged.
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  function pointerDown(item: StickerLibraryItem, event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const state: DragState = {
      item,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      startScroll: scrollX,
      intent: "undecided"
    };
    if (!item.builtIn) {
      state.deleteTimer = window.setTimeout(() => {
        if (drag.current === state && state.intent === "undecided") setMarkedId(item.id);
      }, 320);
    }
    drag.current = state;
  }

  function pointerMove(event: PointerEvent) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.start.x;
    const dy = event.clientY - state.start.y;
    if (state.intent === "undecided") {
      state.intent = stripGestureIntent(dx, dy);
      if (state.intent !== "undecided" && state.deleteTimer) window.clearTimeout(state.deleteTimer);
      if (state.intent === "lift") setLifted({ item: state.item, point: { x: event.clientX, y: event.clientY } });
      if (state.intent !== "undecided") setMarkedId(null);
    }
    if (state.intent === "scroll") {
      event.preventDefault();
      const stripWidth = stripRef.current?.getBoundingClientRect().width ?? STRIP_WIDTH;
      const canvasScale = stripWidth / STRIP_WIDTH;
      setScrollX(Math.min(0, Math.max(minScroll, state.startScroll + dx / canvasScale)));
    }
    if (state.intent === "lift") {
      event.preventDefault();
      state.current = { x: event.clientX, y: event.clientY };
      setLifted({ item: state.item, point: state.current });
    }
  }

  function pointerEnd(event: PointerEvent) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.deleteTimer) window.clearTimeout(state.deleteTimer);
    drag.current = null;
    if (state.intent === "lift") {
      const rect = stripRef.current?.getBoundingClientRect();
      const inside = rect && pointInRect(
        { x: event.clientX, y: event.clientY },
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      );
      if (!inside) onDrop(state.item, { x: event.clientX, y: event.clientY });
    }
    setLifted(null);
  }

  const stripRect = stripRef.current?.getBoundingClientRect();
  const scale = stripRect ? stripRect.width / STRIP_WIDTH : 1;
  const floatingPoint = lifted && stripRect ? {
    x: (lifted.point.x - stripRect.left) / scale,
    y: (lifted.point.y - stripRect.top) / scale
  } : null;

  return <div class={open ? "sticker-strip is-open" : "sticker-strip"} ref={stripRef}>
    <div class="sticker-strip-window">
      <div class="sticker-strip-content" style={{ transform: `translateX(${scrollX}px)` }}>
        <button class="sticker-import-cell" type="button" aria-label="Import custom sticker" onClick={() => importRef.current?.click()}>
          {importing ? <span class="strip-spinner">…</span> : <span>＋</span>}
        </button>
        <button class="sticker-emoji-cell" type="button" aria-label="Choose emoji" onClick={() => { setEmojiOpen((value) => !value); window.setTimeout(() => emojiRef.current?.focus(), 0); }}>😀</button>
        {stickers.map((item, index) => {
          const source = store.stickerUrl(item);
          return <span class="sticker-strip-item" style={{ transform: `rotate(${index % 2 ? -3 : 2.5}deg)` }} key={item.id}>
            {source && <img src={source} alt="" draggable={false} />}
            <button
              class="sticker-drag-target"
              type="button"
              aria-label={item.builtIn ? `Place ${item.builtIn}` : "Place custom sticker"}
              onPointerDown={(event) => pointerDown(item, event)}
              onPointerMove={pointerMove}
              onPointerUp={pointerEnd}
              onPointerCancel={pointerEnd}
              onContextMenu={(event) => event.preventDefault()}
            />
            {markedId === item.id && !item.builtIn && <button class="custom-sticker-delete" type="button" aria-label="Delete custom sticker" onClick={() => { setMarkedId(null); void store.removeCustomSticker(item.id); }}>×</button>}
          </span>;
        })}
      </div>
    </div>
    {emojiOpen && <div class="emoji-picker">
      <div>{QUICK_EMOJI.map((emoji) => <button type="button" onClick={() => chooseEmoji(emoji)} key={emoji}>{emoji}</button>)}</div>
      <input ref={emojiRef} aria-label="Type one emoji" placeholder="輸入一個 emoji" onInput={(event) => chooseEmoji(event.currentTarget.value)} />
    </div>}
    <input ref={importRef} class="scrapbook-file-input" type="file" accept="image/png,image/webp,image/jpeg" onChange={(event) => void importSticker(event.currentTarget.files?.[0])} />
    {lifted && floatingPoint && (() => {
      const source = store.stickerUrl(lifted.item);
      const size = stickerBaseSize(lifted.item);
      return source && <img class="lifted-sticker" src={source} alt="" style={{ left: `${floatingPoint.x - size.x / 2}px`, top: `${floatingPoint.y - size.y / 2}px`, width: `${size.x}px`, height: `${size.y}px` }} />;
    })()}
  </div>;
}
