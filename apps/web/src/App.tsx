import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useThru, useWallet } from "@thru/wallet/react";
import {
  listAccountTransactions,
  readAccountSnapshot,
  executeBirthTransaction,
  confirmBirthTransaction,
  BirthExecutionError,
  type CambrianOrganismRecord,
  type CambrianTransactionSummary,
  type BirthTransactionStage,
  type BirthTransactionUpdate,
  type BirthTransactionResult,
} from "@cambrian/sdk";
import { walletMetadata } from "@cambrian/wallet-core";
import { claimFaucet, FaucetApiError } from "./faucet";
import { activeThruAddress, noticeTone } from "./transaction-model";
import { OfficialWalletControl, ConnectedAccountSummary, ConnectWalletAction } from "./components/WalletControl";
import { FaucetButton } from "./components/FaucetButton";
import { AddressDisplay } from "./components/AddressDisplay";
import { ReadStateCard } from "./components/ReadStateCard";
import { UiIcon } from "./components/UiIcon";
import { NetworkCard } from "./components/NetworkCard";
import type { FaucetStage } from "./presentation-model";
export { ReadStateCard } from "./components/ReadStateCard";
import { BirthStatus, FaucetStatus, TransactionStatusBadge, TransactionNotice, StatusIcon, explorerLink } from "./components/TransactionFeedback";
import { useOrganismCollection, type OrganismReadStatus } from "./hooks/useOrganisms";
import { loadPendingBirth, savePendingBirth, clearPendingBirth } from "./birth-receipts";
import markAsset from "./assets/cambrian-mark.svg";
import footerMarkAsset from "./assets/cambrian-mark-light.svg";
import thruLogoAsset from "./assets/thru-logo.png";
import heroOrganismAsset from "./assets/organisms-thumbnail.svg";
import organismsThumbnailAsset from "./assets/network-dot.svg";
import { appConfig } from "./config";


type Notice = "faucet" | "faucet-submitted" | "faucet-success" | "faucet-error" | "birth" | "birth-submitted" | "birth-success" | "birth-error" | null;
type Route = "landing" | "dashboard" | "organisms" | "activity" | "learn";

const FAUCET_BALANCE_POLL_INTERVAL_MS = 1_000;
const FAUCET_BALANCE_POLL_TIMEOUT_MS = 30_000;
const FAUCET_ERROR_RECONCILE_TIMEOUT_MS = 15_000;

function parseFaucetAmount(value: string): bigint | null {
  try {
    const amount = BigInt(value);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

async function waitForFaucetBalance(
  client: Parameters<typeof readAccountSnapshot>[0],
  address: string,
  baselineBalance: bigint | null,
  amount: bigint,
  signal?: AbortSignal,
): Promise<bigint | null> {
  const targetBalance = baselineBalance === null ? null : baselineBalance + amount;
  if (targetBalance === null) return null;
  const deadline = Date.now() + FAUCET_BALANCE_POLL_TIMEOUT_MS;

  while (Date.now() < deadline && !signal?.aborted) {
    try {
      const account = await readAccountSnapshot(client, address);
      if (signal?.aborted) return null;
      if (account.balance !== null) {
        const reachedTarget = account.balance >= targetBalance;
        if (reachedTarget) return account.balance;
      }
    } catch {
      // The provider may confirm before the account index catches up. Keep polling.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, FAUCET_BALANCE_POLL_INTERVAL_MS));
  }

  return null;
}

async function waitForBalanceIncrease(
  client: Parameters<typeof readAccountSnapshot>[0],
  address: string,
  baselineBalance: bigint | null,
  signal?: AbortSignal,
): Promise<bigint | null> {
  if (baselineBalance === null) return null;
  const deadline = Date.now() + FAUCET_ERROR_RECONCILE_TIMEOUT_MS;

  while (Date.now() < deadline && !signal?.aborted) {
    try {
      const account = await readAccountSnapshot(client, address);
      if (signal?.aborted) return null;
      if (account.balance !== null) {
        const changed = account.balance > baselineBalance;
        if (changed) return account.balance;
      }
    } catch {
      // A delayed provider response can land before the balance index is ready.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, FAUCET_BALANCE_POLL_INTERVAL_MS));
  }

  return null;
}

function routeFromLocation(): Route {
  const path = window.location.pathname;
  if (path === "/app/organisms") return "organisms";
  if (path === "/app/activity") return "activity";
  if (path === "/app/learn") return "learn";
  return path.startsWith("/app") ? "dashboard" : "landing";
}

function navigateInternal(path: string, event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();

  const updateRoute = () => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const documentWithTransitions = document as Document & {
    startViewTransition?: (update: () => void) => unknown;
  };

  if (documentWithTransitions.startViewTransition) {
    documentWithTransitions.startViewTransition(updateRoute);
  } else {
    updateRoute();
  }
}

function LogoPrimary() {
  return (
    <a className="logo-primary" href="/" onClick={(event) => navigateInternal("/", event)} aria-label="Cambrian landing page">
      <img src={markAsset} width="52" height="52" alt="" />
      <span>CAMBRIAN</span>
    </a>
  );
}

function Sidebar({ activeRoute }: { activeRoute: Exclude<Route, "landing"> }) {
  return (
    <aside className="sidebar">
      <LogoPrimary />
      <p className="sidebar-label">THRU BETANET</p>
      <nav className="sidebar-nav" aria-label="Dashboard">
        <a className={`sidebar-nav-item ${activeRoute === "dashboard" ? "active" : ""}`} href="/app" onClick={(event) => navigateInternal("/app", event)} aria-current={activeRoute === "dashboard" ? "page" : undefined}>Overview</a>
        <a className={`sidebar-nav-item ${activeRoute === "organisms" ? "active" : ""}`} href="/app/organisms" onClick={(event) => navigateInternal("/app/organisms", event)} aria-current={activeRoute === "organisms" ? "page" : undefined}>Organisms</a>
        <a className={`sidebar-nav-item ${activeRoute === "activity" ? "active" : ""}`} href="/app/activity" onClick={(event) => navigateInternal("/app/activity", event)} aria-current={activeRoute === "activity" ? "page" : undefined}>Activity</a>
        <a className={`sidebar-nav-item ${activeRoute === "learn" ? "active" : ""}`} href="/app/learn" onClick={(event) => navigateInternal("/app/learn", event)} aria-current={activeRoute === "learn" ? "page" : undefined}>Learn</a>
      </nav>
      <a className="back-home-link" href="/" onClick={(event) => navigateInternal("/", event)}>Back to landing</a>
      <NetworkCard />
    </aside>
  );
}



type ActivityReadStatus = "idle" | "loading" | "ready" | "empty" | "needs-wallet" | "error";

interface ActivityReadState {
  walletAddress: string | null;
  status: ActivityReadStatus;
  transactions: CambrianTransactionSummary[];
  error: string | null;
}

function useAccountTransactions(refreshKey = 0, addressOverride?: string | null): ActivityReadState {
  const { thru } = useThru();
  const { selectedAccount, isConnected } = useWallet();
  const address = addressOverride !== undefined
    ? addressOverride
    : activeThruAddress(isConnected, selectedAccount?.address);
  const [state, setState] = useState<ActivityReadState>({
    walletAddress: address ?? null,
    status: address ? "idle" : "needs-wallet",
    transactions: [],
    error: null,
  });

  useEffect(() => {
    let active = true;

    if (!address) {
      setState({ walletAddress: null, status: "needs-wallet", transactions: [], error: null });
      return () => {
        active = false;
      };
    }

    if (!thru) {
      setState({ walletAddress: address, status: "idle", transactions: [], error: null });
      return () => {
        active = false;
      };
    }

    setState({ walletAddress: address, status: "loading", transactions: [], error: null });
    listAccountTransactions(thru, address)
      .then((result) => {
        if (!active) return;
        setState({
          walletAddress: address,
          status: result.transactions.length > 0 ? "ready" : "empty",
          transactions: result.transactions,
          error: null,
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          walletAddress: address,
          status: "error",
          transactions: [],
          error: error instanceof Error ? error.message : "Could not read account activity",
        });
      });

    return () => {
      active = false;
    };
  }, [address, thru, refreshKey]);

  return state.walletAddress === (address ?? null) ? state : { walletAddress: address ?? null, status: address ? "loading" : "needs-wallet", transactions: [], error: null };
}

function ReadStateAction({ status, kind, onRetry }: { status: OrganismReadStatus | ActivityReadStatus; kind: "organisms" | "activity"; onRetry?: () => void }) {
  if (status === "needs-wallet") return <ConnectWalletAction />;
  if (status !== "empty") return null;
  if (kind === "organisms" && !appConfig.walletBirthEnabled) return <span className="read-state-paused"><UiIcon name="activity" />Birth paused · program upgrade pending</span>;
  if (kind === "activity" && onRetry) return <button className="state-action is-secondary" type="button" onClick={onRetry}><UiIcon name="retry" />Refresh activity</button>;
  return <a className="state-action is-secondary" href="/app" onClick={event => navigateInternal("/app", event)}>Open ecosystem<UiIcon name="arrow" /></a>;
}

function organismStatusCopy(status: OrganismReadStatus, error: string | null) {
  if (status === "needs-wallet") return ["Your ecosystem starts here", "Connect Thru Wallet to see the organisms owned by your account."] as const;
  if (status === "not-configured") return ["Deployment pending", "Set the fresh Cambrian program ID before querying organism accounts."] as const;
  if (status === "loading" || status === "idle") return ["Finding your organisms", "Reading live Betanet state for the account you selected."] as const;
  if (status === "empty") return ["No organisms yet", "Organisms controlled by this account will appear here. Existing on-chain records are unchanged."] as const;
  if (status === "error") return ["Couldn't load organisms", error ?? "Betanet is temporarily unavailable. Retry the read when you're ready."] as const;
  return ["No organism data", "Create an organism through the wallet to make state available here."] as const;
}

function activityStatusCopy(status: ActivityReadStatus, error: string | null) {
  if (status === "needs-wallet") return ["A clear trail, just for you", "Connect your wallet to see its transactions and confirmation status."] as const;
  if (status === "loading" || status === "idle") return ["Reading your activity", "Fetching the latest transaction records from Thru Betanet."] as const;
  if (status === "empty") return ["No transactions yet", "Your account's transactions will appear here when Betanet returns them."] as const;
  if (status === "error") return ["Couldn't load activity", error ?? "The account read is temporarily unavailable. No transaction was sent."] as const;
  return ["No activity data", "Select a wallet account to read its transaction trail."] as const;
}

function birthStageLabel(stage: BirthTransactionStage | null | undefined) {
  if (!stage) return "Birth new organism";
  if (stage === "connecting") return "Connect Thru Wallet";
  if (stage === "awaiting-approval") return "Approve in Thru Wallet";
  if (stage === "preparing") return "Preparing birth";
  if (stage === "signed") return "Wallet approved";
  if (stage === "submitting") return "Submitting birth";
  if (stage === "submitted") return "Birth submitted";
  if (stage === "syncing") return "Reading organism";
  if (stage === "confirmed") return "Birth confirmed";
  return "Birth failed";
}

function EcosystemStage({ onBirth, birthStage, birthBusy, birthPending, organism, readStatus }: {
  onBirth: () => void;
  birthStage?: BirthTransactionStage | null;
  birthBusy: boolean;
  birthPending: boolean;
  organism?: CambrianOrganismRecord;
  readStatus: OrganismReadStatus;
}) {
  return (
    <section className="ecosystem-stage" aria-labelledby="ecosystem-title">
      <div className="stage-copy">
        <p className="stage-label">ON-CHAIN LIFEFORM</p>
        <h2 id="ecosystem-title">{organism ? "Your organism is alive." : readStatus === "loading" ? "Reading your ecosystem." : readStatus === "needs-wallet" ? "Your ecosystem starts here." : "Birth your first organism."}</h2>
        <p className="stage-description">{organism ? "Live organism state, owned by your selected Thru account." : readStatus === "loading" ? "Verifying on-chain state for your wallet. This will not send a transaction." : "Connect Thru Wallet, fund your account, and approve your first Birth."}</p>
        <p className="stage-meta">{organism ? `BORN / SLOT ${organism.state.bornSlot.toString()}` : "THRU BETANET / AWAITING FIRST BIRTH"}</p>
      </div>
      <div className="stage-viewer">
        <img src={heroOrganismAsset} width="210" height="190" alt="Cambrian organism viewer" />
        <p>3D VIEWER&nbsp; / &nbsp;PHASE 1</p>
      </div>
      <button className="birth-button" type="button" onClick={onBirth} disabled={birthBusy || readStatus === "loading" || (!birthPending && readStatus !== "needs-wallet" && !appConfig.walletBirthEnabled)} aria-busy={birthBusy} aria-live="polite">
        {birthBusy ? birthStageLabel(birthStage) : birthPending ? "Check Birth status" : readStatus === "needs-wallet" ? "Connect Thru Wallet" : !appConfig.walletBirthEnabled ? "Ownership upgrade pending" : birthStageLabel(null)}
      </button>
    </section>
  );
}


function StatCard({ label, value, loading = false }: { label: string; value: string; loading?: boolean }) {
  return (
    <article className="stat-card">
      <p>{label}</p>
      {loading ? <span className="skeleton stat-skeleton" aria-label={`Loading ${label.toLowerCase()}`} /> : <strong>{value}</strong>}
    </article>
  );
}

function OrganismsPanel({ organism, status, error, onRetry }: { organism?: CambrianOrganismRecord; status: OrganismReadStatus; error: string | null; onRetry?: () => void }) {
  const state = organism?.state;
  const statusCopy = organismStatusCopy(status, error);

  return (
    <section className="organisms-panel" id="organisms" aria-labelledby="organisms-title">
      <p className="panel-label" id="organisms-title">YOUR ORGANISMS</p>
      {organism && state ? (
        <>
          <h2>Cambrian organism</h2>
          <p className="organism-meta">GENERATION {state.generation}&nbsp; / &nbsp;PULSES {state.pulseCount.toString()}</p>
          <AddressDisplay value={organism.address} label="Organism" compact />
          <p className="organism-description">Live account data read from the Cambrian program on Thru Betanet. The organism viewer will become state-driven after the read model is stable.</p>
        </>
      ) : (
        <ReadStateCard title={statusCopy[0]} description={statusCopy[1]} tone={status === "error" ? "error" : "neutral"} loading={status === "loading" || status === "idle"} onRetry={onRetry} icon={status === "needs-wallet" ? "wallet" : "organism"} action={["needs-wallet", "empty"].includes(status) ? <ReadStateAction status={status} kind="organisms" onRetry={onRetry} /> : undefined} />
      )}
      {organism && <img className="organisms-thumbnail" src={organismsThumbnailAsset} width="82" height="82" alt="Cambrian organism thumbnail" />}
    </section>
  );
}

function ActivityPanel({ transactions, status, error, onRetry }: { transactions: CambrianTransactionSummary[]; status: ActivityReadStatus; error: string | null; onRetry?: () => void }) {
  const statusCopy = activityStatusCopy(status, error);

  return (
    <section className="activity-panel" id="activity" aria-labelledby="activity-title">
      <p className="panel-label" id="activity-title">RECENT ACTIVITY</p>
      {transactions.length > 0 ? transactions.slice(0, 3).map((transaction, index) => (
        <div className="activity-row" key={transaction.signature || transaction.program + "-" + index}>
          <div>
            <strong>Transaction</strong>
            {transaction.signature ? <AddressDisplay value={transaction.signature} kind="tx" compact /> : <span>Signature unavailable</span>}
            <small>{transaction.slot ? "Slot " + transaction.slot.toString() : "Slot pending"}</small>
          </div>
          <TransactionStatusBadge status={transaction.status} vmError={transaction.vmError} />
        </div>
      )) : (
        <ReadStateCard title={statusCopy[0]} description={statusCopy[1]} tone={status === "error" ? "error" : "neutral"} loading={status === "loading" || status === "idle"} onRetry={onRetry} icon={status === "needs-wallet" ? "wallet" : "activity"} action={["needs-wallet", "empty"].includes(status) ? <ReadStateAction status={status} kind="activity" onRetry={onRetry} /> : undefined} />
      )}
    </section>
  );
}

function DashboardFooter() {
  return (
    <footer className="dashboard-footer">
      <div className="footer-top">
        <a className="footer-brand" href="/" onClick={(event) => navigateInternal("/", event)}>
          <img src={markAsset} width="38" height="38" alt="" />
          <span><strong>CAMBRIAN</strong><small>Living systems on Thru Betanet.</small></span>
        </a>
        <div className="footer-links">
          <div><p>EXPLORE</p><a href="/app" onClick={(event) => navigateInternal("/app", event)}>Overview</a><a href="/app/organisms" onClick={(event) => navigateInternal("/app/organisms", event)}>Organisms</a></div>
          <div><p>NETWORK</p><a href="/app/activity" onClick={(event) => navigateInternal("/app/activity", event)}>On-chain trail</a><a href="https://thru.org/docs/" target="_blank" rel="noreferrer">Thru docs</a></div>
        </div>
      </div>
      <div className="footer-bottom"><span>THRU BETANET / TEST NETWORK</span><span>Readable interfaces for living state.</span></div>
    </footer>
  );
}

function noticeCopy(notice: Notice, detail?: string | null) {
  if (notice === "faucet") return detail ?? "Preparing your Betanet account...";
  if (notice === "faucet-submitted") return detail ?? "Faucet request submitted. Waiting for the Betanet balance to update.";
  if (notice === "faucet-success") return detail ?? "Faucet funds confirmed by the Betanet provider.";
  if (notice === "faucet-error") return detail ?? "Faucet request could not be completed.";
  if (notice === "birth") return detail ?? "Birth requires a configured Cambrian Betanet deployment.";
  if (notice === "birth-submitted") return detail ?? "Birth was submitted. Waiting for the Betanet execution result.";
  if (notice === "birth-success") return detail ?? "Birth transaction confirmed by the Betanet RPC.";
  if (notice === "birth-error") return detail ?? "Birth could not be completed. Check the wallet approval and Betanet state.";
  return detail ?? "Working on your request...";
}

function DashboardFrame({ activeRoute, children, notice, noticeDetail, onDismiss }: { activeRoute: Exclude<Route, "landing">; children: ReactNode; notice?: Notice; noticeDetail?: string | null; onDismiss?: () => void }) {
  return (
    <div className="dashboard-shell">
      <Sidebar activeRoute={activeRoute} />
      <main className="dashboard-main">
        {children}
        <DashboardFooter />
      </main>
      {notice && <TransactionNotice tone={noticeTone(notice)} message={noticeCopy(notice, noticeDetail)} onDismiss={onDismiss} />}
    </div>
  );
}

function DashboardPage() {
  const { isConnected, selectedAccount } = useWallet();
  // A wallet switch creates a fresh account-scoped view and cancels old workflows.
  return <DashboardContent key={activeThruAddress(isConnected, selectedAccount?.address) ?? "disconnected"} />;
}

function DashboardContent() {
  const { thru } = useThru();
  const { wallet, selectedAccount, isConnected, connect } = useWallet();
  const activeAddress = activeThruAddress(isConnected, selectedAccount?.address);
  const [savedBirth] = useState(() => { try { return activeAddress ? loadPendingBirth(sessionStorage, appConfig.programId, activeAddress) : null; } catch { return null; } });
  const [notice, setNotice] = useState<Notice>(null);
  const [noticeDetail, setNoticeDetail] = useState<string | null>(null);
  const [birthStage, setBirthStage] = useState<BirthTransactionStage | null>(null);
  const [birthUpdate, setBirthUpdate] = useState<BirthTransactionUpdate | null>(() => savedBirth ? { ...savedBirth, stage: savedBirth.stage === "confirmed" ? "syncing" : "submitted" } : null);
  const [birthReceipt, setBirthReceipt] = useState<BirthTransactionResult | null>(savedBirth);
  const [birthAccount, setBirthAccount] = useState<string | null>(savedBirth ? activeAddress : null);
  const [createdOrganism, setCreatedOrganism] = useState<CambrianOrganismRecord | null>(null);
  const [chainRefreshKey, setChainRefreshKey] = useState(0);
  const [birthBusy, setBirthBusy] = useState(false);
  const birthBusyRef = useRef(false);
  const birthControllerRef = useRef<AbortController | null>(null);
  const faucetControllerRef = useRef<AbortController | null>(null);
  const faucetBusyRef = useRef(false);
  const faucetBaselineRef = useRef<bigint | null>(null);
  const [faucetPending, setFaucetPending] = useState(false);
  const [faucetStage, setFaucetStage] = useState<FaucetStage>("idle");
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const organismRead = useOrganismCollection(chainRefreshKey, createdOrganism);
  const activityRead = useAccountTransactions(chainRefreshKey, isConnected ? selectedAccount?.address : undefined);
  const organism = organismRead.organisms[0];
  const birthPending = Boolean(birthReceipt && !birthReceipt.organism);

  useEffect(() => () => { birthControllerRef.current?.abort(); faucetControllerRef.current?.abort(); }, []);

  const handleBirth = async () => {
    if (birthBusyRef.current) return;

    if (!appConfig.programId || !appConfig.abiId) {
      setNotice("birth");
      setNoticeDetail(null);
      return;
    }

    if (!thru || !wallet) {
      setNotice("birth-error");
      setNoticeDetail("Thru Wallet is still initializing. Wait a moment and try again.");
      return;
    }

    if (!isConnected || !activeAddress) {
      setBirthUpdate({ stage: "connecting" });
      try { await connect({ metadata: walletMetadata, passkeyName: "Cambrian" }); }
      catch (cause) { setBirthUpdate({ stage: "failed", error: cause instanceof Error ? cause : new Error("Wallet connection was not approved.") }); }
      return;
    }

    if (!birthPending && !appConfig.walletBirthEnabled) {
      setNotice("birth");
      setNoticeDetail("Wallet-owned Birth is awaiting the verified program upgrade. No transaction was sent. Existing organisms remain on-chain.");
      return;
    }

    birthBusyRef.current = true;
    setBirthBusy(true);
    const controller = new AbortController();
    birthControllerRef.current = controller;
    setNotice(null);
    setNoticeDetail(null);
    const onUpdate = (update: BirthTransactionUpdate) => {
      if (update.signature && update.prepared && update.stage !== "failed") {
        try { savePendingBirth(sessionStorage, appConfig.programId, activeAddress, { prepared: update.prepared, signature: update.signature, stage: update.stage === "syncing" || update.stage === "confirmed" ? "confirmed" : "submitted" }); } catch { /* Receipt storage is best effort; signing is not dependent on it. */ }
      }
      if (controller.signal.aborted) return;
      setBirthStage(update.stage);
      setBirthUpdate(update);
      setNotice(update.stage === "confirmed" ? "birth-success" : update.stage === "failed" ? "birth-error" : "birth");
      setNoticeDetail(update.stage === "confirmed" ? "Birth confirmed. Your organism is ready." : update.stage === "awaiting-approval" ? "Review and approve Birth in Thru Wallet." : birthStageLabel(update.stage));
    };

    try {
      let result: BirthTransactionResult;
      if (birthReceipt && !birthReceipt.organism) {
        onUpdate({ stage: birthReceipt.stage === "confirmed" ? "syncing" : "submitted", prepared: birthReceipt.prepared, signature: birthReceipt.signature });
        result = await confirmBirthTransaction(thru, appConfig, birthReceipt, { onUpdate, signal: controller.signal });
      } else {
        setBirthReceipt(null);
        setBirthAccount(null);
        controller.signal.throwIfAborted();
        onUpdate({ stage: "preparing" });
        const context = await wallet.getSigningContext();
        if (!context.selectedAccountPublicKey) throw new Error("Select an account in Thru Wallet before approving Birth.");
        if (context.selectedAccountPublicKey !== activeAddress) throw new Error("The wallet account changed. Select the account again before starting Birth.");
        setBirthAccount(context.selectedAccountPublicKey);
        result = await executeBirthTransaction(thru, appConfig, wallet, {
          walletAddress: context.selectedAccountPublicKey,
          signingMode: "thru-wallet",
          seed: `birth-${crypto.randomUUID().slice(0, 24)}`,
          onUpdate,
          signal: controller.signal,
        });
      }
      if (controller.signal.aborted) return;
      setBirthReceipt(result);
      setBalanceRefreshKey((current) => current + 1);
      setChainRefreshKey((current) => current + 1);
      if (result.organism) {
        try { clearPendingBirth(sessionStorage, appConfig.programId, activeAddress); } catch { /* Non-secret receipt only. */ }
        setCreatedOrganism(result.organism);
        setNotice("birth-success");
        setNoticeDetail("Birth confirmed. Your organism is now visible in the dashboard.");
      } else {
        setNotice("birth-submitted");
        setNoticeDetail(result.stage === "confirmed"
          ? "Birth confirmed. The organism is still syncing; use Check Birth status to read it again."
          : "Birth is awaiting confirmation. Check its status before submitting another transaction.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const normalized = error instanceof Error ? error : new Error("Birth could not be completed.");
      setBirthUpdate((current) => ({ ...current, stage: "failed", error: normalized }));
      if (error instanceof BirthExecutionError) {
        setBirthReceipt(null);
        try { clearPendingBirth(sessionStorage, appConfig.programId, activeAddress); } catch { /* Non-secret receipt only. */ }
      }
      setNotice("birth-error");
      setNoticeDetail(normalized.message);
    } finally {
      birthBusyRef.current = false;
      if (!controller.signal.aborted) {
        setBirthStage(null);
        setBirthBusy(false);
      }
    }
  };

  const handleFaucet = async () => {
    if (faucetBusyRef.current || faucetPending) return;
    if (!activeAddress) {
      setNotice("faucet-error");
      setNoticeDetail("Connect Thru Wallet before requesting Betanet funds.");
      return;
    }

    faucetBusyRef.current = true;
    const controller = new AbortController();
    faucetControllerRef.current = controller;
    setFaucetStage("requesting");
    setNotice("faucet");
    setNoticeDetail("Requesting test THRU from Betanet...");

    let baselineBalance: bigint | null = null;
    try {
      if (thru) {
        try {
          baselineBalance = (await readAccountSnapshot(thru, activeAddress)).balance;
        } catch {
          // The balance read is best effort. The claim can still continue.
        }
      }

      setFaucetStage("requesting");
      setNotice("faucet");
      setNoticeDetail("Requesting test THRU from Betanet...");
      controller.signal.throwIfAborted();
      faucetBaselineRef.current = baselineBalance;
      const receipt = await claimFaucet(activeAddress, controller.signal);
      if (controller.signal.aborted) return;

      const amount = parseFaucetAmount(receipt.amount);
      let confirmedBalance: bigint | null = null;
      if (thru && amount) {
        setFaucetStage("confirming");
        setNotice("faucet-submitted");
        setNoticeDetail("Request accepted. Waiting for your Betanet balance to update...");
        confirmedBalance = await waitForFaucetBalance(thru, activeAddress, baselineBalance, amount, controller.signal);
      }

      if (controller.signal.aborted) return;

      setBalanceRefreshKey((current) => current + 1);
      if (confirmedBalance !== null) {
        setNotice("faucet-success");
        setNoticeDetail(`${receipt.amount} THRU received. Balance is now ${confirmedBalance.toString()} THRU.`);
      } else if (receipt.status === "confirmed") {
        setNotice("faucet-success");
        setNoticeDetail(`${receipt.amount} THRU confirmed by the Betanet faucet.`);
      } else {
        setFaucetPending(true);
        setNotice("faucet-submitted");
        setNoticeDetail("Request accepted. Your balance is still settling; check again in a moment.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      let reconciledBalance: bigint | null = null;
      if (thru) {
        try {
          reconciledBalance = (await readAccountSnapshot(thru, activeAddress)).balance;
        } catch {
          // Keep the original provider error when the reconciliation read also fails.
        }
      }
      if (controller.signal.aborted) return;

      const balanceChanged = reconciledBalance !== null && baselineBalance !== null && reconciledBalance > baselineBalance;
      if (balanceChanged && reconciledBalance !== null) {
        setBalanceRefreshKey((current) => current + 1);
        setNotice("faucet-success");
        setNoticeDetail(`Balance updated to ${reconciledBalance.toString()} THRU. The faucet transfer is complete.`);
        return;
      }

      const responseMayBeDelayed = !(error instanceof FaucetApiError)
        || error.code === "provider-error"
        || error.code === "network-error";
      if (thru && responseMayBeDelayed) {
        setFaucetStage("confirming");
        setNotice("faucet-submitted");
        setNoticeDetail("The faucet response was delayed. Verifying your balance before reporting an error...");
        reconciledBalance = await waitForBalanceIncrease(thru, activeAddress, baselineBalance, controller.signal);
        if (controller.signal.aborted) return;
        if (reconciledBalance !== null) {
          setBalanceRefreshKey((current) => current + 1);
          setNotice("faucet-success");
          setNoticeDetail(`Balance updated to ${reconciledBalance.toString()} THRU. The faucet transfer is complete.`);
          return;
        }
        setFaucetPending(true);
        setNotice("faucet-submitted");
        setNoticeDetail("The provider response is uncertain. Check your balance before requesting again; no automatic retry will be sent.");
        return;
      }

      const detail = error instanceof FaucetApiError && error.code === "rate-limited" && error.retryAfterSeconds
        ? `Faucet is cooling down. Try again in ${error.retryAfterSeconds} seconds.`
        : error instanceof FaucetApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Faucet request failed.";
      setNotice("faucet-error");
      setNoticeDetail(detail);
    } finally {
      faucetBusyRef.current = false;
      if (!controller.signal.aborted) setFaucetStage("idle");
    }
  };

  const checkFaucetBalance = async () => {
    if (!thru || !activeAddress || faucetBusyRef.current) return;
    faucetBusyRef.current = true;
    setFaucetStage("confirming");
    try {
      const account = await readAccountSnapshot(thru, activeAddress);
      if (faucetControllerRef.current?.signal.aborted) return;
      setBalanceRefreshKey(key => key + 1);
      if (account.balance !== null && faucetBaselineRef.current !== null && account.balance > faucetBaselineRef.current) {
        setFaucetPending(false); setNotice("faucet-success");
        setNoticeDetail(`Balance updated to ${account.balance.toString()} THRU.`);
      } else {
        setNotice("faucet-submitted"); setNoticeDetail("The balance increase has not been verified yet. This check did not send another faucet request.");
      }
    } catch {
      if (faucetControllerRef.current?.signal.aborted) return;
      setNotice("faucet-submitted"); setNoticeDetail("The balance read is unavailable. Your claim is still unverified; no new request was sent.");
    }
    finally { faucetBusyRef.current = false; if (!faucetControllerRef.current?.signal.aborted) setFaucetStage("idle"); }
  };

  const dismissNotice = () => {
    setNotice(null);
    setNoticeDetail(null);
  };

  return (
    <DashboardFrame activeRoute="dashboard" notice={notice} noticeDetail={noticeDetail} onDismiss={dismissNotice}>
      <header className="dashboard-header" id="overview">
        <div>
          <p className="page-label">OVERVIEW&nbsp; / &nbsp;CAMBRIAN LIFEFORM</p>
          <h1>Your ecosystem</h1>
        </div>
        <div className="header-actions" id="account-controls">
          <FaucetButton stage={faucetStage} pending={faucetPending} connected={Boolean(activeAddress)} onClick={faucetPending ? checkFaucetBalance : handleFaucet} />
          <OfficialWalletControl refreshKey={balanceRefreshKey} />
        </div>
      </header>
      <ConnectedAccountSummary />

      <EcosystemStage onBirth={handleBirth} birthStage={birthStage} birthBusy={birthBusy} birthPending={birthPending} organism={organism} readStatus={organismRead.status} />
      {!appConfig.walletBirthEnabled && <div className="ownership-upgrade-note" role="status"><StatusIcon tone="pending" /><div><strong>Wallet ownership upgrade pending</strong><p>New Births are paused until the updated program is deployed. Existing organisms remain on-chain; legacy fee-payer-controlled organisms require a reviewed ownership transfer.</p></div><a href={explorerLink("address", appConfig.programId)} target="_blank" rel="noreferrer">View program ↗</a></div>}
      <BirthStatus update={birthUpdate} account={birthAccount} onCheck={birthPending ? handleBirth : undefined} busy={birthBusy} />
      {(faucetPending || faucetStage !== "idle" || notice?.startsWith("faucet")) && <FaucetStatus
        tone={notice?.startsWith("faucet") ? noticeTone(notice) : "pending"}
        description={notice?.startsWith("faucet") ? noticeCopy(notice, noticeDetail) : faucetStage === "requesting" ? "Requesting test THRU. Please wait before starting another claim." : "Your claim is not verified yet. Checking its status will not request funds again."}
        onCheck={faucetPending ? checkFaucetBalance : undefined}
        busy={faucetStage !== "idle"}
      />}

      <section className="signal-section" aria-labelledby="signal-title">
        <h2 id="signal-title">Signal</h2>
        <div className="stats-grid">
          <StatCard label="Energy" value={organism ? organism.state.energy.toString() : "—"} loading={organismRead.status === "loading"} />
          <StatCard label="Vitality" value={organism ? organism.state.vitality.toString() : "—"} loading={organismRead.status === "loading"} />
          <StatCard label="On-chain actions" value={activityRead.status === "empty" ? "0" : activityRead.transactions.length > 0 ? activityRead.transactions.length.toString() : "—"} loading={activityRead.status === "loading"} />
        </div>
      </section>

      <div className="dashboard-panels">
        <OrganismsPanel organism={organism} status={organismRead.status} error={organismRead.error} onRetry={() => setChainRefreshKey(key => key + 1)} />
        <ActivityPanel transactions={activityRead.transactions} status={activityRead.status} error={activityRead.error} onRetry={() => setChainRefreshKey(key => key + 1)} />
      </div>
    </DashboardFrame>
  );
}


function InnerPageHeader({ label, title, description, action }: { label: string; title: string; description: string; action?: ReactNode }) {
  return (
    <><header className="inner-page-header">
      <div><p className="page-label">{label}</p><h1>{title}</h1><p>{description}</p></div>
      <div className="inner-page-action">{action}<OfficialWalletControl /></div>
    </header><ConnectedAccountSummary /></>
  );
}

function OrganismsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const organismRead = useOrganismCollection(refreshKey);
  const organism = organismRead.organisms[0];
  const statusCopy = organismStatusCopy(organismRead.status, organismRead.error);

  return (
    <DashboardFrame activeRoute="organisms">
      <InnerPageHeader
        label="ORGANISMS / COLLECTION"
        title="The living collection"
        description="Track the organisms you have brought to life and the state they carry across the Thru Betanet."
        action={<span className="connected-badge"><i /> READ-ONLY</span>}
      />
      {organism ? (
        <>
          <section className="organism-focus-card" aria-labelledby="focus-organism-title">
            <div>
              <p className="panel-label">SELECTED ORGANISM</p>
              <h2 id="focus-organism-title">Cambrian organism</h2>
              <p>Live state decoded from the account data owned by the configured Cambrian program.</p>
              <div className="focus-meta">
                <span>GENERATION <b>{organism.state.generation}</b></span>
                <span>PULSES <b>{organism.state.pulseCount.toString()}</b></span>
                <AddressDisplay value={organism.address} label="Organism" compact tone="dark" />
              </div>
            </div>
            <div className="focus-organism-view"><img src={heroOrganismAsset} width="210" height="190" alt="Cambrian organism state viewer" /><span>3D VIEWER / READ MODEL</span></div>
          </section>
          <section className="trait-section" aria-label="Organism traits">
            <article><span>ENERGY</span><strong>{organism.state.energy.toString()}</strong><p>Value read from the current account state.</p></article>
            <article><span>VITALITY</span><strong>{organism.state.vitality.toString()}</strong><p>Value read from the current account state.</p></article>
            <article><span>PULSE COUNT</span><strong>{organism.state.pulseCount.toString()}</strong><p>Actions recorded by the organism.</p></article>
          </section>
          <section className="collection-note"><p className="panel-label">NEXT TRACE</p><h2>Every pulse leaves a readable mark.</h2><p>Use Activity to inspect the account trail. New actions remain behind wallet approval and receipt confirmation.</p></section>
        </>
      ) : (
        <ReadStateCard title={statusCopy[0]} description={statusCopy[1]} tone={organismRead.status === "error" ? "error" : "neutral"} loading={organismRead.status === "loading" || organismRead.status === "idle"} onRetry={() => setRefreshKey(key => key + 1)} icon={organismRead.status === "needs-wallet" ? "wallet" : "organism"} action={["needs-wallet", "empty"].includes(organismRead.status) ? <ReadStateAction status={organismRead.status} kind="organisms" /> : undefined} />
      )}
    </DashboardFrame>
  );
}

function ActivityTimeline({ transactions }: { transactions: CambrianTransactionSummary[] }) {
  return (
    <div className="activity-timeline">
      {transactions.map((transaction, index) => (
        <div className="timeline-item" key={transaction.signature || transaction.program + "-" + index}>
          <div className="timeline-marker"><TransactionStatusBadge status={transaction.status} vmError={transaction.vmError} /></div>
          <div className="timeline-copy">
            <strong>Transaction</strong>
            {transaction.signature ? <AddressDisplay value={transaction.signature} kind="tx" compact /> : <span>Signature unavailable</span>}
            <small>{transaction.slot ? "Slot " + transaction.slot.toString() : "Slot unavailable"} / {transaction.instructionBytes} instruction bytes</small>
          </div>
          <a href={transaction.signature ? explorerLink("tx", transaction.signature) : explorerLink("address", transaction.program)} target="_blank" rel="noreferrer">Open explorer</a>
        </div>
      ))}
    </div>
  );
}

function ActivityPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const activityRead = useAccountTransactions(refreshKey);
  const statusCopy = activityStatusCopy(activityRead.status, activityRead.error);

  return (
    <DashboardFrame activeRoute="activity">
      <InnerPageHeader label="ACTIVITY / ON-CHAIN TRAIL" title="A clear chain of events" description="Every account transaction is read from Thru Betanet and kept visible without inventing confirmation states." action={<span className="connected-badge"><i /> {activityRead.transactions.length > 0 ? activityRead.transactions.length + " READ" : "RPC READ"}</span>} />
      <section className="activity-page-card">
        <div className="activity-card-heading"><div><p className="panel-label">RECENT ACTIVITY</p><h2>What happened next</h2></div><span>BETANET / LIVE READ</span></div>
        {activityRead.transactions.length > 0 ? <ActivityTimeline transactions={activityRead.transactions} /> : <ReadStateCard title={statusCopy[0]} description={statusCopy[1]} tone={activityRead.status === "error" ? "error" : "neutral"} loading={activityRead.status === "loading" || activityRead.status === "idle"} onRetry={() => setRefreshKey(key => key + 1)} icon={activityRead.status === "needs-wallet" ? "wallet" : "activity"} action={["needs-wallet", "empty"].includes(activityRead.status) ? <ReadStateAction status={activityRead.status} kind="activity" onRetry={() => setRefreshKey(key => key + 1)} /> : undefined} />}
      </section>
      <section className="trail-callout"><span>ON-CHAIN TRANSPARENCY</span><p>Nothing disappears behind a spinner. When a transaction is submitted, its state and explorer trail remain visible.</p><a href="https://scan.thru.org/" target="_blank" rel="noreferrer">Open Thru explorer</a></section>
    </DashboardFrame>
  );
}

function LearnPage() {
  return (
    <DashboardFrame activeRoute="learn">
      <InnerPageHeader label="LEARN / CAMBRIAN BASICS" title="Start with the living parts" description="A short field guide to wallets, the Betanet faucet, and the actions that shape an organism." />
      <section className="learn-feature"><div><p className="panel-label">FIELD NOTE 01</p><h2>On-chain state, without the command line.</h2><p>Cambrian keeps the mechanics visible while taking care of the ceremony. You choose an action, review the intent, approve it, and watch the result settle on Thru.</p><a className="text-link" href="https://thru.org/docs/" target="_blank" rel="noreferrer">Read Thru documentation</a></div><div className="learn-index"><span>01</span><span>WALLET</span><span>02</span><span>FAUCET</span><span>03</span><span>ORGANISM</span></div></section>
      <section className="learn-grid">
        <article><span>01 / WALLET</span><h2>Your signing boundary</h2><p>Your wallet is the boundary that approves actions. Cambrian makes the account and intent visible before anything is signed.</p></article>
        <article><span>02 / FAUCET</span><h2>Testnet THRU</h2><p>Request native THRU for Betanet actions. The faucet is a network service, not a hidden balance inside the interface.</p></article>
        <article><span>03 / ORGANISM</span><h2>Birth, pulse, evolve</h2><p>An organism is a stateful on-chain object. Each action leaves a trace you can inspect later.</p></article>
      </section>
    </DashboardFrame>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer" aria-label="Cambrian footer">
      <div className="footer-content">
        <div className="footer-intro" data-reveal="up">
          <a className="footer-logo" href="/" aria-label="Cambrian home">
            <img src={footerMarkAsset} width="36" height="36" alt="" />
            <span>CAMBRIAN</span>
          </a>
          <p>A visual wallet for living state on Thru.</p>
        </div>
        <div className="footer-directory">
          <nav className="footer-link-group" aria-label="Cambrian footer navigation">
            <h3>Cambrian</h3>
            <a href="#lifecycle">How it works</a>
            <a href="/app" onClick={(event) => navigateInternal("/app", event)}>Open app</a>
            <a href="/app/activity" onClick={(event) => navigateInternal("/app/activity", event)}>Activity</a>
          </nav>
          <nav className="footer-link-group" aria-label="Thru resources">
            <h3>Thru</h3>
            <a href="https://thru.org/docs/" target="_blank" rel="noreferrer">Documentation</a>
            <a href="https://scan.thru.org/" target="_blank" rel="noreferrer">Betanet explorer</a>
          </nav>
        </div>
      </div>
      <div className="footer-meta">
        <div className="footer-meta-note"><span>© {new Date().getFullYear()} Cambrian</span><span>Betanet · Test assets only</span></div>
        <a className="footer-network" href="https://thru.org/" target="_blank" rel="noreferrer" aria-label="Built on Thru — visit Thru">
          <span className="footer-network-label"><small>Built on</small><strong>Thru</strong></span>
          <img className="footer-thru-logo" src={thruLogoAsset} width="400" height="400" alt="" loading="lazy" decoding="async" />
        </a>
      </div>
    </footer>
  );
}

function LandingLogo() {
  return (
    <a className="landing-logo" href="/" aria-label="Cambrian home">
      <img src={markAsset} width="38" height="38" alt="" />
      <span className="landing-wordmark"><b>CAMBRIAN</b></span>
    </a>
  );
}

const FILM_DURATION = 14_200;

const filmChapters = [
  { eyebrow: "01 / ACCOUNT", title: "Connect Thru Wallet.", copy: "Your account and approvals stay in the official wallet." },
  { eyebrow: "02 / FAUCET", title: "Fund it with test THRU.", copy: "One clear request, followed by a visible balance update." },
  { eyebrow: "03 / APPROVAL", title: "Approve exactly one intent.", copy: "The wallet shows what will be signed before anything leaves it." },
  { eyebrow: "04 / CONFIRMED", title: "CMB-001 is live.", copy: "The resulting object and transaction remain easy to inspect." },
] as const;

type FilmFrame = {
  chapter: number;
  accountReady: boolean;
  faucetFunded: boolean;
  primaryLabel: string;
  primaryPressed: boolean;
  primaryLoading: boolean;
  approvalVisible: boolean;
  approvalPressed: boolean;
  approvalLoading: boolean;
  chainStep: number;
  successVisible: boolean;
  curtainVisible: boolean;
};

function frameAt(time: number): FilmFrame {
  const chapter = time < 3000 ? 0 : time < 6000 ? 1 : time < 9000 ? 2 : 3;
  const accountReady = time >= 2100;
  const faucetFunded = time >= 5000;
  const reviewReady = time >= 5300;

  return {
    chapter,
    accountReady,
    faucetFunded,
    primaryLabel: chapter === 0
      ? accountReady ? "Wallet connected" : "Connect Thru Wallet"
      : chapter === 1
        ? reviewReady ? "Review birth transaction" : "Claim 100 test THRU"
        : chapter === 2 ? "Waiting for wallet" : "View transaction",
    primaryPressed: (time >= 1100 && time < 1360) || (time >= 3340 && time < 3600) || (time >= 5570 && time < 5800),
    primaryLoading: (time >= 1360 && time < 2100) || (time >= 3600 && time < 5000),
    approvalVisible: time >= 6200 && time < 9000,
    approvalPressed: time >= 7440 && time < 7700,
    approvalLoading: time >= 7700 && time < 8660,
    chainStep: time >= 10_900 ? 3 : time >= 10_000 ? 2 : time >= 9200 ? 1 : 0,
    successVisible: time >= 11_050 && time < 13_700,
    curtainVisible: time < 420 || time >= 13_650,
  };
}

function frameKey(frame: FilmFrame) {
  return Object.values(frame).join("|");
}

function balanceAt(time: number) {
  if (time < 3850) return 0;
  if (time >= 5000) return 100;
  const progress = (time - 3850) / 1150;
  const eased = 1 - Math.pow(1 - progress, 3);
  return Math.min(100, eased * 100);
}

function TransactionFilm() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finalFrameTime = 11_800;
  const [frame, setFrame] = useState(() => frameAt(reducedMotion ? finalFrameTime : 0));
  const [playing, setPlaying] = useState(!reducedMotion);
  const balanceRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef(reducedMotion ? finalFrameTime : 0);
  const frameKeyRef = useRef(frameKey(frame));

  useEffect(() => {
    if (!playing) return;

    let animationFrame = 0;
    const origin = performance.now() - elapsedRef.current;
    const tick = (now: number) => {
      const elapsed = (now - origin) % FILM_DURATION;
      elapsedRef.current = elapsed;

      const nextFrame = frameAt(elapsed);
      const nextKey = frameKey(nextFrame);
      if (nextKey !== frameKeyRef.current) {
        frameKeyRef.current = nextKey;
        setFrame(nextFrame);
      }

      if (balanceRef.current) balanceRef.current.textContent = balanceAt(elapsed).toFixed(2);
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${elapsed / FILM_DURATION})`;
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [playing]);

  const chapter = filmChapters[frame.chapter];
  const accountState = frame.accountReady ? "Ready" : "Not created";
  const faucetState = frame.faucetFunded ? "Received" : frame.chapter >= 1 ? "In progress" : "Waiting";
  const birthState = frame.chainStep === 3 ? "Confirmed" : frame.chapter >= 2 ? "In progress" : "Waiting";

  return (
    <div className={`product-film chapter-${frame.chapter} ${playing ? "is-playing" : "is-paused"}`} aria-label="Animated Cambrian account and transaction walkthrough">
      <div className="product-film-head">
        <div className="product-film-brand"><img src={markAsset} width="24" height="24" alt="" /><span>Cambrian</span></div>
        <span className="product-film-caption">Account to on-chain state</span>
        <span className="product-film-network"><i /> Thru Betanet</span>
      </div>

      <div className="product-film-stage" aria-live="off">
        <div className="product-film-interface">
          <section className="film-wallet-card">
            <div className="film-wallet-topline"><span>Your account</span><b className={frame.accountReady ? "is-ready" : ""}><i />{accountState}</b></div>
            <div className={`film-wallet-address ${frame.accountReady ? "is-ready" : ""}`}><span>No wallet connected</span><strong>taDemo…Ac01</strong></div>

            <div className="film-wallet-balance">
              <span>Available balance</span>
              <strong><span ref={balanceRef}>{reducedMotion ? "100.00" : "0.00"}</span><small>THRU</small></strong>
            </div>

            <div className={`film-primary-action ${frame.primaryPressed ? "is-pressed" : ""} ${frame.primaryLoading ? "is-loading" : ""} ${frame.accountReady && frame.chapter === 0 ? "is-complete" : ""} ${frame.faucetFunded ? "is-funded" : ""}`}>
              <span key={frame.primaryLabel}>{frame.primaryLabel}</span><i />
            </div>
          </section>

          <section className="film-intent-card">
            <div className="film-intent-copy" key={frame.chapter}>
              <span>{chapter.eyebrow}</span>
              <h3>{chapter.title}</h3>
              <p>{chapter.copy}</p>
            </div>

            <div className="film-checkpoints">
              <div className={`${frame.accountReady ? "is-complete" : ""} ${frame.chapter === 0 ? "is-current" : ""}`}><i /><span><small>Account</small><strong>{accountState}</strong></span></div>
              <div className={`${frame.faucetFunded ? "is-complete" : ""} ${frame.chapter === 1 ? "is-current" : ""}`}><i /><span><small>Faucet</small><strong>{faucetState}</strong></span></div>
              <div className={`${frame.chainStep === 3 ? "is-complete" : ""} ${frame.chapter >= 2 ? "is-current" : ""}`}><i /><span><small>Birth</small><strong>{birthState}</strong></span></div>
            </div>

            <div className={`film-chain-path step-${frame.chainStep}`}>
              <span><i />Signed</span><span><i />Submitted</span><span><i />Confirmed</span>
            </div>
          </section>

          <div className={`film-approval-layer ${frame.approvalVisible ? "is-visible" : ""}`}>
            <div className="film-approval-modal">
              <div className="film-approval-head"><div><img src={markAsset} width="30" height="30" alt="" /><span><strong>Wallet approval</strong><small>One signature requested</small></span></div><b>Betanet</b></div>
              <h4>Birth CMB-001</h4>
              <dl><div><dt>Account</dt><dd>taDemo…Ac01</dd></div><div><dt>Action</dt><dd>Create organism</dd></div><div><dt>Network</dt><dd>Thru Betanet</dd></div></dl>
              <p>This approval only authorizes the transaction shown here.</p>
              <div className="film-approval-actions"><span>Cancel</span><span className={`approve ${frame.approvalPressed ? "is-pressed" : ""} ${frame.approvalLoading ? "is-loading" : ""}`}><b>Approve transaction</b><i /></span></div>
            </div>
          </div>

          <div className={`film-success-toast ${frame.successVisible ? "is-visible" : ""}`}><i /><span><strong>Transaction confirmed</strong><small>CMB-001 · First Light</small></span><b>0x91D4...7AC2</b></div>
          <div className={`film-loop-curtain ${frame.curtainVisible ? "is-visible" : ""}`} />
        </div>
      </div>

      <div className="product-film-foot">
        <div className="product-film-progress" aria-hidden="true"><span ref={progressRef} /></div>
        <div><span>{String(frame.chapter + 1).padStart(2, "0")} / 04</span><b>{chapter.eyebrow.replace(/^\d+ \/ /, "")}</b><button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? "Pause" : "Play"}</button></div>
      </div>
    </div>
  );
}

function useLandingReveal() {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
}

function LandingPage() {
  useLandingReveal();

  return (
    <div className="landing-page">
      <a className="skip-link" href="#landing-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="site-brand-cluster"><LandingLogo /></div>
          <div className="site-nav-cluster">
            <nav className="site-nav" aria-label="Main navigation">
              <a href="#lifecycle">How it works</a>
              <a href="#trail">Activity</a>
              <a href="https://thru.org/docs/" target="_blank" rel="noreferrer">Docs</a>
            </nav>
            <div className="nav-utility">
              <span className="header-network"><i />Betanet live</span>
              <a className="nav-cta" href="/app" onClick={(event) => navigateInternal("/app", event)}>Open app</a>
            </div>
          </div>
        </div>
      </header>

      <main id="landing-content">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Built on Thru Betanet</p>
            <h1 id="landing-title">Create an account.<br /><span>Bring it to life.</span></h1>
            <p className="hero-description">Cambrian turns Thru's command-line flow into a clear visual wallet. Create an account, request test THRU, and manage a persistent organism from one place.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="/app" onClick={(event) => navigateInternal("/app", event)}>Open Cambrian</a>
              <a className="button button-secondary" href="#lifecycle">See how it works</a>
            </div>
          </div>
          <div className="hero-visual">
            <TransactionFilm />
          </div>
        </section>

        <section className="method-section" id="lifecycle" aria-labelledby="lifecycle-title">
          <div className="method-intro" data-reveal="up">
            <p className="section-index">How it works</p>
            <h2 id="lifecycle-title">From account to organism.</h2>
            <p className="method-description">The network mechanics stay visible without getting in your way. You always know what will be signed and what happened next.</p>
          </div>
          <div className="method-steps">
            <article data-reveal="up"><span className="step-number">1</span><div><h3>Connect Thru Wallet</h3><p>Create or select your account in Thru Wallet, then review every action before approving it.</p></div></article>
            <article className="reveal-delay-1" data-reveal="up"><span className="step-number">2</span><div><h3>Claim test THRU</h3><p>Request Betanet funds, then verify the updated balance in the same view.</p></div></article>
            <article className="reveal-delay-2" data-reveal="up"><span className="step-number">3</span><div><h3>Birth an organism</h3><p>Approve the transaction and watch persistent state resolve from the network.</p></div></article>
          </div>
        </section>

        <section className="evidence-section" id="trail" aria-labelledby="evidence-title">
          <div className="evidence-grid">
            <div className="evidence-copy" data-reveal="up"><p className="section-index">Activity</p><h2 id="evidence-title">Every action stays readable.</h2><p>Transaction state is part of the interface. See what was requested, which account approved it, and when the network confirmed it.</p><a href="https://scan.thru.org/" target="_blank" rel="noreferrer">View Betanet explorer</a></div>
            <div className="trace-panel reveal-delay-1" data-reveal="up">
              <div className="trace-head"><div><span>Recent activity</span><strong>taDemo…Ac01</strong></div><b><i /> Connected</b></div>
              <div className="trace-list">
                <div><i className="trace-dot oxide" /><p><strong>Organism born</strong><span>CMB-001 · First Light</span></p><time>Confirmed · 2m</time></div>
                <div><i className="trace-dot" /><p><strong>Faucet claimed</strong><span>+100 test THRU</span></p><time>Confirmed · 1h</time></div>
                <div><i className="trace-dot quiet" /><p><strong>Wallet connected</strong><span>Thru account ready</span></p><time>Completed · 1h</time></div>
              </div>
              <div className="trace-balance"><span>Available balance</span><strong>12.40 THRU</strong></div>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation);

  useEffect(() => {
    const handlePopState = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <div className={`route-view ${route === "landing" ? "" : "is-dashboard"}`} key={route}>
      {route === "dashboard" && <DashboardPage />}
      {route === "organisms" && <OrganismsPage />}
      {route === "activity" && <ActivityPage />}
      {route === "learn" && <LearnPage />}
      {route === "landing" && <LandingPage />}
    </div>
  );
}
