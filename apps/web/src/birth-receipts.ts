import type { BirthTransactionResult } from "@cambrian/sdk";

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const keyFor = (program: string, address: string) => `cambrian:pending-wallet-birth:v1:${program}:${address}`;

/** Public receipt only. No signature key, passkey proof, or signed transaction is stored. */
export function savePendingBirth(storage: ReceiptStorage, program: string, address: string, receipt: BirthTransactionResult) {
  if (!receipt.signature || receipt.prepared.intent.walletAddress !== address || receipt.prepared.intent.programAddress !== program) return;
  const { prepared } = receipt;
  storage.setItem(keyFor(program, address), JSON.stringify({
    stage: receipt.stage, signature: receipt.signature,
    prepared: { ...prepared, seed: Array.from(prepared.seed), entropy: Array.from(prepared.entropy), proof: Array.from(prepared.proof) },
  }));
}

export function loadPendingBirth(storage: ReceiptStorage, program: string, address: string): BirthTransactionResult | null {
  try {
    const value = storage.getItem(keyFor(program, address));
    if (!value || value.length > 100_000) return null;
    const parsed = JSON.parse(value);
    if (!["submitted", "confirmed"].includes(parsed.stage) || typeof parsed.signature !== "string"
      || parsed.prepared?.intent?.walletAddress !== address || parsed.prepared?.intent?.programAddress !== program
      || parsed.prepared?.intent?.review?.instruction !== "wallet_birth" || typeof parsed.prepared.organismAddress !== "string") return null;
    const bytes = (items: unknown, length?: number) => {
      if (!Array.isArray(items) || (length !== undefined && items.length !== length) || items.length > 16_384
        || items.some(item => !Number.isInteger(item) || item < 0 || item > 255)) throw new Error("Invalid cached receipt");
      return Uint8Array.from(items);
    };
    return { stage: parsed.stage, signature: parsed.signature, prepared: {
      ...parsed.prepared, seed: bytes(parsed.prepared.seed, 32), entropy: bytes(parsed.prepared.entropy, 32), proof: bytes(parsed.prepared.proof),
    } };
  } catch { return null; }
}

export function clearPendingBirth(storage: ReceiptStorage, program: string, address: string) {
  storage.removeItem(keyFor(program, address));
}
