export type CambrianNetwork = "betanet";

export interface CambrianConfig {
  network: CambrianNetwork;
  rpcUrl: string;
  walletIframeUrl: string;
  explorerUrl: string;
  programId: string;
  abiId: string;
}

/**
 * Betanet is intentionally the only network exposed by the first product
 * slice. These IDs point at the fresh, verified Cambrian deployment used by
 * the dapp. Keep overrides available for local or future deployments.
 */
export const defaultCambrianConfig: CambrianConfig = {
  network: "betanet",
  rpcUrl: "https://rpc.betanet.thru.org",
  walletIframeUrl: "https://app.tid.sh/embedded",
  explorerUrl: "https://scan.thru.org",
  programId: "taLnTXq4qblEsC-HkN4QG35Lp72Vnle8gk8UkiAtASymFD",
  abiId: "taPciIseW9AzTnNaB6VJyhHkiOwEDfZYwUbdPdfvbvUQuS",
};

export function createCambrianConfig(overrides: Partial<CambrianConfig> = {}): CambrianConfig {
  return { ...defaultCambrianConfig, ...overrides };
}

export const cambrianConfig = createCambrianConfig();
