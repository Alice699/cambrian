import type { BirthTransactionUpdate, CambrianTransactionSummary } from "@cambrian/sdk";
import { birthPresentation, type FeedbackTone } from "../transaction-model";
import { AddressDisplay } from "./AddressDisplay";
import { UiIcon, type UiIconName } from "./UiIcon";
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

const BIRTH_STEPS: { label: string; icon: UiIconName; completed: string }[] = [
  { label: "Wallet approval", icon: "wallet", completed: "Approved in Thru Wallet" },
  { label: "Submit", icon: "broadcast", completed: "Sent to Thru Betanet" },
  { label: "Confirm", icon: "shield", completed: "Confirmed on-chain" },
  { label: "Read organism", icon: "organism", completed: "Organism verified and ready" },
];

const BIRTH_CURRENT_COPY: Record<BirthTransactionUpdate["stage"], string> = {
  connecting: "Connecting your wallet",
  preparing: "Preparing your request",
  "awaiting-approval": "Waiting for your approval",
  signed: "Ready to submit",
  submitting: "Sending to the network",
  submitted: "Awaiting network confirmation",
  syncing: "Verifying organism state",
  confirmed: "All stages complete",
  failed: "Not completed",
};

export function BirthStatus({ update, account, onCheck, busy = false }: {
  update: BirthTransactionUpdate | null; account: string | null; onCheck?: () => void; busy?: boolean;
}) {
  if (!update) return null;
  const state = birthPresentation(update.stage, Boolean(update.signature));
  return <section className={`birth-progress is-${state.tone}`} data-stage={update.stage} aria-label="Birth transaction progress">
    <div className="birth-progress-heading" role={state.tone === "error" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
      <StatusIcon tone={state.tone} spinning={state.tone === "pending"} />
      <div className="birth-progress-copy"><p>THRU WALLET / BIRTH</p><h2>{state.title}</h2><span>{update.error?.message ?? state.description}</span></div>
      <div className="birth-progress-summary"><span className={`feedback-badge is-${state.tone}`}><UiIcon name={state.tone === "success" ? "check" : state.tone === "error" ? "alert" : "activity"} />{state.label}</span><span className="birth-network"><i aria-hidden="true" />Thru Betanet</span></div>
    </div>
    <div className="birth-progress-body">
      <div className="birth-progress-overview"><span>Transaction progress</span><div role="progressbar" aria-label="Completed transaction steps" aria-valuemin={0} aria-valuemax={4} aria-valuenow={state.step} aria-valuetext={`${state.step} of 4 steps complete`}><strong>{state.step}</strong> of 4 steps complete</div></div>
      <ol className="birth-progress-steps" aria-label="Transaction steps">
        {BIRTH_STEPS.map((step, index) => {
          const complete = index < state.step;
          const current = index === state.step;
          const failed = current && state.tone === "error";
          return <li key={step.label} className={complete ? "is-complete" : current ? `is-current${failed ? " is-error" : ""}` : "is-waiting"} aria-current={current ? "step" : undefined}>
            <span className="step-node" aria-hidden="true"><UiIcon name={complete ? "check" : failed ? "alert" : step.icon} /></span>
            <span className="step-copy"><strong><span className="step-ordinal">0{index + 1}</span>{step.label}</strong><small>{complete ? step.completed : current ? BIRTH_CURRENT_COPY[update.stage] : "Waiting for previous step"}</small></span>
          </li>;
        })}
      </ol>
    </div>
    <div className="birth-progress-footer">
      {account ? <AddressDisplay value={account} label="Account" /> : <span>Your wallet approves every transaction</span>}
      <div className="birth-progress-links">
        {update.signature && <a href={explorerLink("tx", update.signature)} target="_blank" rel="noreferrer"><UiIcon name="activity" />View transaction</a>}
        {update.organism && <a className="birth-progress-primary" href={explorerLink("address", update.organism.address)} target="_blank" rel="noreferrer"><UiIcon name="organism" />View organism</a>}
        {onCheck && state.tone === "pending" && ["submitted", "syncing"].includes(update.stage) && <button className="birth-progress-primary" type="button" onClick={onCheck} disabled={busy}><UiIcon name="activity" />{busy ? "Checking…" : "Check status"}</button>}
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
