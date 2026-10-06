import { ThruLogo } from "./ThruLogo";

/** Environment information, not an unverified connection/health indicator. */
export function NetworkCard() {
  return <section className="network-status" aria-label="Thru Betanet · Test network">
    <div className="network-status-heading"><span>NETWORK</span><span className="network-environment">Testnet</span></div>
    <div className="network-status-chain">
      <ThruLogo decorative />
      <div className="network-status-copy"><strong>Thru Betanet</strong><span>Test assets only</span></div>
    </div>
  </section>;
}
