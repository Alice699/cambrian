import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useWallet } from "@thru/wallet/react";
import { walletMetadata } from "@cambrian/wallet-core";
import { activeThruAddress } from "../transaction-model";
import { officialBalanceLabel, walletLauncherPresentation } from "../presentation-model";
import { openOfficialWalletMenu } from "../wallet-menu";
import { useAccountBalance } from "../hooks/useAccountBalance";
import { AddressDisplay } from "./AddressDisplay";
import { explorerLink } from "../explorer";
import { UiIcon } from "./UiIcon";
import { ThruLogo } from "./ThruLogo";
import { StatusIcon } from "./TransactionFeedback";

function useOfficialConnect() {
  const { connect, isConnecting, isWalletAvailabilityLoading, selectedAccount, isConnected } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(null); }, [selectedAccount?.address, isConnected]);
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : "Thru Wallet could not complete this action. Please try again.");
  const onConnect = async () => {
    if (busy.current || isConnecting) return;
    busy.current = true; setStarting(true); setError(null);
    try { await connect({ metadata: walletMetadata, passkeyName: "Cambrian" }); }
    catch (cause) { if (alive.current) reportError(cause); }
    finally { busy.current = false; if (alive.current) setStarting(false); }
  };
  return { onConnect, isConnecting: isConnecting || starting, checking: isWalletAvailabilityLoading && !starting, error, reportError };
}

/** Instant host launcher; it does not render or replace any wallet screen. */
export function WalletLauncherButton({ presentation, expanded = false, onClick }: {
  presentation: ReturnType<typeof walletLauncherPresentation>; expanded?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return <button className={`wallet-launcher ${presentation.connected ? "is-connected" : ""} ${expanded ? "is-open" : ""}`} type="button" onClick={onClick}
    disabled={presentation.busy || expanded} aria-busy={presentation.busy}
    aria-haspopup={presentation.connected ? "menu" : undefined} aria-expanded={presentation.connected ? expanded : undefined}
    aria-label={presentation.connected ? `Open official Thru Wallet menu for ${presentation.label}` : presentation.label} title={presentation.detail}>
    <ThruLogo decorative />
    <span className="wallet-launcher-copy"><strong title={presentation.label}>{presentation.label}</strong><small>{presentation.detail}</small></span>
    <span className="wallet-launcher-trailing">{presentation.busy ? <StatusIcon tone="pending" spinning /> : <UiIcon name={presentation.connected ? "chevron" : "arrow"} />}</span>
  </button>;
}

/** Thru's official SDK still draws and manages the account menu and all approval UI. */
export function OfficialWalletControl({ refreshKey = 0, scopeKey = "" }: { refreshKey?: number; scopeKey?: string }) {
  const { selectedAccount, isConnected, openAccountMenu, ensureDepositAccount, deposit } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  const balance = useAccountBalance(address, refreshKey);
  const connection = useOfficialConnect();
  const formattedBalance = balance.status === "ready" ? officialBalanceLabel(balance.balance) : undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBusy = useRef(false);
  const menuScope = useRef({ address, active: true });
  useLayoutEffect(() => {
    const scope = { address, active: true };
    menuScope.current = scope;
    if (!menuBusy.current) setMenuOpen(false);
    return () => { scope.active = false; };
  }, [address, scopeKey]);
  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (connection.isConnecting || menuBusy.current) return;
    if (!address) { await connection.onConnect(); return; }
    const scope = menuScope.current;
    if (!scope.active || scope.address !== address) return;
    const rect = event.currentTarget.getBoundingClientRect();
    menuBusy.current = true; setMenuOpen(true);
    try {
      const result = await openOfficialWalletMenu({ openAccountMenu, ensureDepositAccount, deposit }, {
        address, balance: formattedBalance, explorerUrl: explorerLink("address", address),
        anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        isCurrent: () => scope.active && menuScope.current === scope,
      });
      // The shared launcher no longer remounts on navigation; refresh explicitly
      // after an Add funds action completes for this same account and route.
      if (result?.action === "deposit" && scope.active && menuScope.current === scope
        && (!result.selectedAccount || result.selectedAccount.address === address)) balance.retry();
    } catch (cause) { if (scope.active && menuScope.current === scope) connection.reportError(cause); }
    finally { menuBusy.current = false; if (menuScope.current.active) setMenuOpen(false); }
  };
  const presentation = walletLauncherPresentation({ address, label: selectedAccount?.label, connecting: connection.isConnecting, checking: connection.checking, balance: balance.balance, balanceStatus: balance.status });
  return <div className="official-wallet-control" aria-label="Thru Wallet account controls">
    <WalletLauncherButton presentation={presentation} expanded={menuOpen} onClick={event => void onClick(event)} />
    {connection.error && <p className="wallet-connection-error" role="alert">{connection.error}</p>}
  </div>;
}

/** A dapp empty-state action; connection approval still opens the official wallet. */
export function ConnectWalletAction() {
  const { onConnect, isConnecting, checking, error } = useOfficialConnect();
  return <div className="connect-wallet-action"><button className="state-action connect-thru-action" type="button" onClick={() => void onConnect()} disabled={isConnecting} aria-busy={isConnecting}>
    <ThruLogo decorative /><span>{checking ? "Checking Thru Wallet…" : isConnecting ? "Waiting for Thru Wallet…" : "Connect Thru Wallet"}</span>{isConnecting ? <StatusIcon tone="pending" spinning /> : <UiIcon name="arrow" />}
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
