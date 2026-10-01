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
 * slice. Program and ABI IDs stay empty until a fresh deployment is made;
 * the previous Betanet deployment was reset and must not be reused.
 */
export const defaultCambrianConfig: CambrianConfig = {
  network: "betanet",
  rpcUrl: "https://rpc.betanet.thru.org",
  walletIframeUrl: "https://app.tid.sh/embedded",
  explorerUrl: "https://scan.thru.org",
  programId: "",
  abiId: "",
};

export function createCambrianConfig(overrides: Partial<CambrianConfig> = {}): CambrianConfig {
  return { ...defaultCambrianConfig, ...overrides };
}

export const cambrianConfig = createCambrianConfig();
