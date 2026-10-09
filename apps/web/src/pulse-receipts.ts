import type { CambrianConfig } from "@cambrian/config";
import type { PulseTransactionReceipt } from "@cambrian/sdk";

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const keyFor = (config: CambrianConfig, address: string) => `cambrian:pending-pulse:v1:${config.rpcUrl}:${config.programId}:${address}`;

/** Explicit allowlist: no intent, raw transaction, passkey or signing material. */
export function savePendingPulse(storage: ReceiptStorage, config: CambrianConfig, address: string, receipt: PulseTransactionReceipt) {
  if (receipt.walletAddress !== address || receipt.programId !== config.programId || !receipt.signature) return;
  storage.setItem(keyFor(config, address), JSON.stringify({
    stage: receipt.stage, signature: receipt.signature, walletAddress: address, programId: config.programId,
    organismAddress: receipt.organismAddress, baselinePulseCount: receipt.baselinePulseCount.toString(), lastPulseSlot: receipt.lastPulseSlot.toString(),
  }));
}

export function loadPendingPulse(storage: ReceiptStorage, config: CambrianConfig, address: string): PulseTransactionReceipt | null {
  try {
    const raw = storage.getItem(keyFor(config, address));
    if (!raw || raw.length > 2_000) return null;
    const value = JSON.parse(raw);
    if (!["submitted", "confirmed"].includes(value.stage) || value.walletAddress !== address || value.programId !== config.programId
      || typeof value.signature !== "string" || !/^ts[A-Za-z0-9_-]{88}$/.test(value.signature)
      || typeof value.organismAddress !== "string" || !/^ta[A-Za-z0-9_-]{44}$/.test(value.organismAddress)) return null;
    const u64 = (item: unknown): bigint => {
      if (typeof item !== "string" || !/^\d{1,20}$/.test(item)) throw new Error("Invalid Pulse receipt");
      const parsed = BigInt(item);
      if (parsed > 0xffff_ffff_ffff_ffffn) throw new Error("Invalid Pulse counter");
      return parsed;
    };
    return { stage: value.stage, signature: value.signature, walletAddress: address, programId: config.programId,
      organismAddress: value.organismAddress, baselinePulseCount: u64(value.baselinePulseCount), lastPulseSlot: u64(value.lastPulseSlot) };
  } catch { return null; }
}

export function clearPendingPulse(storage: ReceiptStorage, config: CambrianConfig, address: string) {
  storage.removeItem(keyFor(config, address));
}
