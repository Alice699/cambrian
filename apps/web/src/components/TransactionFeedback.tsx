import type { BirthTransactionUpdate, CambrianTransactionSummary } from "@cambrian/sdk";
import { birthPresentation, type FeedbackTone } from "../transaction-model";
import { AddressDisplay } from "./AddressDisplay";
import { explorerLink } from "../explorer";
export { explorerLink } from "../explorer";

export function StatusIcon({ tone, spinning = false }: { tone: FeedbackTone; spinning?: boolean }) {
  return <span className={`status-icon is-${tone} ${spinning ? "is-spinning" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {tone === "success" ? <path d="m6 12 4 4 8-8" /> : tone === "error" ? <><path d="m8 8 8 8m0-8-8 8" /></> : <><circle cx="12" cy="12" r="8" opacity=".25" /><path d="M12 4a8 8 0 0 1 8 8" /></>}
    </svg>
  </span>;
}

export function TransactionStatusBadge({ status, vmError }: {
  status: CambrianTransactionSummary["status"]; vmError: number | null;
}) {
  const tone: FeedbackTone = status === "confirmed" ? "success" : status === "failed" ? "error" : "pending";
  const label = status === "confirmed" ? "Confirmed" : status === "failed" ? "Failed" : status === "pending" ? "Unverified" : "Status unavailable";
  return <span className={`feedback-badge transaction-status is-${tone}`} title={status === "failed" && vmError !== null ? `VM error ${vmError}` : label}>{label}</span>;
}

export function FaucetStatus({ tone, description, onCheck, busy = false }: {
  tone: FeedbackTone; description: string; onCheck?: () => void; busy?: boolean;
}) {
  return <section className={`faucet-feedback is-${tone}`} aria-label="Faucet claim status">
    <StatusIcon tone={tone} spinning={tone === "pending" && busy} />
    <div role={tone === "error" ? "alert" : "status"} aria-live="polite"><strong>{tone === "success" ? "Test THRU confirmed" : tone === "error" ? "Faucet request failed" : "Faucet claim in progress"}</strong><p>{description}</p></div>
    {tone === "pending" && onCheck && <button type="button" onClick={onCheck} disabled={busy}>{busy ? "Checking…" : "Check balance"}</button>}
  </section>;
}

export function BirthStatus({ update, account, onCheck, busy = false }: {
  update: BirthTransactionUpdate | null; account: string | null; onCheck?: () => void; busy?: boolean;
}) {
  if (!update) return null;
  const state = birthPresentation(update.stage, Boolean(update.signature));
  return <section className={`birth-progress is-${state.tone}`} aria-label="Birth transaction progress">
    <div className="birth-progress-heading" role={state.tone === "error" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
      <StatusIcon tone={state.tone} spinning={state.tone === "pending"} />
      <div className="birth-progress-copy"><p>THRU WALLET / BIRTH</p><h2>{state.title}</h2><span>{update.error?.message ?? state.description}</span></div>
      <span className={`feedback-badge is-${state.tone}`}>{state.label}</span>
    </div>
    <ol className="birth-progress-steps" aria-label="Transaction steps">
      {["Wallet approval", "Submit", "Confirm", "Read organism"].map((label, index) => {
        const complete = index < state.step;
        const current = index === state.step;
        return <li key={label} className={complete ? "is-complete" : current ? `is-current ${state.tone === "error" ? "is-error" : ""}` : ""} aria-current={current ? "step" : undefined}>
          <span className="step-node" aria-hidden="true">{complete ? <svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8" /></svg> : current && state.tone === "error" ? "×" : index + 1}</span>
          <span>{label}<small>{complete ? "Complete" : current ? state.tone === "error" ? "Not completed" : "In progress" : "Waiting"}</small></span>
        </li>;
      })}
    </ol>
    <div className="birth-progress-footer">
      {account ? <AddressDisplay value={account} label="Account" compact /> : <span>Your wallet approves every transaction</span>}
      <div className="birth-progress-links">
        {update.signature && <a href={explorerLink("tx", update.signature)} target="_blank" rel="noreferrer">View transaction ↗</a>}
        {update.organism && <a href={explorerLink("address", update.organism.address)} target="_blank" rel="noreferrer">View organism ↗</a>}
        {onCheck && state.tone === "pending" && ["submitted", "syncing"].includes(update.stage) && <button type="button" onClick={onCheck} disabled={busy}>{busy ? "Checking…" : "Check status"}</button>}
      </div>
    </div>
  </section>;
}

export function TransactionNotice({ tone, message, onDismiss }: { tone: FeedbackTone; message: string; onDismiss?: () => void }) {
  return <div className={`notice is-${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} aria-atomic="true">
    <StatusIcon tone={tone} spinning={tone === "pending"} />
    <div><strong>{tone === "success" ? "Confirmed" : tone === "error" ? "Action failed" : "In progress"}</strong><span>{message}</span></div>
    <button type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>
  </div>;
}
