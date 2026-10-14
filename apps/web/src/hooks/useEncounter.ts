import { useEffect, useRef, useState } from "react";
import { useThru, useWallet } from "@thru/wallet/react";
import { prepareEncounterIntent, executeEncounterTransaction, confirmEncounterTransaction, EncounterExecutionError,
  type PreparedEncounterIntent, type EncounterTransactionReceipt, type EncounterTransactionUpdate } from "@cambrian/sdk";
import { appConfig } from "../config";
import { activeThruAddress } from "../transaction-model";
import { clearPendingEncounter, loadPendingEncounter, savePendingEncounter } from "../encounter-receipts";

/** Owned by the wallet-keyed Organisms page. Navigation cancels all signing follow-ups. */
export function useEncounter(onRefresh: () => void) {
  const { thru } = useThru();
  const { wallet, isConnected, selectedAccount } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  const [receipt, setReceipt] = useState<EncounterTransactionReceipt | null>(() => {
    try { return address ? loadPendingEncounter(sessionStorage, appConfig, address) : null; } catch { return null; }
  });
  const [prepared, setPrepared] = useState<PreparedEncounterIntent | null>(null);
  const [update, setUpdate] = useState<EncounterTransactionUpdate | null>(() => receipt
    ? { stage: receipt.stage === "confirmed" ? "syncing" : "submitted", receipt, signature: receipt.signature } : null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const receiptRef = useRef(receipt);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pending = Boolean(receipt && (!receipt.organism || !receipt.event));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllerRef.current?.abort(); }; }, []);

  const review = async (actorAddress: string, donorAddress: string) => {
    if (busyRef.current || pending || !mounted.current) return;
    if (!address || !thru) { setNotice("Connect Thru Wallet before reviewing Encounter."); return; }
    busyRef.current = true;
    setBusy(true); setReviewing(true); setNotice(null); setPrepared(null); setUpdate(null);
    receiptRef.current = null; setReceipt(null);
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      const random = crypto.getRandomValues(new Uint8Array(8));
      const result = await prepareEncounterIntent(thru, appConfig, { walletAddress: address, actorAddress, donorAddress,
        catalyst: new DataView(random.buffer).getBigUint64(0, true), signal: controller.signal });
      if (!controller.signal.aborted && mounted.current) setPrepared(result);
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return;
      const error = cause instanceof Error ? cause : new Error("The pair could not be verified. Nothing was submitted.");
      setUpdate({ stage: "failed", error }); setNotice(error.message);
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted && mounted.current) { setBusy(false); setReviewing(false); }
    }
  };

  const run = async () => {
    if (busyRef.current || !mounted.current) return;
    if (!address || !wallet || !thru) return;
    if (!receiptRef.current && !prepared) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    const controller = new AbortController(); controllerRef.current = controller;
    const publish = (next: EncounterTransactionUpdate) => {
      if (next.receipt && next.stage !== "failed") {
        receiptRef.current = next.receipt;
        try { savePendingEncounter(sessionStorage, appConfig, address, next.receipt); } catch { /* Public receipt only. */ }
      }
      if (next.stage === "failed" && next.error instanceof EncounterExecutionError) {
        receiptRef.current = null;
        try { clearPendingEncounter(sessionStorage, appConfig, address); } catch { /* Public receipt only. */ }
      }
      if (controller.signal.aborted || !mounted.current) return;
      setUpdate(next); setReceipt(receiptRef.current);
    };
    try {
      const existing = receiptRef.current;
      let result: EncounterTransactionReceipt;
      if (existing && (!existing.organism || !existing.event)) {
        publish({ stage: existing.stage === "confirmed" ? "syncing" : "submitted", receipt: existing, signature: existing.signature });
        result = await confirmEncounterTransaction(thru, appConfig, existing, { signal: controller.signal, onUpdate: publish });
      } else {
        if (!prepared) return;
        receiptRef.current = null; setReceipt(null);
        publish({ stage: "preparing" });
        const context = await wallet.getSigningContext();
        controller.signal.throwIfAborted();
        if (context.selectedAccountPublicKey !== address) throw new Error("The selected wallet changed. Review the pair again.");
        result = await executeEncounterTransaction(thru, appConfig, wallet, {
          walletAddress: address, actorAddress: prepared.actor.address, donorAddress: prepared.donor.address,
          catalyst: prepared.catalyst, reviewed: prepared, signal: controller.signal, onUpdate: publish,
        });
      }
      if (controller.signal.aborted || !mounted.current) return;
      receiptRef.current = result; setReceipt(result); setPrepared(null); onRefresh();
      if (result.organism && result.event) {
        try { clearPendingEncounter(sessionStorage, appConfig, address); } catch { /* Public receipt only. */ }
        setNotice("Encounter confirmed. Its event, updated Encounter count and current organism state have been verified on-chain.");
      } else {
        setNotice("Encounter is still being verified. Check status reads the same receipt; it will not send another transaction.");
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Encounter could not be completed.");
      publish({ stage: "failed", receipt: receiptRef.current ?? undefined,
        signature: error instanceof EncounterExecutionError ? error.signature : receiptRef.current?.signature, error });
      if (controller.signal.aborted || !mounted.current) return;
      setPrepared(null); setNotice(error.message);
      if (error instanceof EncounterExecutionError) onRefresh();
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted && mounted.current) setBusy(false);
    }
  };

  const cancelReview = () => {
    if (busyRef.current || pending) return;
    setPrepared(null); setUpdate(null); setNotice(null);
  };
  return { review, run, cancelReview, prepared, update, receipt, pending, busy, reviewing, notice, dismissNotice: () => setNotice(null) };
}
