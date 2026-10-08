import { summarizeAccountActivity, type CambrianTransactionSummary } from "@cambrian/sdk";
import { AddressDisplay } from "./AddressDisplay";
import { TransactionStatusBadge, explorerLink } from "./TransactionFeedback";
import { UiIcon } from "./UiIcon";

export function ActivityCounters({ transactions, status }: {
  transactions: CambrianTransactionSummary[];
  status: "idle" | "loading" | "ready" | "empty" | "needs-wallet" | "error";
}) {
  const counts = summarizeAccountActivity(transactions);
  const readable = status === "ready" || status === "empty";
  const loading = status === "idle" || status === "loading";
  const cards = [
    { label: "Cambrian actions", value: readable && !counts.incompleteConfirmedDetails ? counts.confirmedCambrianActions.toString() : "—",
      description: counts.incompleteConfirmedDetails ? "Some details are unavailable" : "Confirmed in recent activity" },
    { label: "Wallet transactions", value: readable ? counts.walletTransactions.toString() : "—", description: "All recent account records" },
  ];
  return <>{cards.map(card => <article className="stat-card is-activity" key={card.label}>
    <p>{card.label}</p>
    {loading ? <span className="skeleton stat-skeleton" aria-label={`Loading ${card.label.toLowerCase()}`} /> : <strong>{card.value}</strong>}
    <small>{card.description}</small>
  </article>)}</>;
}

function TransactionDetails({ transaction }: { transaction: CambrianTransactionSummary }) {
  return <>
    <strong>{transaction.activity.label}</strong>
    <p className="activity-description">{transaction.activity.description}</p>
    <div className="activity-record-meta">
      {transaction.signature ? <AddressDisplay value={transaction.signature} kind="tx" compact /> : <span>Signature unavailable</span>}
      <small>{transaction.slot !== null ? "Slot " + transaction.slot.toString() : "Slot pending"}</small>
    </div>
  </>;
}

export function RecentTransactions({ transactions }: { transactions: CambrianTransactionSummary[] }) {
  return <>{transactions.slice(0, 3).map((transaction, index) => <div className="activity-row" key={transaction.signature || transaction.program + "-" + index}>
    <div><TransactionDetails transaction={transaction} /></div>
    <TransactionStatusBadge status={transaction.status} vmError={transaction.vmError} />
  </div>)}</>;
}

export function ActivityTimeline({ transactions }: { transactions: CambrianTransactionSummary[] }) {
  return <div className="activity-timeline">{transactions.map((transaction, index) => <div className="timeline-item" key={transaction.signature || transaction.program + "-" + index}>
    <span className="activity-type-icon" aria-hidden="true"><UiIcon name={transaction.activity.category === "cambrian" ? "organism" : transaction.activity.category === "wallet" ? "wallet" : "activity"} /></span>
    <div className="timeline-copy"><TransactionDetails transaction={transaction} /></div>
    <div className="timeline-actions">
      <TransactionStatusBadge status={transaction.status} vmError={transaction.vmError} />
      <a className="activity-explorer-link" href={transaction.signature ? explorerLink("tx", transaction.signature) : explorerLink("address", transaction.program)} target="_blank" rel="noreferrer"><UiIcon name="external" />Open explorer</a>
    </div>
  </div>)}</div>;
}

export function ActivityPagination({ page, count, pageSize, hasNext, busy, onPrevious, onNext }: {
  page: number; count: number; pageSize: number; hasNext: boolean; busy: boolean;
  onPrevious: () => void; onNext: () => void;
}) {
  return <nav className="activity-pagination" aria-label="Activity pagination">
    <div className="activity-pagination-info"><strong>{count} {count === 1 ? "transaction" : "transactions"} on this page</strong><span>{pageSize} per page{!hasNext ? " · End of history" : ""}</span></div>
    <div className="activity-pagination-controls">
      <button type="button" onClick={onPrevious} disabled={busy || page <= 1} aria-label="Previous activity page">Previous</button>
      <span className="activity-page-number" aria-current="page">Page {page}</span>
      <button type="button" onClick={onNext} disabled={busy || !hasNext} aria-label="Next activity page">Next</button>
    </div>
  </nav>;
}
