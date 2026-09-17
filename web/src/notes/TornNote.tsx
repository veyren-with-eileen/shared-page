import { useLayoutEffect, useRef } from "preact/hooks";
import type { CalendarNote } from "../domain/calendar";
import { NOTE_BODY_MAX_LENGTH } from "../domain/noteWrite";
import { DISPLAY_NAME } from "../theme/identity";
import { NOTE_TEXT_MAX_HEIGHT, noteTextHeight } from "./noteLayout";
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
}

export function TornNote({ note, index, linkedTitle, active, dragging, offsetY, onText, onDelete, onDoubleTap, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onFocusRequest }: TornNoteProps) {
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

  return <article
    class={`torn-note author-${note.author} ${active || dragging ? "is-lifted" : ""}`}
    style={{ transform: `translateY(${offsetY}px) rotate(${active || dragging ? 0 : index % 2 ? 1.6 : -2.2}deg)` }}
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
          aria-label="Note text"
          onFocus={onFocusRequest}
          onInput={(event) => {
            resizeTextarea(event.currentTarget);
            onText(event.currentTarget.value);
          }}
        />
      : <p>{note.body || " "}</p>}
    {linkedTitle && <em>↳ {linkedTitle}</em>}
    {note.liked && <span class="note-heart" aria-label="Liked">♡</span>}
    {active && note.author === "kitty" && <button class="note-delete" type="button" aria-label="Delete note" onClick={(event) => { event.stopPropagation(); onDelete(); }}>✕</button>}
  </article>;
}
