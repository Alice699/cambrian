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

export function walletLauncherPresentation(options: {
  address: string | null; label?: string; connecting: boolean; checking?: boolean; balance: string | null;
  balanceStatus: "loading" | "ready" | "unavailable";
}) {
  if (options.checking) return { label: options.address ? options.label || "Thru account" : "Checking Thru Wallet…", detail: "Checking your wallet connection", connected: Boolean(options.address), busy: true };
  if (options.connecting) return { label: "Waiting for Thru Wallet…", detail: "Approve in the official wallet", connected: Boolean(options.address), busy: true };
  if (!options.address) return { label: "Connect Thru Wallet", detail: "Official wallet · Betanet", connected: false, busy: false };
  const balance = options.balanceStatus === "ready" ? officialBalanceLabel(options.balance) : undefined;
  return {
    label: options.label || "Thru account", connected: true, busy: false,
    detail: `${shortPublicAddress(options.address, 6, 4)} · ${balance ?? (options.balanceStatus === "unavailable" ? "Balance unavailable" : "Thru Betanet")}`,
  };
}

/** Copy the full public value; callers must await completion before showing success. */
export async function copyPublicValue(value: string, clipboard?: { writeText: (text: string) => Promise<void> }): Promise<void> {
  if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
  await clipboard.writeText(value);
}
