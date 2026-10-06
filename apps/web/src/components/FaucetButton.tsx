import { faucetButtonPresentation, type FaucetStage } from "../presentation-model";
import { StatusIcon } from "./TransactionFeedback";
import { UiIcon } from "./UiIcon";

export function FaucetButton({ stage, pending, connected, onClick }: {
  stage: FaucetStage; pending: boolean; connected: boolean; onClick: () => void;
}) {
  const state = faucetButtonPresentation(stage, pending, connected);
  return <button className={`faucet-button is-${state.tone}`} type="button" onClick={onClick} disabled={!connected || state.busy} aria-busy={state.busy} title={state.description}>
    <span className="faucet-button-icon">{state.busy ? <StatusIcon tone="pending" spinning /> : <UiIcon name={pending ? "retry" : "faucet"} />}</span>
    <span className="faucet-button-copy"><strong>{state.label}</strong><small>{state.hint}</small></span>
    {!state.busy && <UiIcon name="arrow" className="faucet-button-arrow" />}
  </button>;
}
