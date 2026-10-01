import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AccountView } from "@thru/sdk";
import { useThru, useWallet } from "@thru/wallet/react";
import { walletMetadata } from "@cambrian/wallet-core";
import markAsset from "./assets/cambrian-mark.svg";
import networkDotAsset from "./assets/hero-organism.svg";
import heroOrganismAsset from "./assets/organisms-thumbnail.svg";
import organismsThumbnailAsset from "./assets/network-dot.svg";
import birthDotAsset from "./assets/activity-birth-dot.svg";

type Notice = "faucet" | "birth" | null;
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

function WalletChip() {
  const { connect, manageAccounts, isConnected, isConnecting, selectedAccount } = useWallet();
  const { thru, error: sdkError } = useThru();
  const [balance, setBalance] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    if (sdkError) setWalletError(sdkError.message);
  }, [sdkError]);

  useEffect(() => {
    let active = true;
    const address = selectedAccount?.address;
    if (!address || !thru) {
      setBalance(null);
      return () => {
        active = false;
      };
    }

    setBalance(null);
    thru.accounts.get(address, { view: AccountView.META_ONLY })
      .then((account) => {
        if (active) setBalance(account.meta?.balance.toString() ?? "0");
      })
      .catch(() => {
        if (active) setBalance(null);
      });

    return () => {
      active = false;
    };
  }, [selectedAccount?.address, thru]);

  const handleWalletClick = async () => {
    if (actionPending) return;
    setActionPending(true);
    setWalletError(null);
    try {
      if (isConnected) {
        await manageAccounts();
      } else {
        await connect({ metadata: walletMetadata, passkeyName: "Cambrian" });
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Wallet request failed";
      setWalletError(message);
      console.error("[Cambrian] wallet connect failed", error);
    } finally {
      setActionPending(false);
    }
  };

  const label = actionPending
    ? "Opening wallet…"
    : selectedAccount
      ? shortenAddress(selectedAccount.address)
      : "Create or connect wallet";
  const detail = walletError
    ? walletError
    : selectedAccount
      ? balance === null ? "Reading balance…" : `Balance ${balance} units`
      : isConnecting ? "Preparing Thru Betanet…" : "Thru Betanet";

  return (
    <button className="wallet-chip" type="button" onClick={handleWalletClick} aria-label={`${label}. ${detail}`}>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <NetworkDot />
    </button>
  );
}

function EcosystemStage({ onBirth }: { onBirth: () => void }) {
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
      <button className="birth-button" type="button" onClick={onBirth}>Birth new organism</button>
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

function OrganismsPanel() {
  return (
    <section className="organisms-panel" id="organisms" aria-labelledby="organisms-title">
      <p className="panel-label">YOUR ORGANISMS</p>
      <h2 id="organisms-title">CMB-001 / First Light</h2>
      <p className="organism-meta">GENES 78&nbsp; / &nbsp;MEMORY 41&nbsp; / &nbsp;CONTROLLER YOU</p>
      <p className="organism-description">A small, stable read model first. The richer 3D organism can grow as the chain state becomes useful.</p>
      <img className="organisms-thumbnail" src={organismsThumbnailAsset} width="82" height="82" alt="First Light organism thumbnail" />
    </section>
  );
}

function ActivityPanel() {
  return (
    <section className="activity-panel" id="activity" aria-labelledby="activity-title">
      <p className="panel-label" id="activity-title">RECENT ACTIVITY</p>
      <div className="activity-row"><NetworkDot birth /><div><strong>Birth</strong><span>confirmed&nbsp; / &nbsp;2m</span></div></div>
      <div className="activity-row"><NetworkDot /><div><strong>Pulse</strong><span>confirmed&nbsp; / &nbsp;8m</span></div></div>
      <div className="activity-row"><NetworkDot /><div><strong>Faucet</strong><span>confirmed&nbsp; / &nbsp;1h</span></div></div>
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

function DashboardFrame({ activeRoute, children, notice, onDismiss }: { activeRoute: Exclude<Route, "landing">; children: ReactNode; notice?: Notice; onDismiss?: () => void }) {
  return (
    <div className="dashboard-shell">
      <Sidebar activeRoute={activeRoute} />
      <main className="dashboard-main">
        {children}
        <DashboardFooter />
      </main>
      {notice && (
        <div className="notice" role="status">
          <span>{notice === "birth" ? "Birth is waiting for a verified Cambrian Betanet deployment." : "Native faucet endpoint is waiting for Betanet verification."}</span>
          <button type="button" onClick={onDismiss} aria-label="Dismiss notification">&times;</button>
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  const [notice, setNotice] = useState<Notice>(null);

  return (
    <DashboardFrame activeRoute="dashboard" notice={notice} onDismiss={() => setNotice(null)}>
      <header className="dashboard-header" id="overview">
        <div>
          <p className="page-label">OVERVIEW&nbsp; / &nbsp;CAMBRIAN LIFEFORM</p>
          <h1>Your ecosystem</h1>
        </div>
        <div className="header-actions">
          <button className="faucet-button" type="button" onClick={() => setNotice("faucet")}>Get faucet</button>
          <WalletChip />
        </div>
      </header>

      <EcosystemStage onBirth={() => setNotice("birth")} />

      <section className="signal-section" aria-labelledby="signal-title">
        <h2 id="signal-title">Signal</h2>
        <div className="stats-grid">
          <StatCard label="Energy" value="84" />
          <StatCard label="Vitality" value="92" />
          <StatCard label="On-chain actions" value="12" />
        </div>
      </section>

      <div className="dashboard-panels">
        <OrganismsPanel />
        <ActivityPanel />
      </div>
    </DashboardFrame>
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
  return (
    <DashboardFrame activeRoute="organisms">
      <InnerPageHeader
        label="ORGANISMS / COLLECTION"
        title="The living collection"
        description="Track the organisms you have brought to life and the state they carry across the Thru Betanet."
        action={<button className="oxide-button" type="button">Birth new organism</button>}
      />
      <section className="organism-focus-card" aria-labelledby="focus-organism-title">
        <div><p className="panel-label">SELECTED ORGANISM / CMB-001</p><h2 id="focus-organism-title">First Light</h2><p>A stable first form with room to evolve. Its identity, memory, and controller remain legible at every step.</p><div className="focus-meta"><span>GENES <b>78</b></span><span>MEMORY <b>41</b></span><span>PHASE <b>01</b></span></div></div>
        <div className="focus-organism-view"><img src={heroOrganismAsset} width="210" height="190" alt="First Light organism" /><span>3D VIEWER / PHASE 1</span></div>
      </section>
      <section className="trait-section" aria-label="Organism traits">
        <article><span>ENERGY</span><strong>84</strong><p>Available for the next pulse.</p></article>
        <article><span>VITALITY</span><strong>92</strong><p>Stable across the last 18 slots.</p></article>
        <article><span>CONTROLLER</span><strong>YOU</strong><p>Access stays with your wallet.</p></article>
      </section>
      <section className="collection-note"><p className="panel-label">NEXT TRACE</p><h2>Every pulse leaves a readable mark.</h2><p>Use Activity to inspect the full trail, or return here when you are ready to grow the collection.</p></section>
    </DashboardFrame>
  );
}

function ActivityTimeline() {
  const events = [
    ["Birth", "CMB-001 / First Light", "Confirmed / 2 minutes ago", true],
    ["Pulse", "Energy +4 / Vitality +2", "Confirmed / 8 minutes ago", false],
    ["Faucet", "100 THRU testnet allocation", "Confirmed / 1 hour ago", false],
    ["Wallet created", "0x7E1A...B42C", "Confirmed / 1 hour ago", false],
  ] as const;
  return <div className="activity-timeline">{events.map(([title, detail, time, birth]) => <div className="timeline-item" key={title}><div className={`timeline-marker ${birth ? "birth" : ""}`}><NetworkDot birth={birth} /></div><div className="timeline-copy"><strong>{title}</strong><span>{detail}</span><small>{time}</small></div><a href="https://scan.thru.org/" target="_blank" rel="noreferrer">View details</a></div>)}</div>;
}

function ActivityPage() {
  return (
    <DashboardFrame activeRoute="activity">
      <InnerPageHeader label="ACTIVITY / ON-CHAIN TRAIL" title="A clear chain of events" description="Every approval, faucet claim, and organism action is kept in one readable trail." action={<span className="connected-badge"><i /> 4 CONFIRMED</span>} />
      <section className="activity-page-card"><div className="activity-card-heading"><div><p className="panel-label">RECENT ACTIVITY</p><h2>What happened next</h2></div><span>BETANET / LIVE READ</span></div><ActivityTimeline /></section>
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
    <footer className="landing-footer" data-reveal="fade">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand"><img src={markAsset} width="42" height="42" alt="" /><div><strong>CAMBRIAN</strong><p>A visual wallet for living state on Thru.</p></div></div>
        <div className="landing-footer-links"><div><span>CAMBRIAN</span><a href="#lifecycle">How it works</a><a href="/app" onClick={(event) => navigateInternal("/app", event)}>Open app</a></div><div><span>THRU</span><a href="https://thru.org/docs/" target="_blank" rel="noreferrer">Documentation</a><a href="https://scan.thru.org/" target="_blank" rel="noreferrer">Betanet explorer</a></div></div>
      </div>
      <div className="landing-footer-bottom"><span>CAMBRIAN FOR THRU BETANET</span><span>Wallet · Faucet · Organisms</span></div>
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
