import { useEffect, useState } from "preact/hooks";
import {
  clearSessionConnection,
  loadConnection,
  saveSessionConnection,
  type ConnectionConfig
} from "../config/connection";
import { monthKey } from "../domain/calendarTime";
import { DayPage } from "../day/DayPage";
import { MonthPage } from "../month/MonthPage";
import { ConnectionSetup } from "./ConnectionSetup";
import {
  dayRouteUrl,
  monthRouteUrl,
  routeFromUrl,
  type AppRoute
} from "./navigation";
import "./app.css";

interface NavigationState {
  sharedPage?: true;
  index?: number;
  monthIndex?: number;
}

function currentNavigationState(): NavigationState {
  return (window.history.state ?? {}) as NavigationState;
}

export function App() {
  const [connection, setConnection] = useState<ConnectionConfig>(loadConnection);
  const [editingConnection, setEditingConnection] = useState(!connection.token);
  const [route, setRoute] = useState<AppRoute>(() => routeFromUrl(new URL(window.location.href)));

  useEffect(() => {
    const state = currentNavigationState();
    if (!state.sharedPage) {
      window.history.replaceState({ sharedPage: true, index: 0 }, "", window.location.href);
    }

    const restore = () => setRoute(routeFromUrl(new URL(window.location.href)));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function pushRoute(next: AppRoute, url: string, monthIndex?: number) {
    const current = currentNavigationState();
    const index = (current.index ?? 0) + 1;
    window.history.pushState({ sharedPage: true, index, monthIndex }, "", url);
    setRoute(next);
  }

  function openDay(day: string) {
    const next = routeFromUrl(new URL(dayRouteUrl(day), window.location.origin));
    const sourceIndex = currentNavigationState().index ?? 0;
    pushRoute(next, dayRouteUrl(day), sourceIndex);
  }

  function changeDay(day: string) {
    const next = routeFromUrl(new URL(dayRouteUrl(day), window.location.origin));
    const state = currentNavigationState();
    pushRoute(next, dayRouteUrl(day), state.monthIndex);
  }

  function backToMonth() {
    const state = currentNavigationState();
    if (
      typeof state.monthIndex === "number" &&
      typeof state.index === "number" &&
      state.monthIndex < state.index
    ) {
      window.history.go(state.monthIndex - state.index);
      return;
    }

    const month = route.month;
    const next: AppRoute = { kind: "month", month };
    window.history.replaceState(
      { sharedPage: true, index: state.index ?? 0 },
      "",
      monthRouteUrl(month)
    );
    setRoute(next);
  }

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
      {route.kind === "month" ? (
        <MonthPage
          config={connection}
          month={route.month}
          onMonthChange={(month) =>
            pushRoute({ kind: "month", month }, monthRouteUrl(month))
          }
          onDayOpen={openDay}
        />
      ) : (
        <DayPage
          config={connection}
          dateKey={route.dayKey}
          onBack={backToMonth}
          onDayChange={changeDay}
        />
      )}
      <button
        class="connection-link"
        type="button"
        onClick={() => {
          clearSessionConnection();
          setEditingConnection(true);
        }}
      >
        connection · {monthKey(route.month)}
      </button>
    </div>
  );
}
