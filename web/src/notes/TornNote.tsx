import type { CalendarNote } from "../domain/calendar";
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
}

export function TornNote({ note, index, linkedTitle, active, dragging, offsetY, onText, onDelete, onDoubleTap, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: TornNoteProps) {
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
    <small>{note.author === "master" ? "ASSISTANT" : note.author === "kitty" ? "USER" : "AUTO"} · {note.timestamp}</small>
    {active && note.author === "kitty"
      ? <textarea autoFocus value={note.body} maxLength={40} aria-label="Note text" onInput={(event) => onText(event.currentTarget.value)} />
      : <p>{note.body || " "}</p>}
    {linkedTitle && <em>↳ {linkedTitle}</em>}
    {note.liked && <span class="note-heart" aria-label="Liked">♡</span>}
    {active && note.author === "kitty" && <button class="note-delete" type="button" aria-label="Delete note" onClick={(event) => { event.stopPropagation(); onDelete(); }}>✕</button>}
  </article>;
}
