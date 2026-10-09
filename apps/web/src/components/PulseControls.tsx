import { useEffect, useState } from "react";
import { useThru } from "@thru/wallet/react";
import { readPulseEligibility, CAMBRIAN_MAX_PULSE_ELAPSED, type CambrianOrganismRecord } from "@cambrian/sdk";
import { appConfig } from "../config";
import { navigateInternal } from "../navigation";
import { UiIcon } from "./UiIcon";

type EligibilityRead = { status: "loading" | "ready" | "error"; allowed: boolean; reason: string; expired?: boolean };

export function PulseControls({ organism, account, busy, pending, refreshKey, onPulse }: {
  organism: CambrianOrganismRecord; account: string; busy: boolean; pending: boolean; refreshKey: number; onPulse: () => void;
}) {
  const { thru } = useThru();
  const [readKey, setReadKey] = useState(0);
  const [read, setRead] = useState<EligibilityRead>({ status: "loading", allowed: false, reason: "Checking the current state and network slot…" });
  useEffect(() => {
    if (busy || pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setRead({ status: "loading", allowed: false, reason: "Checking the current state and network slot…" });
    const check = async () => {
      try {
        if (!thru) throw new Error("Thru is still initializing. Refresh eligibility in a moment.");
        const result = await readPulseEligibility(thru, appConfig, account, organism.address, controller.signal);
        if (controller.signal.aborted) return;
        setRead({ status: "ready", allowed: result.allowed, reason: result.reason, expired: result.elapsed !== null && result.elapsed > CAMBRIAN_MAX_PULSE_ELAPSED });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setRead({ status: "error", allowed: false, reason: cause instanceof Error ? cause.message : "Eligibility could not be verified. No transaction was sent." });
      }
      if (!controller.signal.aborted) timer = setTimeout(check, 10_000);
    };
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [thru, account, organism.address, busy, pending, refreshKey, readKey]);

  const reason = busy ? "Follow the transaction steps below. Approval happens only inside Thru Wallet."
    : pending ? "An existing Pulse is still settling. Check its status; a second transaction will not be sent."
    : read.reason;
  const label = busy ? "Pulse in progress" : pending ? "Check Pulse status" : "Pulse organism";
  return <section className="pulse-card" aria-labelledby="pulse-title">
    <div className="pulse-card-icon"><UiIcon name="pulse" /></div>
    <div className="pulse-card-copy"><p className="panel-label">ON-CHAIN ACTION</p><h2 id="pulse-title">Every Pulse changes its story.</h2><p>Advance this organism's state with your wallet's approval. Energy and vitality can decrease; mutation is not guaranteed.</p>
      <div className={`pulse-eligibility ${read.status === "error" && !busy && !pending ? "is-error" : ""}`} role="status" aria-live="polite"><i className={!busy && !pending && read.allowed ? "is-ready" : ""} />{reason}</div>
    </div>
    <div className="pulse-card-actions">
      <button className="pulse-submit" type="button" onClick={onPulse} disabled={busy || (!pending && (read.status !== "ready" || !read.allowed))}><UiIcon name={pending ? "activity" : "pulse"} />{label}</button>
      <button className="pulse-refresh" type="button" onClick={() => setReadKey(key => key + 1)} disabled={busy || pending || read.status === "loading"}><UiIcon name="retry" />{read.status === "loading" && !busy && !pending ? "Checking eligibility…" : "Refresh eligibility"}</button>
      {!busy && !pending && read.expired && <a className="pulse-birth-link" href="/app" onClick={event => navigateInternal("/app", event)}><UiIcon name="organism" />Create a new organism</a>}
      <small>No automatic signing or retries</small>
    </div>
  </section>;
}
