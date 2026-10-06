import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@thru/wallet/react";
import { walletMetadata } from "@cambrian/wallet-core";
import { activeThruAddress } from "../transaction-model";
import { useAccountBalance } from "../hooks/useAccountBalance";
import { explorerLink, StatusIcon } from "./TransactionFeedback";
import thruLogo from "../assets/thru-logo.png";
import cambrianMark from "../assets/cambrian-mark-light.svg";

const shortAddress = (value: string) => `${value.slice(0, 7)}…${value.slice(-4)}`;

function WalletIcon({ kind }: { kind: "copy" | "accounts" | "faucet" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></> : kind === "accounts" ? <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m2-14a3 3 0 0 1 0 6m4 8v-2a6 6 0 0 0-3-5" /></> : <><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" /><path d="M9 15a3 3 0 0 0 3 2" /></>}
  </svg>;
}

export function WalletChip({ refreshKey = 0, onFaucet, faucetBusy = false }: {
  refreshKey?: number; onFaucet?: () => void; faucetBusy?: boolean;
}) {
  const { selectedAccount, isConnected, isConnecting, connect, disconnect, manageAccounts, accounts, selectAccount } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  const balance = useAccountBalance(address, refreshKey);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);
  const [frame, setFrame] = useState({ top: 16, left: 16, width: 380, height: 560 });
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const actionBusy = useRef(false);
  const pending = Boolean(action || isConnecting);

  useEffect(() => { setMessage(null); setError(null); setShowAccounts(false); }, [address]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const viewport = window.visualViewport;
      const width = Math.min(380, (viewport?.width ?? window.innerWidth) - 24);
      const height = Math.min(560, (viewport?.height ?? window.innerHeight) - 24);
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const offsetTop = viewport?.offsetTop ?? 0;
      const rect = anchor.current?.getBoundingClientRect();
      setFrame({ width, height,
        left: Math.max(offsetLeft + 12, Math.min((rect?.right ?? window.innerWidth) - width, offsetLeft + (viewport?.width ?? window.innerWidth) - width - 12)),
        top: Math.max(offsetTop + 12, Math.min((rect?.bottom ?? 12) + 10, offsetTop + (viewport?.height ?? window.innerHeight) - height - 12)),
      });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      // Do not capture keyboard events from the official wallet's own approval UI.
      if (!panel.current?.contains(document.activeElement)) return;
      if (event.key === "Escape") { setOpen(false); anchor.current?.focus(); }
      if (event.key === "Tab") {
        const controls = panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", keyboard); };
  }, [open]);

  const run = async (label: string, operation: () => Promise<unknown>, success?: string) => {
    if (actionBusy.current) return;
    actionBusy.current = true; setAction(label); setError(null); setMessage(null);
    try { await operation(); if (success) setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The wallet action could not be completed."); }
    finally { actionBusy.current = false; setAction(null); }
  };
  const connectWallet = () => void run("connect", () => connect({ metadata: walletMetadata, passkeyName: "Cambrian" }));
  const detail = isConnecting ? "Waiting for wallet approval" : !address ? "Connect securely with Thru" : balance.status === "loading" ? "Reading your balance…" : balance.status === "unavailable" ? "Balance unavailable · retry in wallet" : `${balance.balance} THRU · Betanet`;

  return <div className="wallet-control">
    <button ref={anchor} className={`wallet-chip ${isConnecting ? "is-connecting" : ""}`} type="button" onClick={() => setOpen(value => !value)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "thru-wallet-panel" : undefined}>
      <span className="wallet-chip-logo"><img src={thruLogo} alt="" /></span>
      <span><strong>{address ? selectedAccount?.label || shortAddress(address) : "Connect Thru Wallet"}</strong><small>{detail}</small></span>
      <span className={`wallet-chip-indicator ${isConnecting ? "is-pending" : ""}`} aria-hidden="true" />
    </button>
    {open && createPortal(<section ref={panel} id="thru-wallet-panel" className="wallet-popover" role="dialog" aria-label="Thru Wallet account" style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }}>
      <header className="wallet-popover-head">
        <div className="wallet-popover-brand"><img src={cambrianMark} alt="" /><span><strong>Cambrian</strong><small>Connected through Thru Wallet</small></span></div>
        <button className="wallet-popover-close" type="button" onClick={() => { setOpen(false); anchor.current?.focus(); }} aria-label="Close wallet">×</button>
      </header>
      <div className="wallet-popover-network"><span><i />Thru Betanet</span><span>{pending ? "Waiting for approval" : address ? "Connected" : "Not connected"}</span></div>
      <div className="wallet-popover-body">
        {!address ? <div className="wallet-connect-state">
          <img src={thruLogo} width="64" height="64" alt="Thru logo" />
          <span className="wallet-eyebrow">YOUR WALLET. YOUR APPROVAL.</span>
          <h2>Start with Thru Wallet.</h2>
          <p>Connect or create your account in the official wallet. Cambrian never asks for your recovery phrase or private key.</p>
          <button className="wallet-primary" type="button" onClick={connectWallet} disabled={pending}>{pending ? "Confirm in Thru Wallet…" : "Connect Thru Wallet"}</button>
          {pending && <p className="wallet-inline-status is-pending"><StatusIcon tone="pending" spinning />Waiting for wallet approval</p>}
          <small>Keys and account management stay in Thru Wallet.</small>
        </div> : <>
          <button className="wallet-account-trigger" type="button" onClick={() => setShowAccounts(value => !value)} aria-expanded={showAccounts} disabled={pending}>
            <span className="wallet-account-avatar"><img src={thruLogo} alt="" /></span>
            <span><strong>{selectedAccount?.label || "Thru account"}</strong><small>{shortAddress(address)}</small></span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          {showAccounts && <div className="wallet-account-list" aria-label="Connected Thru accounts">
            {accounts.map(account => <button type="button" key={account.address} disabled={pending} onClick={() => void run("switch", () => selectAccount(account))} aria-pressed={account.address === address}>
              <span><strong>{account.label || "Thru account"}</strong><small>{shortAddress(account.address)}</small></span>{account.address === address && <span>✓</span>}
            </button>)}
            <button className="wallet-manage" type="button" onClick={() => void run("manage", manageAccounts)}>Manage in Thru Wallet ↗</button>
          </div>}
          <div className="wallet-total">
            <span>Total balance</span>
            {balance.status === "loading" ? <span className="skeleton wallet-balance-skeleton" aria-label="Loading balance" /> : <div><strong>{balance.balance ?? "—"}</strong><small>THRU</small></div>}
            <small>{balance.status === "loading" ? "Reading live balance…" : balance.status === "unavailable" ? "Could not read balance" : "Thru Betanet · test tokens"}</small>
            {balance.status === "unavailable" && <button className="wallet-text-action" type="button" onClick={balance.retry}>Retry balance read</button>}
          </div>
          <div className={`wallet-quick-actions ${onFaucet ? "" : "has-two"}`}>
            <button type="button" onClick={() => void run("copy", () => navigator.clipboard.writeText(address), "Address copied.")} disabled={pending}><WalletIcon kind="copy" /><strong>Copy address</strong></button>
            {onFaucet && <button type="button" onClick={onFaucet} disabled={faucetBusy || pending}><WalletIcon kind="faucet" /><strong>{faucetBusy ? "Claiming…" : "Get faucet"}</strong></button>}
            <button type="button" onClick={() => void run("manage", manageAccounts)} disabled={pending}><WalletIcon kind="accounts" /><strong>Accounts</strong></button>
          </div>
          <section className="wallet-assets" aria-label="Wallet tokens"><div className="wallet-assets-heading"><strong>Tokens</strong><span>1 asset</span></div>
            <a className="wallet-asset-row" href={explorerLink("address", address)} target="_blank" rel="noreferrer">
              <img src={thruLogo} width="40" height="40" alt="Thru logo" /><span><strong>THRU</strong><small>Thru Betanet</small></span><span className="wallet-asset-amount">{balance.status === "loading" ? <span className="skeleton token-balance-skeleton" /> : <strong>{balance.balance ?? "—"}</strong>}<small>THRU</small></span>
            </a>
          </section>
        </>}
        {error && <p className="wallet-inline-status is-error" role="alert"><StatusIcon tone="error" />{error}</p>}
        {message && <p className="wallet-inline-status is-success" role="status"><StatusIcon tone="success" />{message}</p>}
      </div>
      <footer className="wallet-popover-footer"><span>Signing stays in Thru Wallet</span>{address && <button type="button" onClick={() => void run("disconnect", disconnect)} disabled={pending}>Disconnect</button>}</footer>
    </section>, document.body)}
  </div>;
}
