import type { BrowserSDKConfig } from "@thru/wallet/react";
import { defaultCambrianConfig, type CambrianConfig } from "@cambrian/config";

export const walletMetadata = {
  appId: "cambrian-dapp",
  appName: "Cambrian",
} as const;

export function createWalletConfig(config: CambrianConfig = defaultCambrianConfig): BrowserSDKConfig {
  return {
    iframeUrl: config.walletIframeUrl,
    rpcUrl: config.rpcUrl,
    walletNetwork: {
      rpcUrl: config.rpcUrl,
      name: "Thru Betanet",
    },
    metadata: walletMetadata,
    theme: "light",
    developerMode: true,
    autoRestore: true,
  };
}

export const walletConfig = createWalletConfig();
