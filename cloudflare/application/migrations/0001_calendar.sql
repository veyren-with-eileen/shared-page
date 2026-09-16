PRAGMA foreign_keys = ON;

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  precision TEXT NOT NULL DEFAULT 'hour',
  event_type TEXT,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_message_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSON,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_calendar_events_span ON calendar_events(status, starts_at, ends_at);
CREATE INDEX idx_calendar_events_source_message ON calendar_events(source_message_id);

CREATE TABLE calendar_event_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event_revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  source TEXT NOT NULL,
  snapshot JSON NOT NULL,
  notify_master INTEGER NOT NULL DEFAULT 0,
  mutation_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calendar_changes_event ON calendar_event_changes(event_id, id DESC);
CREATE INDEX idx_calendar_changes_notify ON calendar_event_changes(notify_master, id);
CREATE UNIQUE INDEX idx_calendar_changes_mutation
  ON calendar_event_changes(mutation_key) WHERE mutation_key IS NOT NULL;

CREATE TABLE calendar_change_receipts (
  change_id INTEGER NOT NULL,
  consumer TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unseen',
  seen_at TEXT,
  channel TEXT,
  PRIMARY KEY (change_id, consumer),
  FOREIGN KEY (change_id) REFERENCES calendar_event_changes(id) ON DELETE CASCADE
);
CREATE INDEX idx_calendar_receipts_unseen
  ON calendar_change_receipts(consumer, state, change_id);

CREATE TABLE calendar_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  anchor_date TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  y REAL,
  liked INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE SET NULL
);
CREATE INDEX idx_calendar_comments_event ON calendar_comments(event_id, created_at);
CREATE INDEX idx_calendar_comments_date ON calendar_comments(anchor_date, deleted_at);

CREATE TABLE calendar_consumer_state (
  consumer TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_now_signature TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (consumer, conversation_id)
);
