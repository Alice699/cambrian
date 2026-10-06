import { appConfig } from "./config";

export function explorerLink(kind: "tx" | "address", value: string) {
  return `${appConfig.explorerUrl.replace(/\/$/, "")}/${kind}/${encodeURIComponent(value)}?rpc=${encodeURIComponent(appConfig.rpcUrl)}`;
}
