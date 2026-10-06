export interface ActiveWalletAccount {
  provider: "thru" | "local";
  address: string;
}

/** A connected Thru Wallet is the explicit choice; local is only a fallback. */
export function selectActiveWallet(
  thruConnected: boolean,
  thruAddress: string | null | undefined,
  unlockedLocalAddress: string | null | undefined,
): ActiveWalletAccount | null {
  if (thruConnected && thruAddress) return { provider: "thru", address: thruAddress };
  if (unlockedLocalAddress) return { provider: "local", address: unlockedLocalAddress };
  return null;
}
