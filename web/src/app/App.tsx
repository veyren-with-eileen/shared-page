import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createCalendarGateway, uploadCalendarPage } from "../api/calendarAPI";
import {
  clearSessionConnection,
  loadConnection,
  saveSessionConnection,
  type ConnectionConfig
} from "../config/connection";
import { monthKey } from "../domain/calendarTime";
import { DayPage } from "../day/DayPage";
import { MonthPage } from "../month/MonthPage";
import { CalendarStore } from "../state/calendarStore";
import { IndexedDbScrapbookRepository } from "../persistence/scrapbookRepository";
import { ScrapbookStore } from "../state/scrapbookStore";
import { PageSync } from "../snapshot/pageSync";
import { renderCalendarPage } from "../snapshot/renderPage";
import { ConnectionSetup } from "./ConnectionSetup";
import { showsConnectionControl } from "./appPresentation";
import {
  dayRouteUrl,
  monthRouteUrl,
  routeFromUrl,
  type AppRoute
} from "./navigation";
import { installAppPinchGuard } from "./pinchGuard";
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
  const appSurfaceRef = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<ConnectionConfig>(loadConnection);
  const [editingConnection, setEditingConnection] = useState(!connection.token);
  const [route, setRoute] = useState<AppRoute>(() => routeFromUrl(new URL(window.location.href)));
  const services = useMemo(() => {
    let calendar!: CalendarStore;
    let scrapbook!: ScrapbookStore;
    const pageSync = new PageSync(
      (day) => renderCalendarPage(calendar, scrapbook, day),
      (day, png) => uploadCalendarPage(connection, day, png)
    );
    calendar = new CalendarStore(createCalendarGateway(connection), pageSync);
    scrapbook = new ScrapbookStore(new IndexedDbScrapbookRepository(), pageSync);
    return { calendar, scrapbook, pageSync };
  }, [connection.apiBaseUrl, connection.token]);
  const { calendar, scrapbook, pageSync } = services;

  useEffect(() => {
    pageSync.attachLifecycle();
    return () => { pageSync.dispose(); calendar.dispose(); };
  }, [calendar, pageSync]);
  useEffect(() => {
    void scrapbook.hydrate();
    return () => scrapbook.dispose();
  }, [scrapbook]);

  useEffect(() => {
    const state = currentNavigationState();
    if (!state.sharedPage) {
      window.history.replaceState({ sharedPage: true, index: 0 }, "", window.location.href);
    }

    const restore = () => setRoute((current) => {
      const next = routeFromUrl(new URL(window.location.href));
      if (current.kind === "day" && next.kind === "month") void pageSync.flush();
      return next;
    });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [pageSync]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "is-calendar-route",
      !editingConnection
    );
    return () => document.documentElement.classList.remove("is-calendar-route");
  }, [editingConnection]);

  useEffect(() => {
    const surface = appSurfaceRef.current;
    if (!surface) return;
    return installAppPinchGuard(surface);
  }, [editingConnection]);

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
    void pageSync.flush();
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
    <div ref={appSurfaceRef} class={`app-shell is-${route.kind}`}>
      {route.kind === "month" ? (
        <div class="month-viewport-stage">
          <MonthPage
            store={calendar}
            scrapbook={scrapbook}
            month={route.month}
            onMonthChange={(month) =>
              pushRoute({ kind: "month", month }, monthRouteUrl(month))
            }
            onDayOpen={openDay}
          />
        </div>
      ) : (
        <div class="day-viewport-stage">
          <DayPage
            store={calendar}
            scrapbook={scrapbook}
            dateKey={route.dayKey}
            onBack={backToMonth}
            onDayChange={changeDay}
          />
        </div>
      )}
      {showsConnectionControl(route.kind) && (
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
      )}
    </div>
  );
}
