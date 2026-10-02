import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useThru, useWallet } from "@thru/wallet/react";
import {
  listAccountTransactions,
  listCambrianOrganisms,
  readAccountSnapshot,
  executeBirthTransaction,
  type CambrianOrganismRecord,
  type CambrianTransactionSummary,
  type BirthTransactionStage,
} from "@cambrian/sdk";
import { LocalWalletController, walletMetadata } from "@cambrian/wallet-core";
import { claimFaucet, FaucetApiError } from "./faucet";
import markAsset from "./assets/cambrian-mark.svg";
import footerMarkAsset from "./assets/cambrian-mark-light.svg";
import thruLogoAsset from "./assets/thru-logo.png";
import networkDotAsset from "./assets/hero-organism.svg";
import heroOrganismAsset from "./assets/organisms-thumbnail.svg";
import organismsThumbnailAsset from "./assets/network-dot.svg";
import birthDotAsset from "./assets/activity-birth-dot.svg";
import { appConfig } from "./config";

const localWalletController = new LocalWalletController({ rpcUrl: appConfig.rpcUrl });

function useLocalWallet() {
  return useSyncExternalStore(
    localWalletController.subscribe,
    localWalletController.getSnapshot,
    localWalletController.getServerSnapshot,
  );
}

type Notice = "faucet" | "faucet-submitted" | "faucet-success" | "faucet-error" | "birth" | "birth-submitted" | "birth-success" | "birth-error" | null;
type Route = "landing" | "dashboard" | "organisms" | "activity" | "learn";

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

function NetworkDot({ birth = false }: { birth?: boolean }) {
  return <img className="status-dot" src={birth ? birthDotAsset : networkDotAsset} width="10" height="10" alt="" />;
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
      <div className="network-status">
        <p>NETWORK</p>
        <div>Betanet&nbsp; / &nbsp;Connected <NetworkDot /></div>
      </div>
    </aside>
  );
}

function shortenAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

type WalletChipProps = {
  refreshKey?: number;
  onFaucet?: () => void;
  faucetBusy?: boolean;
};

function WalletChip({ refreshKey = 0, onFaucet, faucetBusy = false }: WalletChipProps) {
  const { isConnected, selectedAccount } = useWallet();
  const { thru, error: sdkError } = useThru();
  const localWallet = useLocalWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWalletError(sdkError?.message ?? null);
  }, [sdkError]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (controlRef.current && !controlRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    const address = localWallet.status === "unlocked" ? localWallet.account?.address : selectedAccount?.address;
    if (!address || !thru) {
      setBalance(null);
      return () => {
        active = false;
      };
    }

    setBalance(null);
    readAccountSnapshot(thru, address)
      .then((account) => {
        if (active) setBalance(account.balance?.toString() ?? "0");
      })
      .catch(() => {
        if (active) setBalance(null);
      });

    return () => {
      active = false;
    };
  }, [localWallet.account?.address, localWallet.status, selectedAccount?.address, thru, refreshKey]);

  const localAddress = localWallet.status === "unlocked" ? localWallet.account?.address : undefined;
  const label = localAddress
    ? shortenAddress(localAddress)
    : selectedAccount && isConnected
      ? shortenAddress(selectedAccount.address)
      : localWallet.status === "locked" ? "Unlock wallet" : "Open wallet";
  const detail = walletError
    ? walletError
    : localAddress
      ? balance === null ? "Reading local balance..." : `Self-custody / ${balance} units`
      : selectedAccount
      ? balance === null ? "Reading balance…" : `Balance ${balance} units`
      : localWallet.status === "locked" ? "Encrypted vault on this device" : "Create or connect account";

  return (
    <div className="wallet-control" ref={controlRef}>
      <button
        className={`wallet-chip ${open ? "is-open" : ""}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}. ${detail}`}
      >
        <div>
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        <span className="wallet-chip-status"><NetworkDot /></span>
      </button>
      {open && <WalletPopover onClose={() => setOpen(false)} refreshKey={refreshKey} onFaucet={onFaucet} faucetBusy={faucetBusy} />}
    </div>
  );
}

type OrganismReadStatus = "idle" | "loading" | "ready" | "empty" | "not-configured" | "error";

interface OrganismReadState {
  status: OrganismReadStatus;
  organisms: CambrianOrganismRecord[];
  unreadableAccounts: Array<{ address: string; reason: string }>;
  error: string | null;
}

function useOrganismCollection(): OrganismReadState {
  const { thru } = useThru();
  const [state, setState] = useState<OrganismReadState>({
    status: appConfig.programId ? "idle" : "not-configured",
    organisms: [],
    unreadableAccounts: [],
    error: null,
  });

  useEffect(() => {
    let active = true;

    if (!appConfig.programId) {
      setState({ status: "not-configured", organisms: [], unreadableAccounts: [], error: null });
      return () => {
        active = false;
      };
    }

    if (!thru) {
      setState((current) => ({ ...current, status: "idle", error: null }));
      return () => {
        active = false;
      };
    }

    setState({ status: "loading", organisms: [], unreadableAccounts: [], error: null });
    listCambrianOrganisms(thru, appConfig)
      .then((result) => {
        if (!active) return;
        setState({
          status: result.organisms.length > 0 ? "ready" : "empty",
          organisms: result.organisms,
          unreadableAccounts: result.unreadableAccounts,
          error: null,
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "error",
          organisms: [],
          unreadableAccounts: [],
          error: error instanceof Error ? error.message : "Could not read Cambrian organisms",
        });
      });

    return () => {
      active = false;
    };
  }, [thru]);

  return state;
}

type ActivityReadStatus = "idle" | "loading" | "ready" | "empty" | "needs-wallet" | "error";

interface ActivityReadState {
  status: ActivityReadStatus;
  transactions: CambrianTransactionSummary[];
  error: string | null;
}

function useAccountTransactions(): ActivityReadState {
  const { thru } = useThru();
  const { selectedAccount } = useWallet();
  const localWallet = useLocalWallet();
  const address = localWallet.status === "unlocked" ? localWallet.account?.address : selectedAccount?.address;
  const [state, setState] = useState<ActivityReadState>({
    status: address ? "idle" : "needs-wallet",
    transactions: [],
    error: null,
  });

  useEffect(() => {
    let active = true;

    if (!address) {
      setState({ status: "needs-wallet", transactions: [], error: null });
      return () => {
        active = false;
      };
    }

    if (!thru) {
      setState({ status: "idle", transactions: [], error: null });
      return () => {
        active = false;
      };
    }

    setState({ status: "loading", transactions: [], error: null });
    listAccountTransactions(thru, address)
      .then((result) => {
        if (!active) return;
        setState({
          status: result.transactions.length > 0 ? "ready" : "empty",
          transactions: result.transactions,
          error: null,
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "error",
          transactions: [],
          error: error instanceof Error ? error.message : "Could not read account activity",
        });
      });

    return () => {
      active = false;
    };
  }, [address, localWallet.status, thru]);

  return state;
}

function ReadStateCard({ title, description, tone = "neutral" }: { title: string; description: string; tone?: "neutral" | "error" }) {
  return (
    <div className={"data-state-card " + (tone === "error" ? "is-error" : "")} role={tone === "error" ? "alert" : undefined}>
      <span>READ-ONLY NETWORK DATA</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function organismStatusCopy(status: OrganismReadStatus, error: string | null) {
  if (status === "not-configured") return ["Deployment pending", "Set the fresh Cambrian program ID before querying organism accounts."] as const;
  if (status === "loading") return ["Reading Betanet", "Looking for accounts owned by the configured Cambrian program."] as const;
  if (status === "empty") return ["No organisms found", "The Betanet query returned no Cambrian organism accounts yet."] as const;
  if (status === "error") return ["Read failed", error ?? "The Betanet read request could not be completed."] as const;
  return ["No organism data", "Create an organism through the wallet to make state available here."] as const;
}

function activityStatusCopy(status: ActivityReadStatus, error: string | null) {
  if (status === "needs-wallet") return ["Connect a wallet", "Account activity appears after a wallet address is selected."] as const;
  if (status === "loading") return ["Reading account trail", "Loading transactions from the Thru Betanet RPC."] as const;
  if (status === "empty") return ["No transactions yet", "This account has no transaction records returned by the Betanet query."] as const;
  if (status === "error") return ["Read failed", error ?? "The account activity request could not be completed."] as const;
  return ["No activity data", "Select a wallet account to read its transaction trail."] as const;
}

function birthStageLabel(stage: BirthTransactionStage | null | undefined) {
  if (!stage) return "Birth new organism";
  if (stage === "awaiting-approval") return "Approve in wallet";
  if (stage === "preparing") return "Preparing birth";
  if (stage === "signed") return "Wallet approved";
  if (stage === "submitting") return "Submitting birth";
  if (stage === "submitted") return "Birth submitted";
  if (stage === "confirmed") return "Birth confirmed";
  return "Birth failed";
}

function EcosystemStage({ onBirth, birthStage }: { onBirth: () => void; birthStage?: BirthTransactionStage | null }) {
  return (
    <section className="ecosystem-stage" aria-labelledby="ecosystem-title">
      <div className="stage-copy">
        <p className="stage-label">ON-CHAIN LIFEFORM</p>
        <h2 id="ecosystem-title">One organism is alive.</h2>
        <p className="stage-description">Pulse it, watch it mutate, and keep its state anchored to Thru.</p>
        <p className="stage-meta">LAST PULSE&nbsp; / &nbsp;18 SLOTS AGO</p>
      </div>
      <div className="stage-viewer">
        <img src={heroOrganismAsset} width="210" height="190" alt="Cambrian organism viewer" />
        <p>3D VIEWER&nbsp; / &nbsp;PHASE 1</p>
      </div>
      <button className="birth-button" type="button" onClick={onBirth} disabled={Boolean(birthStage)} aria-live="polite">
        {birthStageLabel(birthStage)}
      </button>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function OrganismsPanel({ organism, status, error }: { organism?: CambrianOrganismRecord; status: OrganismReadStatus; error: string | null }) {
  const state = organism?.state;
  const statusCopy = organismStatusCopy(status, error);

  return (
    <section className="organisms-panel" id="organisms" aria-labelledby="organisms-title">
      <p className="panel-label">YOUR ORGANISMS</p>
      {organism && state ? (
        <>
          <h2 id="organisms-title">Cambrian organism</h2>
          <p className="organism-meta">GENERATION {state.generation}&nbsp; / &nbsp;PULSES {state.pulseCount.toString()}&nbsp; / &nbsp;{shortenAddress(organism.address)}</p>
          <p className="organism-description">Live account data read from the Cambrian program on Thru Betanet. The organism viewer will become state-driven after the read model is stable.</p>
        </>
      ) : (
        <div className="organism-read-state">
          <h2 id="organisms-title">{statusCopy[0]}</h2>
          <p className="organism-description">{statusCopy[1]}</p>
        </div>
      )}
      {organism && <img className="organisms-thumbnail" src={organismsThumbnailAsset} width="82" height="82" alt="Cambrian organism thumbnail" />}
    </section>
  );
}

function ActivityPanel({ transactions, status, error }: { transactions: CambrianTransactionSummary[]; status: ActivityReadStatus; error: string | null }) {
  const statusCopy = activityStatusCopy(status, error);

  return (
    <section className="activity-panel" id="activity" aria-labelledby="activity-title">
      <p className="panel-label" id="activity-title">RECENT ACTIVITY</p>
      {transactions.length > 0 ? transactions.slice(0, 3).map((transaction, index) => (
        <div className="activity-row" key={transaction.signature || transaction.program + "-" + index}>
          <NetworkDot birth={index === 0} />
          <div>
            <strong>Transaction</strong>
            <span>{transaction.signature ? shortenAddress(transaction.signature) : "Signature unavailable"}&nbsp; / &nbsp;{transaction.slot ? "slot " + transaction.slot.toString() : "pending slot"}</span>
          </div>
        </div>
      )) : (
        <div className="activity-read-state">
          <strong>{statusCopy[0]}</strong>
          <span>{statusCopy[1]}</span>
        </div>
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
      <div className="footer-bottom"><span>THRU BETANET / CONNECTED</span><span>Readable interfaces for living state.</span></div>
    </footer>
  );
}

function noticeCopy(notice: Notice, detail?: string | null) {
  if (notice === "faucet-submitted") return detail ?? "Faucet request submitted. Waiting for the Betanet balance to update.";
  if (notice === "faucet-success") return detail ?? "Faucet funds confirmed by the Betanet provider.";
  if (notice === "faucet-error") return detail ?? "Faucet request could not be completed.";
  if (notice === "birth") return "Birth requires a configured Cambrian Betanet deployment.";
  if (notice === "birth-submitted") return "Birth was submitted. Waiting for the Betanet execution result.";
  if (notice === "birth-success") return "Birth transaction confirmed by the Betanet RPC.";
  if (notice === "birth-error") return "Birth could not be completed. Check the wallet approval and Betanet state.";
  return "Native faucet endpoint is not configured yet.";
}

function DashboardFrame({ activeRoute, children, notice, noticeDetail, onDismiss }: { activeRoute: Exclude<Route, "landing">; children: ReactNode; notice?: Notice; noticeDetail?: string | null; onDismiss?: () => void }) {
  return (
    <div className="dashboard-shell">
      <Sidebar activeRoute={activeRoute} />
      <main className="dashboard-main">
        {children}
        <DashboardFooter />
      </main>
      {notice && (
        <div className="notice" role="status">
          <span>{noticeCopy(notice, noticeDetail)}</span>
          <button type="button" onClick={onDismiss} aria-label="Dismiss notification">&times;</button>
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  const [notice, setNotice] = useState<Notice>(null);
  const [noticeDetail, setNoticeDetail] = useState<string | null>(null);
  const [birthStage, setBirthStage] = useState<BirthTransactionStage | null>(null);
  const [faucetStage, setFaucetStage] = useState<"idle" | "requesting">("idle");
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const { thru } = useThru();
  const { wallet, selectedAccount, isConnected } = useWallet();
  const localWallet = useLocalWallet();
  const localSigner = localWallet.status === "unlocked" ? localWalletController.getSigner() : null;
  const activeSigner = localSigner ?? (wallet && isConnected ? wallet : null);
  const activeAddress = localSigner?.account.address ?? (selectedAccount && isConnected ? selectedAccount.address : null);
  const organismRead = useOrganismCollection();
  const activityRead = useAccountTransactions();
  const organism = organismRead.organisms[0];

  const handleBirth = async () => {
    if (birthStage) return;

    if (!appConfig.programId || !appConfig.abiId) {
      setNotice("birth");
      setNoticeDetail(null);
      return;
    }

    if (!thru || !activeSigner || !activeAddress) {
      setNotice("birth-error");
      setNoticeDetail("Create or unlock a wallet before approving a birth transaction.");
      return;
    }

    setNotice(null);
    setNoticeDetail(null);
    try {
      const result = await executeBirthTransaction(thru, appConfig, activeSigner, {
        walletAddress: activeAddress,
        seed: `birth-${Date.now()}`,
        onUpdate: ({ stage }) => setBirthStage(stage),
      });
      setNotice(result.stage === "confirmed" ? "birth-success" : "birth-submitted");
    } catch (error) {
      console.error("[Cambrian] birth transaction failed", error);
      setNotice("birth-error");
      setNoticeDetail(error instanceof Error ? error.message : null);
    } finally {
      setBirthStage(null);
    }
  };

  const handleFaucet = async () => {
    if (faucetStage === "requesting") return;
    if (!activeAddress) {
      setNotice("faucet-error");
      setNoticeDetail("Create or unlock a wallet before requesting native Betanet funds.");
      return;
    }

    setFaucetStage("requesting");
    setNotice(null);
    setNoticeDetail(null);
    try {
      const receipt = await claimFaucet(activeAddress);
      setBalanceRefreshKey((current) => current + 1);
      if (receipt.status === "confirmed") {
        setNotice("faucet-success");
        setNoticeDetail("Faucet confirmed " + receipt.amount + " native units.");
      } else {
        setNotice("faucet-submitted");
        setNoticeDetail("Faucet accepted the request. Balance will update after Betanet settlement.");
      }
    } catch (error) {
      const detail = error instanceof FaucetApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Faucet request failed.";
      setNotice("faucet-error");
      setNoticeDetail(detail);
    } finally {
      setFaucetStage("idle");
    }
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
        <div className="header-actions">
          <button className="faucet-button" type="button" onClick={handleFaucet} disabled={faucetStage === "requesting"} aria-busy={faucetStage === "requesting"}>
            {faucetStage === "requesting" ? "Requesting..." : "Get faucet"}
          </button>
          <WalletChip refreshKey={balanceRefreshKey} onFaucet={handleFaucet} faucetBusy={faucetStage === "requesting"} />
        </div>
      </header>

      <EcosystemStage onBirth={handleBirth} birthStage={birthStage} />

      <section className="signal-section" aria-labelledby="signal-title">
        <h2 id="signal-title">Signal</h2>
        <div className="stats-grid">
          <StatCard label="Energy" value={organism ? organism.state.energy.toString() : "—"} />
          <StatCard label="Vitality" value={organism ? organism.state.vitality.toString() : "—"} />
          <StatCard label="On-chain actions" value={activityRead.transactions.length > 0 ? activityRead.transactions.length.toString() : "—"} />
        </div>
      </section>

      <div className="dashboard-panels">
        <OrganismsPanel organism={organism} status={organismRead.status} error={organismRead.error} />
        <ActivityPanel transactions={activityRead.transactions} status={activityRead.status} error={activityRead.error} />
      </div>
    </DashboardFrame>
  );
}

type WalletPopoverAction = "connect" | "manage" | "disconnect" | "create" | "restore" | "unlock" | null;

type WalletPopoverProps = {
  onClose: () => void;
  refreshKey?: number;
  onFaucet?: () => void;
  faucetBusy?: boolean;
};

function WalletPopover({ onClose, refreshKey = 0, onFaucet, faucetBusy = false }: WalletPopoverProps) {
  const localWallet = useLocalWallet();
  const { thru, error: sdkError } = useThru();
  const { connect, manageAccounts, disconnect, isConnected, isConnecting, selectedAccount } = useWallet();
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [action, setAction] = useState<WalletPopoverAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLocalSetup, setShowLocalSetup] = useState(false);

  const localAddress = localWallet.status === "unlocked" ? localWallet.account?.address ?? null : null;
  const hostedConnected = Boolean(isConnected && selectedAccount);
  const hostedAddress = hostedConnected ? selectedAccount?.address ?? null : null;
  const address = localAddress ?? hostedAddress;
  const usingLocalWallet = Boolean(localAddress);
  const showSetup = localWallet.status === "absent" && (!hostedConnected || showLocalSetup);

  useEffect(() => {
    setError(sdkError?.message ?? null);
  }, [sdkError]);

  useEffect(() => {
    let active = true;
    if (!address || !thru) {
      setBalance(null);
      return () => {
        active = false;
      };
    }

    setBalance(null);
    readAccountSnapshot(thru, address)
      .then((account) => {
        if (active) setBalance(account.balance?.toString() ?? "0");
      })
      .catch(() => {
        if (active) setBalance(null);
      });

    return () => {
      active = false;
    };
  }, [address, thru, refreshKey]);

  const runAction = async (nextAction: Exclude<WalletPopoverAction, null>) => {
    if (action) return;
    setAction(nextAction);
    setError(null);
    setFeedback(null);
    try {
      if (nextAction === "create") {
        if (password !== confirmPassword) throw new Error("Wallet passwords do not match");
        const result = await localWalletController.create(password);
        setRecoveryPhrase(result.recoveryPhrase);
        setPassword("");
        setConfirmPassword("");
        setFeedback("Wallet created on this device.");
      } else if (nextAction === "restore") {
        const restored = await localWalletController.restore(phrase, password);
        setPhrase("");
        setPassword("");
        setRecoveryPhrase(null);
        setFeedback(`Restored ${shortenAddress(restored.address)}.`);
      } else if (nextAction === "unlock") {
        await localWalletController.unlock(password);
        setPassword("");
        setFeedback("Local wallet unlocked.");
      } else if (nextAction === "connect") {
        await connect({ metadata: walletMetadata, passkeyName: "Cambrian" });
      } else if (nextAction === "manage") {
        await manageAccounts();
      } else {
        await disconnect();
        setFeedback("Thru Wallet disconnected.");
      }
    } catch (nextError) {
      setError(nextError instanceof Error && nextError.message ? nextError.message : "Wallet action failed");
      console.error("[Cambrian] wallet popover action failed", nextError);
    } finally {
      setAction(null);
    }
  };

  const copy = async (value: string, successMessage: string) => {
    if (!navigator.clipboard) {
      setError("Clipboard is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFeedback(successMessage);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction(localWallet.status === "locked" ? "unlock" : mode);
  };

  const stateLabel = action === "connect"
    ? "Opening Thru Wallet"
    : action === "manage"
      ? "Loading accounts"
      : localAddress
        ? "Self-custody"
        : hostedConnected
          ? "Connected"
          : localWallet.status === "locked"
            ? "Locked"
            : isConnecting
              ? "Connecting"
              : "Not connected";

  return (
    <section className="wallet-popover" role="dialog" aria-label="Cambrian wallet">
      <header className="wallet-popover-head">
        <div className="wallet-popover-brand">
          <img src={markAsset} width="28" height="28" alt="" />
          <span><strong>CAMBRIAN WALLET</strong><small>Thru Betanet</small></span>
        </div>
        <button className="wallet-popover-close" type="button" onClick={onClose} aria-label="Close wallet">&times;</button>
      </header>

      <div className="wallet-popover-network">
        <span><i /> Thru Betanet</span>
        <b>{stateLabel}</b>
      </div>

      {address && (
        <div className="wallet-popover-account">
          <div className="wallet-account-avatar" aria-hidden="true">C</div>
          <div className="wallet-popover-account-copy">
            <span>{usingLocalWallet ? "LOCAL ACCOUNT" : "THRU WALLET ACCOUNT"}</span>
            <strong>{shortenAddress(address)}</strong>
            <button type="button" onClick={() => void copy(address, "Address copied.")} aria-label="Copy wallet address">{copied ? "Copied" : "Copy address"}</button>
          </div>
          <i className="wallet-popover-online" aria-label="Account available" />
        </div>
      )}

      {address && (
        <div className="wallet-popover-balance">
          <div><span>AVAILABLE BALANCE</span><strong>{balance ?? "—"}</strong></div>
          <small>THRU<br />BETANET</small>
        </div>
      )}

      {recoveryPhrase && (
        <div className="wallet-popover-recovery" role="status">
          <span>BACK UP BEFORE CONTINUING</span>
          <strong>Your recovery phrase</strong>
          <code>{recoveryPhrase}</code>
          <p>Write it down offline. Cambrian cannot recover this wallet.</p>
          <button className="wallet-popover-secondary" type="button" onClick={() => void copy(recoveryPhrase, "Recovery phrase copied.")}>{copied ? "Copied" : "Copy phrase"}</button>
        </div>
      )}

      {localWallet.status === "unlocked" && localAddress ? (
        <div className="wallet-popover-actions">
          {onFaucet && <button className="wallet-popover-primary" type="button" onClick={onFaucet} disabled={faucetBusy}>{faucetBusy ? "Requesting..." : "Get faucet"}</button>}
          <button className="wallet-popover-secondary" type="button" onClick={() => void copy(localAddress, "Address copied.")} disabled={Boolean(action)}>{copied ? "Address copied" : "Copy address"}</button>
          <button className="wallet-popover-link" type="button" onClick={() => { localWalletController.lock(); setRecoveryPhrase(null); setFeedback("Local wallet locked."); }} disabled={Boolean(action)}>Lock wallet</button>
        </div>
      ) : localWallet.status === "locked" ? (
        <form className="wallet-popover-form" onSubmit={submit}>
          <label>Vault password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /></label>
          <button className="wallet-popover-primary" type="submit" disabled={action === "unlock"}>{action === "unlock" ? "Unlocking..." : "Unlock local wallet"}</button>
          <small>The private key is decrypted only in memory while unlocked.</small>
        </form>
      ) : localWallet.status === "loading" ? (
        <div className="wallet-popover-loading"><span className="wallet-popover-spinner" />Checking this device...</div>
      ) : showSetup ? (
        <form className="wallet-popover-form" onSubmit={submit}>
          <div className="wallet-popover-tabs" role="tablist" aria-label="Wallet setup">
            <button type="button" className={mode === "create" ? "is-active" : ""} onClick={() => { setMode("create"); setError(null); }}>Create new</button>
            <button type="button" className={mode === "restore" ? "is-active" : ""} onClick={() => { setMode("restore"); setError(null); }}>Restore phrase</button>
          </div>
          {mode === "restore" && <label>Recovery phrase<textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="Enter your 12-word phrase" autoComplete="off" required /></label>}
          <div className="wallet-popover-fields">
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
            {mode === "create" && <label>Confirm<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>}
          </div>
          <button className="wallet-popover-primary" type="submit" disabled={action === mode}>{action === mode ? mode === "create" ? "Creating..." : "Restoring..." : mode === "create" ? "Create local wallet" : "Restore wallet"}</button>
          <small>Your recovery phrase is the only way to recover this account on another device.</small>
        </form>
      ) : null}

      {hostedConnected && !localAddress && (
        <div className="wallet-popover-actions wallet-popover-hosted-actions">
          <button className="wallet-popover-primary" type="button" onClick={() => void runAction("manage")} disabled={Boolean(action)}>{action === "manage" ? "Loading..." : "Manage account"}</button>
          {hostedAddress && <button className="wallet-popover-secondary" type="button" onClick={() => void copy(hostedAddress, "Address copied.")} disabled={Boolean(action)}>{copied ? "Address copied" : "Copy address"}</button>}
          <button className="wallet-popover-link" type="button" onClick={() => void runAction("disconnect")} disabled={Boolean(action)}>Disconnect</button>
        </div>
      )}

      {localWallet.status === "absent" && hostedConnected && !showLocalSetup && (
        <button className="wallet-popover-switch" type="button" onClick={() => setShowLocalSetup(true)}>Create a self-custody wallet</button>
      )}

      {!hostedConnected && localWallet.status !== "unlocked" && localWallet.status !== "loading" && (
        <button className="wallet-popover-thru" type="button" onClick={() => void runAction("connect")} disabled={Boolean(action)}>{action === "connect" ? "Opening Thru Wallet..." : "Use Thru Wallet instead"}</button>
      )}

      {(error || localWallet.error) && <p className="wallet-popover-error" role="alert">{error ?? localWallet.error}</p>}
      {feedback && <p className="wallet-popover-feedback" role="status">{feedback}</p>}
      <p className="wallet-popover-note">Cambrian only builds the intent. Your selected wallet approves the transaction.</p>
    </section>
  );
}

function InnerPageHeader({ label, title, description, action }: { label: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="inner-page-header">
      <div><p className="page-label">{label}</p><h1>{title}</h1><p>{description}</p></div>
      {action && <div className="inner-page-action">{action}</div>}
    </header>
  );
}

function OrganismsPage() {
  const organismRead = useOrganismCollection();
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
              <p className="panel-label">SELECTED ORGANISM / {shortenAddress(organism.address)}</p>
              <h2 id="focus-organism-title">Cambrian organism</h2>
              <p>Live state decoded from the account data owned by the configured Cambrian program.</p>
              <div className="focus-meta">
                <span>GENERATION <b>{organism.state.generation}</b></span>
                <span>PULSES <b>{organism.state.pulseCount.toString()}</b></span>
                <span>ACCOUNT <b>{shortenAddress(organism.address)}</b></span>
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
        <ReadStateCard title={statusCopy[0]} description={statusCopy[1]} tone={organismRead.status === "error" ? "error" : "neutral"} />
      )}
    </DashboardFrame>
  );
}

function ActivityTimeline({ transactions }: { transactions: CambrianTransactionSummary[] }) {
  return (
    <div className="activity-timeline">
      {transactions.map((transaction, index) => (
        <div className="timeline-item" key={transaction.signature || transaction.program + "-" + index}>
          <div className="timeline-marker"><NetworkDot /></div>
          <div className="timeline-copy">
            <strong>Transaction</strong>
            <span>{transaction.signature ? shortenAddress(transaction.signature) : "Signature unavailable"} / {shortenAddress(transaction.program)}</span>
            <small>{transaction.slot ? "Slot " + transaction.slot.toString() : "Slot unavailable"} / {transaction.instructionBytes} instruction bytes</small>
          </div>
          <a href={appConfig.explorerUrl} target="_blank" rel="noreferrer">Open explorer</a>
        </div>
      ))}
    </div>
  );
}

function ActivityPage() {
  const activityRead = useAccountTransactions();
  const statusCopy = activityStatusCopy(activityRead.status, activityRead.error);

  return (
    <DashboardFrame activeRoute="activity">
      <InnerPageHeader label="ACTIVITY / ON-CHAIN TRAIL" title="A clear chain of events" description="Every account transaction is read from Thru Betanet and kept visible without inventing confirmation states." action={<span className="connected-badge"><i /> {activityRead.transactions.length > 0 ? activityRead.transactions.length + " READ" : "RPC READ"}</span>} />
      <section className="activity-page-card">
        <div className="activity-card-heading"><div><p className="panel-label">RECENT ACTIVITY</p><h2>What happened next</h2></div><span>BETANET / LIVE READ</span></div>
        {activityRead.transactions.length > 0 ? <ActivityTimeline transactions={activityRead.transactions} /> : <ReadStateCard title={statusCopy[0]} description={statusCopy[1]} tone={activityRead.status === "error" ? "error" : "neutral"} />}
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
  { eyebrow: "01 / ACCOUNT", title: "Create a local account.", copy: "The signing boundary is generated on this device." },
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
      ? accountReady ? "Account created" : "Create local account"
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
            <div className={`film-wallet-address ${frame.accountReady ? "is-ready" : ""}`}><span>No local account</span><strong>0x7E1A...B42C</strong></div>

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
              <dl><div><dt>Account</dt><dd>0x7E1A...B42C</dd></div><div><dt>Action</dt><dd>Create organism</dd></div><div><dt>Network</dt><dd>Thru Betanet</dd></div></dl>
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
            <article data-reveal="up"><span className="step-number">1</span><div><h3>Create your account</h3><p>Generate a wallet and see its address before any action is approved.</p></div></article>
            <article className="reveal-delay-1" data-reveal="up"><span className="step-number">2</span><div><h3>Claim test THRU</h3><p>Request Betanet funds, then verify the updated balance in the same view.</p></div></article>
            <article className="reveal-delay-2" data-reveal="up"><span className="step-number">3</span><div><h3>Birth an organism</h3><p>Approve the transaction and watch persistent state resolve from the network.</p></div></article>
          </div>
        </section>

        <section className="evidence-section" id="trail" aria-labelledby="evidence-title">
          <div className="evidence-grid">
            <div className="evidence-copy" data-reveal="up"><p className="section-index">Activity</p><h2 id="evidence-title">Every action stays readable.</h2><p>Transaction state is part of the interface. See what was requested, which account approved it, and when the network confirmed it.</p><a href="https://scan.thru.org/" target="_blank" rel="noreferrer">View Betanet explorer</a></div>
            <div className="trace-panel reveal-delay-1" data-reveal="up">
              <div className="trace-head"><div><span>Recent activity</span><strong>0x7E1A...B42C</strong></div><b><i /> Connected</b></div>
              <div className="trace-list">
                <div><i className="trace-dot oxide" /><p><strong>Organism born</strong><span>CMB-001 · First Light</span></p><time>Confirmed · 2m</time></div>
                <div><i className="trace-dot" /><p><strong>Faucet claimed</strong><span>+100 test THRU</span></p><time>Confirmed · 1h</time></div>
                <div><i className="trace-dot quiet" /><p><strong>Wallet created</strong><span>Local account ready</span></p><time>Completed · 1h</time></div>
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
    <div className="route-view" key={route}>
      {route === "dashboard" && <DashboardPage />}
      {route === "organisms" && <OrganismsPage />}
      {route === "activity" && <ActivityPage />}
      {route === "learn" && <LearnPage />}
      {route === "landing" && <LandingPage />}
    </div>
  );
}
