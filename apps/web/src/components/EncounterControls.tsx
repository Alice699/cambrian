import { useState } from "react";
import { bytesToHex, encounterEligibility, type CambrianOrganismRecord, type PreparedEncounterIntent, type EncounterTransactionReceipt } from "@cambrian/sdk";
import { appConfig } from "../config";
import { navigateInternal } from "../navigation";
import { AddressDisplay } from "./AddressDisplay";
import { UiIcon } from "./UiIcon";
import "../encounter.css";

const outcomeName = { symbiosis: "Symbiosis", adaptation: "Adaptation", stress: "Stress" };
const amount = (value: bigint) => value.toLocaleString("en-US");

export function EncounterControls({ organism, organisms, account, prepared, busy, reviewing, pending, blocked = false, onReview, onApprove, onCancel }: {
  organism: CambrianOrganismRecord; organisms: CambrianOrganismRecord[]; account: string;
  prepared: PreparedEncounterIntent | null; busy: boolean; reviewing: boolean; pending: boolean; blocked?: boolean;
  onReview: (actor: string, donor: string) => void; onApprove: () => void; onCancel: () => void;
}) {
  const [partnerAddress, setPartnerAddress] = useState("");
  const partners = organisms.filter(item => item.address !== organism.address);
  const partner = partners.find(item => item.address === partnerAddress) ?? partners[0];
  const eligibility = partner ? encounterEligibility(organism, partner, appConfig, account) : null;
  const quote = prepared?.actor.address === organism.address && prepared.donor.address === partner?.address ? prepared : null;
  const locked = busy || pending || blocked;
  return <section className={`encounter-panel${quote ? " has-review" : ""}`} aria-labelledby="encounter-title">
    <div className="encounter-heading">
      <span className="encounter-emblem" aria-hidden="true"><UiIcon name="organism" /></span>
      <div><p className="panel-label">ON-CHAIN INTERACTION</p><h2 id="encounter-title">Let two genomes meet.</h2><p>Learn from another organism in your collection. Review the pair before approving an Encounter.</p></div>
      <span className="encounter-scope"><UiIcon name="shield" />Same wallet</span>
    </div>
    {!partner ? <div className="encounter-empty">
      <div><strong>A pair starts with two organisms.</strong><p>Create another organism in this wallet to try Encounter. Existing records stay unchanged.</p></div>
      <a href="/app" onClick={event => navigateInternal("/app", event)}><UiIcon name="organism" />Open Overview</a>
    </div> : <>
      <div className="encounter-pair">
        <div className="encounter-member"><span className="encounter-role">01 / SELECTED ORGANISM</span><AddressDisplay value={organism.address} label="Will change" compact /><p>Energy, genome and Encounter count may update.</p></div>
        <div className="encounter-member"><label className="encounter-role" htmlFor="encounter-partner">02 / PARTNER GENOME</label>
          <select id="encounter-partner" value={partner.address} disabled={locked} onChange={event => { onCancel(); setPartnerAddress(event.target.value); }} aria-describedby="encounter-partner-policy">
            {partners.map(item => <option key={item.address} value={item.address}>{item.address.slice(0, 10)}…{item.address.slice(-6)} · {item.state.status === 3 ? "Dead" : item.state.status === 2 ? "Dormant" : "Alive"}</option>)}
          </select><p id="encounter-partner-policy">Read-only. This action does not change the partner.</p>
        </div>
      </div>
      {quote ? <div className={`encounter-review is-${quote.preview.outcome}`} aria-label="Review Encounter">
        <div className="encounter-review-heading"><div><span className="encounter-role">LIVE STATE PREVIEW</span><h3>{outcomeName[quote.preview.outcome]}</h3></div><span className="encounter-compatibility"><strong>{quote.preview.compatibility}</strong> / 256 matching bits</span></div>
        <div className="encounter-preview-grid">
          <div><span>Energy now</span><strong>{amount(quote.preview.energyBefore)}</strong></div>
          <div><span>Expected Energy</span><strong>{amount(quote.preview.energyAfter)}</strong><small className={quote.preview.energyDelta < 0n ? "is-risk" : "is-positive"}>{quote.preview.energyDelta > 0n ? "+" : ""}{amount(quote.preview.energyDelta)} Energy</small></div>
          <div><span>Next Encounter count</span><strong>{amount(quote.actor.state.encounterCount + 1n)}</strong><small>Generation stays unchanged</small></div>
        </div>
        <div className="encounter-review-note"><UiIcon name={quote.preview.outcome === "stress" ? "alert" : "shield"} /><p>{quote.preview.geneCopyPossible
          ? "One genome bit may be copied from the partner. It may already match, so the appearance can stay the same."
          : "These genomes are less compatible. This Encounter reduces Energy and does not copy a genome bit."}
          {quote.preview.statusAfter === 2 && " The selected organism will be dormant at the previewed Energy."}
          {quote.preview.statusAfter === 3 && " Its zero Vitality means the program will mark it dead."}</p></div>
        <p className="encounter-quote-caveat">Preview uses the two states read just now. Both are checked again before approval and submission; the final on-chain receipt determines the result.</p>
        <div className="encounter-review-actions"><button className="encounter-approve" type="button" onClick={onApprove} disabled={locked}><UiIcon name="wallet" />{busy ? "Follow Thru Wallet" : "Approve in Thru Wallet"}</button><button className="encounter-cancel" type="button" onClick={onCancel} disabled={locked}>Back to pair</button></div>
      </div> : <div className="encounter-action-row">
        <p role="status">{blocked ? "Finish or check the existing Pulse before starting Encounter." : pending ? "An existing Encounter is still settling. Check its receipt below; no repeat transaction will be sent."
          : reviewing ? "Reading both organisms. No approval or transaction has been requested." : eligibility?.reason}</p>
        <button className="encounter-review-button" type="button" onClick={() => onReview(organism.address, partner.address)} disabled={locked || !eligibility?.allowed}><UiIcon name="activity" />{reviewing ? "Reading pair…" : "Review Encounter"}</button>
      </div>}
    </>}
    <div className="encounter-boundary"><span><UiIcon name="wallet" />Every Encounter needs your wallet approval.</span><span>Energy is not THRU. Encounter does not reset the Pulse window.</span></div>
  </section>;
}

export function EncounterResult({ receipt }: { receipt: EncounterTransactionReceipt | null }) {
  if (!receipt?.organism || !receipt.event) return null;
  const event = receipt.event;
  const outcome = event.outcome === 1 ? "symbiosis" : event.outcome === 2 ? "adaptation" : "stress";
  const delta = event.energyAfter - event.energyBefore;
  const metrics = receipt.metrics;
  return <section className={`encounter-result is-${outcome}`} aria-label="Verified Encounter result">
    <div className="encounter-result-heading"><div><p className="panel-label">VERIFIED TRANSACTION RESULT</p><h2>{outcomeName[outcome]} recorded.</h2><p>These values come from this transaction's event. The viewer shows the latest readable organism state.</p></div><span className="feedback-badge is-success"><UiIcon name="check" />Confirmed</span></div>
    <div className="encounter-preview-grid">
      <div><span>Energy after this action</span><strong>{amount(event.energyAfter)}</strong><small>{delta > 0n ? "+" : ""}{amount(delta)} from {amount(event.energyBefore)}</small></div>
      <div><span>Genome compatibility</span><strong>{event.compatibility} <small>/ 256</small></strong><small>{event.geneTransferred ? "One bit copied; a visible change is not guaranteed" : "No genome bit copied"}</small></div>
      <div><span>Encounter count at execution</span><strong>{amount(event.encounterCount)}</strong><small>{bytesToHex(event.genome) === receipt.reviewedGenome ? "Genome matches the reviewed snapshot" : "Genome differs from the reviewed snapshot"}</small></div>
    </div>
    <div className="encounter-result-addresses"><AddressDisplay value={receipt.actorAddress} label="Updated organism" compact /><AddressDisplay value={receipt.donorAddress} label="Read-only partner" compact /></div>
    {metrics && <div className="encounter-resources"><h3>Transaction resources</h3><p>Actual receipt totals, including wallet authentication. These are not a throughput benchmark.</p>
      <dl><div><dt>Network fee</dt><dd>{amount(metrics.fee)} THRU</dd></div><div><dt>Compute units</dt><dd>{metrics.computeUnits?.toLocaleString("en-US") ?? "Unavailable"}</dd></div><div><dt>Memory units</dt><dd>{metrics.memoryUnits?.toLocaleString("en-US") ?? "Unavailable"}</dd></div><div><dt>New storage units</dt><dd>{metrics.stateUnits?.toLocaleString("en-US") ?? "Unavailable"}</dd></div></dl>
      <AddressDisplay value={metrics.feePayer} label="Fee payer" compact />
    </div>}
  </section>;
}
