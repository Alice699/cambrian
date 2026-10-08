import type { MouseEvent } from "react";
import { flushSync } from "react-dom";

export type Route = "landing" | "dashboard" | "organisms" | "activity" | "learn";

export function routeFromPath(path: string): Route {
  if (path === "/app/organisms") return "organisms";
  if (path === "/app/activity") return "activity";
  if (path === "/app/learn") return "learn";
  return path === "/app" || path.startsWith("/app/") ? "dashboard" : "landing";
}

type TransitionDocument = Document & {
  activeViewTransition?: { skipTransition: () => void } | null;
};

let routeTransition: ViewTransition | null = null;
let routeTransitionScope: object | null = null;

export function cancelRouteTransition() {
  const transition = routeTransition ?? (document as TransitionDocument).activeViewTransition;
  transition?.skipTransition();
  routeTransition = null;
  routeTransitionScope = null;
}

export function navigateInternal(path: string, event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();

  const from = routeFromPath(window.location.pathname);
  const to = routeFromPath(path);
  const updateRoute = () => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  cancelRouteTransition();

  // Never carry a dashboard snapshot (including its wallet) onto the landing page.
  if (from === "landing" || to === "landing" || !document.startViewTransition) {
    updateRoute();
    return;
  }

  const scope = {};
  routeTransitionScope = scope;
  const transition = document.startViewTransition(() => {
    // A skipped transition still calls its update callback. Ignore stale routes.
    if (routeTransitionScope !== scope) return;
    // The browser must capture the destination DOM, not a batched React update.
    flushSync(updateRoute);
  });
  routeTransition = transition;
  // Interrupted transitions may reject ready; navigation itself still completes.
  void transition.ready.catch(() => {});
  const clear = () => {
    if (routeTransition === transition) routeTransition = null;
    if (routeTransitionScope === scope) routeTransitionScope = null;
  };
  void transition.finished.then(clear, clear);
}
