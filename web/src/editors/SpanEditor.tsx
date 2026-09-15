import { useMemo, useState } from "preact/hooks";
import type { CalendarMonth, CalendarSpan, SpanDraft } from "../domain/calendar";
import { daysInMonth } from "../domain/calendarTime";
import { normalizeSpanDraft } from "../domain/spanWrite";
import "./spanEditor.css";

interface SpanEditorProps {
  month: CalendarMonth;
  start: number;
  end: number;
  editing?: CalendarSpan;
  deleteTitle?: string;
  deleteConfirm?: string;
  onClose(): void;
  onSave(draft: SpanDraft): void;
  onDelete?(): void;
}

export function SpanEditor({
  month, start, end, editing, deleteTitle = "delete", deleteConfirm = "confirm",
  onClose, onSave, onDelete
}: SpanEditorProps) {
  const initial = useMemo(() => normalizeSpanDraft({
    title: editing?.title ?? "", month, startDay: start, endDay: end
  }), [editing?.id, month.year, month.month, start, end]);
  const [draft, setDraft] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const normalized = normalizeSpanDraft(draft);
  const count = normalized.endDay - normalized.startDay + 1;
  const days = Array.from({ length: daysInMonth(month) }, (_, index) => index + 1);

  function submit(event: Event) {
    event.preventDefault();
    if (!normalized.title) return;
    onSave(normalized);
  }

  return (
    <div class="span-editor-backdrop" role="presentation" onClick={onClose}>
      <section class={`span-editor-sheet ${editing ? "is-editing" : "is-new"} author-${editing?.author ?? "kitty"}`} role="dialog" aria-modal="true" aria-labelledby="span-editor-heading" onClick={(event) => event.stopPropagation()}>
        <div class="editor-handle" aria-hidden="true" />
        <form onSubmit={submit}>
          <header class="span-heading-row">
            <div><strong id="span-editor-heading">{month.month}月{normalized.startDay}日 – {normalized.endDay}日</strong><span>{editing ? "edit" : "these days"}</span></div>
            {editing && onDelete && <button class={confirmDelete ? "editor-delete is-confirming" : "editor-delete"} type="button" onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>{confirmDelete ? deleteConfirm : deleteTitle}</button>}
          </header>

          <label class="span-title-field"><span class="sr-only">Title</span><input autoFocus={!editing} value={draft.title} placeholder="what's on" maxLength={160} onInput={(event) => setDraft((value) => ({ ...value, title: event.currentTarget.value }))} /></label>

          {editing && <div class="span-range-row">
            <span>從</span>
            <label><span class="sr-only">Start day</span><select value={draft.startDay} onChange={(event) => setDraft((value) => ({ ...value, startDay: Number(event.currentTarget.value) }))}>{days.map((day) => <option value={day} key={day}>{day}</option>)}</select></label>
            <span>日 到</span>
            <label><span class="sr-only">End day</span><select value={draft.endDay} onChange={(event) => setDraft((value) => ({ ...value, endDay: Number(event.currentTarget.value) }))}>{days.map((day) => <option value={day} key={day}>{day}</option>)}</select></label>
            <span>日</span><i>共 {count} 天</i>
          </div>}

          <div class="span-editor-bottom"><button class="editor-save" type="submit" disabled={!normalized.title}>save</button></div>
        </form>
      </section>
    </div>
  );
}
