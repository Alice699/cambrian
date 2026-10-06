import { useEffect, useRef, useState } from "react";
import { WalletButton, useWallet } from "@thru/wallet/react";
import { walletMetadata } from "@cambrian/wallet-core";
import { activeThruAddress } from "../transaction-model";
import { officialBalanceLabel } from "../presentation-model";
import { useAccountBalance } from "../hooks/useAccountBalance";
import { appConfig } from "../config";
import { AddressDisplay } from "./AddressDisplay";
import { explorerLink } from "../explorer";
import { UiIcon } from "./UiIcon";

function useOfficialConnect() {
  const { connect, isConnecting, selectedAccount, isConnected } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => { setError(null); }, [selectedAccount?.address, isConnected]);
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Thru Wallet could not complete this action. Please try again.");
  const onConnect = async () => {
    if (busy.current || isConnecting) return;
    busy.current = true; setError(null);
    try { await connect({ metadata: walletMetadata, passkeyName: "Cambrian" }); }
    catch (cause) { reportError(cause); }
    finally { busy.current = false; }
  };
  return { onConnect, isConnecting, error, reportError };
}

/** The button AND account menu are rendered by Thru's hosted UI, not a local popover. */
export function OfficialWalletControl({ refreshKey = 0 }: { refreshKey?: number }) {
  const { selectedAccount, isConnected } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  const balance = useAccountBalance(address, refreshKey);
  const connection = useOfficialConnect();
  const formattedBalance = balance.status === "ready" ? officialBalanceLabel(balance.balance) : undefined;
  return <div className="official-wallet-control" aria-label="Official Thru Wallet control">
    <WalletButton
      size="md" variant="primary" label="Connect Thru Wallet" loadingLabel="Connecting…"
      balance={formattedBalance} showBalance={formattedBalance !== undefined}
      network="Thru Betanet" explorerUrl={address ? explorerLink("address", address) : undefined}
      iframeUrl={appConfig.walletIframeUrl} theme="light"
      onConnect={() => void connection.onConnect()} onError={connection.reportError}
      className="official-wallet-button" style={{ minHeight: 48, maxWidth: "100%" }}
    />
    {connection.error && <p className="wallet-connection-error" role="alert">{connection.error}</p>}
  </div>;
}

/** A dapp empty-state action; connection approval still opens the official wallet. */
export function ConnectWalletAction() {
  const { onConnect, isConnecting, error } = useOfficialConnect();
  return <div className="connect-wallet-action"><button className="state-action" type="button" onClick={() => void onConnect()} disabled={isConnecting} aria-busy={isConnecting}>
    <UiIcon name="wallet" />{isConnecting ? "Waiting for Thru Wallet…" : "Connect Thru Wallet"}<UiIcon name="arrow" />
  </button>{error && <p className="wallet-connection-error" role="alert">{error}</p>}</div>;
}

export function ConnectedAccountSummary() {
  const { selectedAccount, isConnected } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  if (!address) return null;
  return <div className="account-context">
    <span className="account-context-label"><UiIcon name="wallet" />Viewing account</span>
    <AddressDisplay key={address} value={address} label={selectedAccount?.label || "Thru account"} compact />
    <span className="account-context-network"><i />Thru Betanet</span>
  </div>;
}
