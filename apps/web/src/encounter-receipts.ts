import type { CambrianConfig } from "@cambrian/config";
import type { EncounterTransactionReceipt } from "@cambrian/sdk";

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const keyFor = (config: CambrianConfig, address: string) => `cambrian:pending-encounter:v1:${config.rpcUrl}:${config.programId}:${address}`;

/** Only public reconciliation fields. Never persist intents, wallet auth or signed bytes. */
export function savePendingEncounter(storage: ReceiptStorage, config: CambrianConfig, address: string, receipt: EncounterTransactionReceipt) {
  if (receipt.walletAddress !== address || receipt.programId !== config.programId || !receipt.signature) return;
  storage.setItem(keyFor(config, address), JSON.stringify({
    stage: receipt.stage, signature: receipt.signature, walletAddress: address, programId: config.programId,
    actorAddress: receipt.actorAddress, donorAddress: receipt.donorAddress,
    catalyst: receipt.catalyst.toString(), baselineEncounterCount: receipt.baselineEncounterCount.toString(), reviewedGenome: receipt.reviewedGenome,
  }));
}

export function loadPendingEncounter(storage: ReceiptStorage, config: CambrianConfig, address: string): EncounterTransactionReceipt | null {
  try {
    const raw = storage.getItem(keyFor(config, address));
    if (!raw || raw.length > 2_000) return null;
    const value = JSON.parse(raw);
    if (!["submitted", "confirmed"].includes(value.stage) || value.walletAddress !== address || value.programId !== config.programId
      || typeof value.signature !== "string" || !/^ts[A-Za-z0-9_-]{88}$/.test(value.signature)
      || ![value.actorAddress, value.donorAddress].every(item => typeof item === "string" && /^ta[A-Za-z0-9_-]{44}$/.test(item))
      || value.actorAddress === value.donorAddress || typeof value.reviewedGenome !== "string" || !/^[a-f0-9]{64}$/.test(value.reviewedGenome)) return null;
    const u64 = (item: unknown): bigint => {
      if (typeof item !== "string" || !/^\d{1,20}$/.test(item)) throw new Error("Invalid Encounter receipt");
      const parsed = BigInt(item);
      if (parsed > 0xffff_ffff_ffff_ffffn) throw new Error("Invalid Encounter integer");
      return parsed;
    };
    return { stage: value.stage, signature: value.signature, walletAddress: address, programId: config.programId,
      actorAddress: value.actorAddress, donorAddress: value.donorAddress, catalyst: u64(value.catalyst),
      baselineEncounterCount: u64(value.baselineEncounterCount), reviewedGenome: value.reviewedGenome };
  } catch { return null; }
}

export function clearPendingEncounter(storage: ReceiptStorage, config: CambrianConfig, address: string) {
  storage.removeItem(keyFor(config, address));
}
