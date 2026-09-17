import type { AppRoute } from "./navigation";

export function showsConnectionControl(routeKind: AppRoute["kind"]): boolean {
  return routeKind === "month";
}
