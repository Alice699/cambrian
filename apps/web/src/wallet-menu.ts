import type { AccountMenuPayload, AccountMenuResult } from "@thru/wallet";
import type { useWallet } from "@thru/wallet/react";

type MenuApi = Pick<ReturnType<typeof useWallet>, "openAccountMenu" | "ensureDepositAccount" | "deposit">;

/** Only the host launcher is custom. Thru draws and controls the entire account menu. */
export async function openOfficialWalletMenu(api: MenuApi, options: {
  address: string; anchor: AccountMenuPayload["anchor"]; balance?: string; explorerUrl: string;
  isCurrent: () => boolean;
}): Promise<AccountMenuResult | null> {
  if (!options.address || !options.isCurrent()) return null;
  const result = await api.openAccountMenu({
    anchor: options.anchor, align: "right", network: "Thru Betanet", theme: "light",
    explorerUrl: options.explorerUrl,
    ...(options.balance !== undefined ? { balances: { [options.address]: options.balance } } : {}),
  });
  // Same explicit Add funds flow as the official WalletButton. Never claim a faucet here.
  if (result.action === "deposit" && options.isCurrent() && (!result.selectedAccount || result.selectedAccount.address === options.address)) {
    await api.ensureDepositAccount();
    if (options.isCurrent()) await api.deposit({ to: options.address });
  }
  return result;
}
