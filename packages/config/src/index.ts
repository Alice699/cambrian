export type CambrianNetwork = "betanet";

export interface CambrianConfig {
  network: CambrianNetwork;
  rpcUrl: string;
  walletIframeUrl: string;
  explorerUrl: string;
  programId: string;
  abiId: string;
  /** The selected deployment must support the authorized wallet_birth (tag 5). */
  walletBirthEnabled: boolean;
}

/**
 * Betanet is intentionally the only network exposed by the first product
 * slice. These IDs point at the byte-verified wallet_birth deployment upgraded
 * on 2026-10-08. Keep overrides available for local or future deployments.
 */
export const defaultCambrianConfig: CambrianConfig = {
  network: "betanet",
  rpcUrl: "https://rpc.betanet.thru.org",
  walletIframeUrl: "https://app.tid.sh/embedded",
  explorerUrl: "https://scan.thru.org",
  programId: "taLnTXq4qblEsC-HkN4QG35Lp72Vnle8gk8UkiAtASymFD",
  abiId: "taPciIseW9AzTnNaB6VJyhHkiOwEDfZYwUbdPdfvbvUQuS",
  walletBirthEnabled: true,
};

export function createCambrianConfig(overrides: Partial<CambrianConfig> = {}): CambrianConfig {
  const config = { ...defaultCambrianConfig, ...overrides };
  const verifiedDeployment = config.programId === defaultCambrianConfig.programId
    && config.abiId === defaultCambrianConfig.abiId
    && config.rpcUrl === defaultCambrianConfig.rpcUrl;
  return {
    ...config,
    // A different program, ABI, or chain must not silently inherit this release's
    // permission to send tag 5. Explicit overrides still support reviewed releases.
    walletBirthEnabled: overrides.walletBirthEnabled ?? (verifiedDeployment && defaultCambrianConfig.walletBirthEnabled),
  };
}

export const cambrianConfig = createCambrianConfig();
