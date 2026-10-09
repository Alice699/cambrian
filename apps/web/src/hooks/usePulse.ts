import { useEffect, useRef, useState } from "react";
import { useThru, useWallet } from "@thru/wallet/react";
import { confirmPulseTransaction, executePulseTransaction, PulseExecutionError, type PulseTransactionReceipt, type PulseTransactionUpdate } from "@cambrian/sdk";
import { appConfig } from "../config";
import { activeThruAddress } from "../transaction-model";
import { clearPendingPulse, loadPendingPulse, savePendingPulse } from "../pulse-receipts";

/** The owning Organisms page is keyed by wallet, so no state crosses accounts. */
export function usePulse(onRefresh: () => void) {
  const { thru } = useThru();
  const { wallet, isConnected, selectedAccount } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  const [receipt, setReceipt] = useState<PulseTransactionReceipt | null>(() => {
    try { return address ? loadPendingPulse(sessionStorage, appConfig, address) : null; } catch { return null; }
  });
  const [update, setUpdate] = useState<PulseTransactionUpdate | null>(() => receipt ? { stage: receipt.stage === "confirmed" ? "syncing" : "submitted", receipt, signature: receipt.signature } : null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const receiptRef = useRef(receipt);
  const controllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllerRef.current?.abort(); }; }, []);
  const pending = Boolean(receipt && !receipt.organism);

  const run = async (organismAddress: string) => {
    if (busyRef.current || !mounted.current) return;
    if (!address || !wallet || !thru) {
      const error = new Error("Connect Thru Wallet before approving Pulse.");
      setUpdate({ stage: "failed", error }); setNotice(error.message); return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const publish = (next: PulseTransactionUpdate) => {
      // Save the public receipt even if the page changed during submission.
      if (next.receipt && next.stage !== "failed") {
        receiptRef.current = next.receipt;
        try { savePendingPulse(sessionStorage, appConfig, address, next.receipt); } catch { /* Best effort; no signing data. */ }
      }
      if (next.stage === "failed" && next.error instanceof PulseExecutionError) {
        receiptRef.current = null;
        try { clearPendingPulse(sessionStorage, appConfig, address); } catch { /* Public data only. */ }
      }
      if (controller.signal.aborted || !mounted.current) return;
      setUpdate(next);
      setReceipt(receiptRef.current);
    };
    try {
      const existing = receiptRef.current;
      let result: PulseTransactionReceipt;
      if (existing && !existing.organism) {
        publish({ stage: existing.stage === "confirmed" ? "syncing" : "submitted", receipt: existing, signature: existing.signature });
        result = await confirmPulseTransaction(thru, appConfig, existing, { signal: controller.signal, onUpdate: publish });
      } else {
        receiptRef.current = null;
        setReceipt(null);
        publish({ stage: "preparing" });
        const context = await wallet.getSigningContext();
        controller.signal.throwIfAborted();
        if (context.selectedAccountPublicKey !== address) throw new Error("The selected wallet changed. Refresh before approving Pulse.");
        const random = crypto.getRandomValues(new Uint8Array(8));
        result = await executePulseTransaction(thru, appConfig, wallet, {
          walletAddress: address, organismAddress, catalyst: new DataView(random.buffer).getBigUint64(0, true), signal: controller.signal, onUpdate: publish,
        });
      }
      if (controller.signal.aborted || !mounted.current) return;
      receiptRef.current = result;
      setReceipt(result);
      onRefresh();
      if (result.organism) {
        try { clearPendingPulse(sessionStorage, appConfig, address); } catch { /* Public data only. */ }
        setNotice("Pulse confirmed. Energy, vitality and Pulse count now reflect the verified on-chain state.");
      } else {
        setNotice(result.stage === "confirmed" ? "Pulse is confirmed. Waiting for the updated organism state; Check status will only read it again."
          : "Pulse is awaiting confirmation. Use Check status instead of sending another transaction.");
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Pulse could not be completed.");
      publish({ stage: "failed", receipt: receiptRef.current ?? undefined, signature: error instanceof PulseExecutionError ? error.signature : receiptRef.current?.signature, error });
      if (controller.signal.aborted || !mounted.current) return;
      setNotice(error.message);
      if (error instanceof PulseExecutionError) onRefresh();
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted && mounted.current) setBusy(false);
    }
  };

  return { run, update, receipt, pending, busy, notice, dismissNotice: () => setNotice(null) };
}
