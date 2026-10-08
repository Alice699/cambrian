import { createContext, useContext, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import type { Route } from "../navigation";
import { ConnectedAccountSummary, OfficialWalletControl } from "./WalletControl";

type DashboardRoute = Exclude<Route, "landing">;

const pageCopy: Record<DashboardRoute, { label: string; title: string; description?: string }> = {
  dashboard: { label: "OVERVIEW / CAMBRIAN LIFEFORM", title: "Your ecosystem" },
  organisms: {
    label: "ORGANISMS / COLLECTION", title: "The living collection",
    description: "Track the organisms you have brought to life and the state they carry across the Thru Betanet.",
  },
  activity: {
    label: "ACTIVITY / ON-CHAIN TRAIL", title: "A clear chain of events",
    description: "Every account transaction is read from Thru Betanet and kept visible without inventing confirmation states.",
  },
  learn: {
    label: "LEARN / CAMBRIAN BASICS", title: "Start with the living parts",
    description: "A short field guide to wallets, the Betanet faucet, and the actions that shape an organism.",
  },
};

export const DashboardPageActionsContext = createContext<HTMLDivElement | null>(null);

/** Route-owned actions can change without replacing the shared wallet control. */
export function DashboardPageActions({ children }: { children: ReactNode }) {
  const target = useContext(DashboardPageActionsContext);
  return target ? createPortal(children, target) : null;
}

export function DashboardHeader({ route, balanceRefreshKey, actionsRef }: {
  route: DashboardRoute; balanceRefreshKey: number; actionsRef: Ref<HTMLDivElement>;
}) {
  const copy = pageCopy[route];
  return <>
    <header className="dashboard-app-header" id={route === "dashboard" ? "overview" : undefined}>
      <div className="dashboard-app-heading">
        <p className="page-label">{copy.label}</p>
        <h1>{copy.title}</h1>
        {copy.description && <p className="dashboard-app-description">{copy.description}</p>}
      </div>
      <div className="dashboard-app-controls" id="account-controls">
        <div className="dashboard-page-actions" ref={actionsRef} />
        <OfficialWalletControl refreshKey={balanceRefreshKey} scopeKey={route} />
      </div>
    </header>
    <ConnectedAccountSummary />
  </>;
}
