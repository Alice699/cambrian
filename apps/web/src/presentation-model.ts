export type FaucetStage = "idle" | "preparing" | "requesting" | "confirming";

export function shortPublicAddress(value: string, prefix = 8, suffix = 6): string {
  return value.length > prefix + suffix + 3 ? `${value.slice(0, prefix)}…${value.slice(-suffix)}` : value;
}

export function faucetButtonPresentation(stage: FaucetStage, pending: boolean, connected: boolean) {
  const busy = stage !== "idle";
  if (busy) return {
    busy, tone: "pending", label: stage === "confirming" ? "Checking balance" : stage === "preparing" ? "Preparing claim" : "Requesting THRU",
    hint: "Please wait · no repeat claim", description: "The faucet workflow is still in progress. Please wait.",
  } as const;
  if (pending) return { busy, tone: "pending", label: "Check balance", hint: "Read-only · no new claim", description: "Check your existing claim without requesting funds again." } as const;
  return { busy, tone: "idle", label: "Get test THRU", hint: connected ? "Betanet faucet" : "Connect a wallet first", description: connected ? "Request test THRU for the selected wallet. Test tokens have no monetary value." : "Connect Thru Wallet before requesting test funds." } as const;
}

/** Display prop for the official UI, never a fabricated balance. */
export function officialBalanceLabel(balance: string | bigint | null): string | undefined {
  if (balance === null || !/^\d+$/.test(balance.toString())) return undefined;
  return `${BigInt(balance).toLocaleString("en-US")} THRU`;
}

/** Copy the full public value; callers must await completion before showing success. */
export async function copyPublicValue(value: string, clipboard?: { writeText: (text: string) => Promise<void> }): Promise<void> {
  if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
  await clipboard.writeText(value);
}
