import { useMemo, useState } from "preact/hooks";
import type { EventDTO, EventDraft } from "../domain/calendar";
import { authorFromWire } from "../domain/calendarDTO";
import { draftForNewEvent, draftFromEvent, eventWritePayload } from "../domain/eventWrite";
import { parseDayKey } from "../domain/calendarTime";
import "./eventEditor.css";

interface EventEditorProps {
  dateKey: string;
  editing: EventDTO | null;
  onClose(): void;
  onSave(draft: EventDraft): void;
  onDelete?(): void;
}

function editorTitle(date: string): string {
  const parts = parseDayKey(date);
  return parts ? `${parts.month}月${parts.day}日` : date;
}

export function EventEditor({ dateKey, editing, onClose, onSave, onDelete }: EventEditorProps) {
  const initial = useMemo(() => editing ? draftFromEvent(editing) : draftForNewEvent(dateKey), [editing?.id, dateKey]);
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [validation, setValidation] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const author = editing ? authorFromWire(editing.createdBy) : "kitty";

  function patch(value: Partial<EventDraft>) {
    setDraft((current) => ({ ...current, ...value }));
    setValidation(null);
  }

  function submit(event: Event) {
    event.preventDefault();
    try {
      eventWritePayload(draft);
      onSave(draft);
    } catch (error) {
      setValidation(error instanceof Error ? error.message : "Please check this plan.");
    }
  }

  return (
    <div class="event-editor-backdrop" role="presentation" onClick={onClose}>
      <section
        class={`event-editor-sheet author-${author}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-editor-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="editor-handle" aria-hidden="true" />
        <form onSubmit={submit}>
          <header class="editor-heading-row">
            <div>
              <strong id="event-editor-heading">{editorTitle(draft.date)}</strong>
              <span>{editing ? "edit" : "new plan"}</span>
            </div>
            {editing && onDelete && (
              <button
                class={confirmDelete ? "editor-delete is-confirming" : "editor-delete"}
                type="button"
                onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}
              >
                {confirmDelete ? "confirm" : "delete"}
              </button>
            )}
          </header>

          <label class="editor-title-field">
            <span class="sr-only">Title</span>
            <input
              autoFocus={!editing}
              value={draft.title}
              placeholder="what's new"
              maxLength={160}
              onInput={(event) => patch({ title: event.currentTarget.value })}
            />
          </label>

          <div class="editor-date-row">
            <label>
              <span>日期</span>
              <input type="date" value={draft.date} onInput={(event) => patch({ date: event.currentTarget.value })} />
            </label>
          </div>

          <div class="editor-all-day-row">
            <span>全天</span>
            <label class="pink-toggle">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(event) => patch({ allDay: event.currentTarget.checked })}
              />
              <i aria-hidden="true" />
              <span class="sr-only">All day</span>
            </label>
          </div>

          <div class={draft.allDay ? "editor-time-row is-disabled" : "editor-time-row"}>
            <label>
              <span>從</span>
              <input
                type="time"
                value={draft.startTime}
                disabled={draft.allDay}
                onInput={(event) => patch({ startTime: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>到</span>
              <input
                type="time"
                value={draft.endTime}
                disabled={draft.allDay}
                onInput={(event) => patch({ endTime: event.currentTarget.value })}
              />
            </label>
          </div>

          <div class="editor-bottom">
            {validation && <p role="alert">{validation}</p>}
            <button class="editor-save" type="submit" disabled={!draft.title.trim()}>save</button>
          </div>
        </form>
      </section>
    </div>
  );
}
