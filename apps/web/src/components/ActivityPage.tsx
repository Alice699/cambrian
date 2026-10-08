import { useEffect, useRef } from "react";
import { useWallet } from "@thru/wallet/react";
import { activeThruAddress } from "../transaction-model";
import { useActivityPagination } from "../hooks/useActivityPagination";
import { ActivityPagination, ActivityTimeline } from "./AccountActivity";
import { DashboardPageActions } from "./DashboardHeader";
import { ReadStateCard } from "./ReadStateCard";
import { StatusIcon } from "./TransactionFeedback";
import { ConnectWalletAction } from "./WalletControl";
import { UiIcon } from "./UiIcon";

export function ActivityPage() {
  const { isConnected, selectedAccount } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  return <AccountHistory key={address ?? "disconnected"} address={address} />;
}

function AccountHistory({ address }: { address: string | null }) {
  const history = useActivityPagination(address);
  const card = useRef<HTMLElement | null>(null);
  const previousPage = useRef(1);
  useEffect(() => {
    if (history.page === previousPage.current) return;
    previousPage.current = history.page;
    card.current?.scrollIntoView?.({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [history.page]);
  const hasPage = history.status === "ready" || history.status === "empty";
  const disconnected = history.status === "needs-wallet";
  const loading = history.status === "loading" || history.status === "idle";
  return <>
    <DashboardPageActions><span className="connected-badge"><i /> {address ? "BETANET HISTORY" : "RPC READ"}</span></DashboardPageActions>
    <section ref={card} className="activity-page-card" aria-labelledby="history-title">
      <div className="activity-card-heading">
        <div><p className="panel-label">WALLET ACTIVITY</p><h2 id="history-title">Your transaction history</h2><p className="activity-scope-note">Wallet setup, transfers, and Cambrian actions — each with its own on-chain receipt.</p></div>
        {address && <button className="activity-refresh" type="button" onClick={history.refresh} disabled={history.busy}><UiIcon name="retry" />Refresh</button>}
      </div>
      <div className={`activity-history-body ${history.busy && hasPage ? "is-updating" : ""}`} aria-busy={history.busy && !disconnected}>
        {history.transactions.length > 0 ? <ActivityTimeline transactions={history.transactions} /> : <ReadStateCard
          title={disconnected ? "Your history starts here" : loading ? "Loading your activity" : history.status === "error" ? "Couldn't load activity" : history.page > 1 ? "No records on this page" : "No transactions yet"}
          description={disconnected ? "Connect Thru Wallet to see this account's transaction history." : loading ? "Reading confirmed receipts and pending transactions from Thru Betanet." : history.status === "error" ? history.error ?? "Retry this read when you're ready." : history.page > 1 ? "Go back to the previous page or refresh your history." : "Wallet setup, transfers, and organism actions will appear here once indexed."}
          tone={history.status === "error" ? "error" : "neutral"} loading={loading}
          onRetry={history.status === "error" ? history.retry : undefined} icon={disconnected ? "wallet" : "activity"}
          action={disconnected ? <ConnectWalletAction /> : history.status === "empty" ? <button className="state-action is-secondary" type="button" onClick={history.refresh} disabled={history.busy}><UiIcon name="retry" />Refresh activity</button> : undefined}
        />}
      </div>
      {history.error && hasPage && <div className="activity-page-error" role="alert"><UiIcon name="alert" /><div><strong>Couldn't load page {history.requestedPage}</strong><p>{history.error} Your current page is unchanged.</p></div><button type="button" onClick={history.retry} disabled={history.busy}>Retry page</button></div>}
      <div className="activity-load-status" role="status" aria-live="polite" aria-atomic="true">
        {history.busy && hasPage ? <><StatusIcon tone="pending" spinning /><span>Loading page {history.requestedPage}…</span></> : hasPage ? <span className="sr-only">Page {history.page}. {history.transactions.length} transactions shown.</span> : null}
      </div>
      {hasPage && <ActivityPagination page={history.page} count={history.transactions.length} pageSize={history.pageSize} hasNext={history.hasNext} busy={history.busy} onPrevious={history.previous} onNext={history.next} />}
    </section>
    <section className="trail-callout"><span>ON-CHAIN TRANSPARENCY</span><p>Every record links to Thru's explorer. Pending and failed transactions remain visible alongside confirmed activity.</p><a href="https://scan.thru.org/" target="_blank" rel="noreferrer">Open Thru explorer</a></section>
  </>;
}
