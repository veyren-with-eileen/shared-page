import { useLayoutEffect, useRef } from "preact/hooks";
import type { CalendarNote } from "../domain/calendar";
import { NOTE_BODY_MAX_LENGTH } from "../domain/noteWrite";
import { DISPLAY_NAME } from "../theme/identity";
import { NOTE_TEXT_MAX_HEIGHT, noteBottomPadding, noteTextHeight } from "./noteLayout";
import "./notes.css";

interface TornNoteProps {
  note: CalendarNote;
  index: number;
  linkedTitle?: string;
  active: boolean;
  dragging: boolean;
  offsetY: number;
  onText(body: string): void;
  onDelete(): void;
  onDoubleTap(): void;
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;
  onPointerCancel(event: PointerEvent): void;
  onFocusRequest(): void;
  onFocusChange(focused: boolean): void;
}

export function TornNote({ note, index, linkedTitle, active, dragging, offsetY, onText, onDelete, onDoubleTap, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onFocusRequest, onFocusChange }: TornNoteProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resizeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = "0px";
    textarea.style.height = `${noteTextHeight(textarea.scrollHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > NOTE_TEXT_MAX_HEIGHT ? "auto" : "hidden";
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (active && textarea) {
      resizeTextarea(textarea);
      onFocusRequest();
    }
  }, [active, note.body]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!active || !textarea) return;
    textarea.focus({ preventScroll: true });
    onFocusRequest();
  }, [active]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!active || !textarea) return;
    const resizeForEnvironment = () => {
      resizeTextarea(textarea);
      onFocusRequest();
    };
    const fonts = document.fonts;
    let disposed = false;
    void fonts?.ready.then(() => {
      if (!disposed) resizeForEnvironment();
    });
    fonts?.addEventListener?.("loadingdone", resizeForEnvironment);
    window.addEventListener("resize", resizeForEnvironment);
    return () => {
      disposed = true;
      fonts?.removeEventListener?.("loadingdone", resizeForEnvironment);
      window.removeEventListener("resize", resizeForEnvironment);
    };
  }, [active]);

  return <article
    class={`torn-note author-${note.author} ${linkedTitle ? "has-linked-event" : ""} ${active || dragging ? "is-lifted" : ""}`}
    style={{
      transform: `translateY(${offsetY}px) rotate(${active || dragging ? 0 : index % 2 ? 1.6 : -2.2}deg)`,
      "--note-bottom-padding": `${noteBottomPadding(Boolean(linkedTitle))}px`
    }}
    onClick={(event) => { if (note.author === "master" && event.detail === 2) onDoubleTap(); }}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerCancel}
  >
    <span class="note-tape" aria-hidden="true" />
    <small>{DISPLAY_NAME[note.author]} · {note.timestamp}</small>
    {active && note.author === "kitty"
      ? <textarea
          ref={textareaRef}
          value={note.body}
          maxLength={NOTE_BODY_MAX_LENGTH}
          rows={1}
          aria-label="Note text"
          onFocus={() => { onFocusChange(true); onFocusRequest(); }}
          onBlur={() => onFocusChange(false)}
          onInput={(event) => {
            resizeTextarea(event.currentTarget);
            onText(event.currentTarget.value);
            onFocusRequest();
          }}
        />
      : <p>{note.body || " "}</p>}
    {linkedTitle && <em>↳ {linkedTitle}</em>}
    {note.liked && <span class="note-heart" aria-label="Liked">♡</span>}
    {active && note.author === "kitty" && <button class="note-delete" type="button" aria-label="Delete note" onClick={(event) => { event.stopPropagation(); onDelete(); }}>✕</button>}
  </article>;
}
