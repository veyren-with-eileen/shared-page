import { useState } from "preact/hooks";
import {
  clearSessionConnection,
  loadConnection,
  saveSessionConnection,
  type ConnectionConfig
} from "../config/connection";
import { currentProductMonth } from "../domain/calendarTime";
import { MonthPage } from "../month/MonthPage";
import { ConnectionSetup } from "./ConnectionSetup";
import "./app.css";

export function App() {
  const [connection, setConnection] = useState<ConnectionConfig>(loadConnection);
  const [editingConnection, setEditingConnection] = useState(!connection.token);
  const [month, setMonth] = useState(currentProductMonth);

  if (editingConnection) {
    return (
      <ConnectionSetup
        initial={connection}
        onConnect={(next) => {
          setConnection(saveSessionConnection(next));
          setEditingConnection(false);
        }}
      />
    );
  }

  return (
    <div class="app-shell">
      <MonthPage config={connection} month={month} onMonthChange={setMonth} />
      <button
        class="connection-link"
        type="button"
        onClick={() => {
          clearSessionConnection();
          setEditingConnection(true);
        }}
      >
        connection
      </button>
    </div>
  );
}
