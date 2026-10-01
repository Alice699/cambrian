import { ThruNetwork, type BrowserSDKConfig } from "@thru/wallet/react";
import type { ConnectMetadataInput } from "@thru/wallet";
import { defaultCambrianConfig, type CambrianConfig } from "@cambrian/config";

export function getWalletMetadata(): ConnectMetadataInput {
  return {
    appId: typeof window === "undefined" ? "cambrian-dapp" : window.location.origin,
    appName: "Cambrian",
  };
}

export const walletMetadata = getWalletMetadata();

export function createWalletConfig(config: CambrianConfig = defaultCambrianConfig): BrowserSDKConfig {
  return {
    iframeUrl: config.walletIframeUrl,
    rpcUrl: config.rpcUrl,
    walletNetwork: {
      rpcUrl: config.rpcUrl,
      name: "Thru Betanet",
    },
    network: ThruNetwork.Betanet,
    metadata: walletMetadata,
    theme: "light",
    developerMode: true,
    autoRestore: true,
  };
}

export const walletConfig = createWalletConfig();
