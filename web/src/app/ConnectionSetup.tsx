import { useState } from "preact/hooks";
import type { ConnectionConfig } from "../config/connection";

interface ConnectionSetupProps {
  initial: ConnectionConfig;
  onConnect(config: ConnectionConfig): void;
}

export function ConnectionSetup({ initial, onConnect }: ConnectionSetupProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(initial.apiBaseUrl);
  const [token, setToken] = useState(initial.token);

  return (
    <main class="connection-screen">
      <form
        class="connection-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!token.trim()) return;
          onConnect({
            apiBaseUrl,
            token,
            productTimeZone: initial.productTimeZone
          });
        }}
      >
        <p class="connection-kicker">shared-page</p>
        <h1>Connect the calendar</h1>
        <p>
          The PWA reads the existing REST calendar. Connection values stay in this browser tab and are
          not committed to Git.
        </p>

        <label>
          API base URL
          <input
            value={apiBaseUrl}
            onInput={(event) => setApiBaseUrl(event.currentTarget.value)}
            placeholder="/api/v1/calendar"
            autocomplete="url"
          />
        </label>

        <label>
          X-Calendar-Token
          <input
            value={token}
            onInput={(event) => setToken(event.currentTarget.value)}
            type="password"
            autocomplete="off"
          />
        </label>

        <button type="submit" disabled={!token.trim()}>
          Open month
        </button>
      </form>
    </main>
  );
}
