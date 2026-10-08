import { createCambrianConfig } from "@cambrian/config";

const env = import.meta.env;

export const apiBaseUrl = env.VITE_API_URL || "/api";

export const appConfig = createCambrianConfig({
  ...(env.VITE_THRU_RPC_URL ? { rpcUrl: env.VITE_THRU_RPC_URL } : {}),
  ...(env.VITE_THRU_WALLET_IFRAME_URL ? { walletIframeUrl: env.VITE_THRU_WALLET_IFRAME_URL } : {}),
  ...(env.VITE_THRU_EXPLORER_URL ? { explorerUrl: env.VITE_THRU_EXPLORER_URL } : {}),
  ...(env.VITE_CAMBRIAN_PROGRAM_ID ? { programId: env.VITE_CAMBRIAN_PROGRAM_ID } : {}),
  ...(env.VITE_CAMBRIAN_ABI_ID ? { abiId: env.VITE_CAMBRIAN_ABI_ID } : {}),
  ...(env.VITE_CAMBRIAN_WALLET_BIRTH_ENABLED !== undefined
    ? { walletBirthEnabled: env.VITE_CAMBRIAN_WALLET_BIRTH_ENABLED === "true" } : {}),
});
