import { useEffect, useState } from "react";
import { useThru, useWallet } from "@thru/wallet/react";
import { isOrganismControlledBy, listWalletCambrianOrganisms, type CambrianOrganismRecord } from "@cambrian/sdk";
import { activeThruAddress } from "../transaction-model";
import { appConfig } from "../config";

export type OrganismReadStatus = "idle" | "loading" | "ready" | "empty" | "needs-wallet" | "not-configured" | "error";
export interface OrganismReadState {
  walletAddress: string | null;
  status: OrganismReadStatus;
  organisms: CambrianOrganismRecord[];
  unreadableAccounts: Array<{ address: string; reason: string }>;
  error: string | null;
}

export function useOrganismCollection(refreshKey = 0, createdOrganism?: CambrianOrganismRecord | null): OrganismReadState {
  const { thru } = useThru();
  const { isConnected, selectedAccount } = useWallet();
  const address = activeThruAddress(isConnected, selectedAccount?.address);
  const pinned = address && createdOrganism && isOrganismControlledBy(createdOrganism, address) ? createdOrganism : null;
  const initial = (): OrganismReadState => ({ walletAddress: address, status: !address ? "needs-wallet" : !appConfig.programId ? "not-configured" : "loading", organisms: [], unreadableAccounts: [], error: null });
  const [state, setState] = useState<OrganismReadState>(initial);
  useEffect(() => {
    const controller = new AbortController();
    if (!address || !thru || !appConfig.programId) {
      setState(initial());
      return () => controller.abort();
    }
    setState({ ...initial(), organisms: pinned ? [pinned] : [], status: pinned ? "ready" : "loading" });
    listWalletCambrianOrganisms(thru, appConfig, address, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const organisms = pinned ? [pinned, ...result.organisms.filter(item => item.address !== pinned.address)] : result.organisms;
      // Unreadable index entries do not prove that the wallet's collection is empty.
      const error = !organisms.length && result.unreadableAccounts.length ? "Some organism accounts could not be read. Retry before assuming this wallet has no organisms." : null;
      setState({ walletAddress: address, status: error ? "error" : organisms.length ? "ready" : "empty", organisms, unreadableAccounts: result.unreadableAccounts, error });
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setState({ ...initial(), status: pinned ? "ready" : "error", organisms: pinned ? [pinned] : [], error: cause instanceof Error ? cause.message : "The organism read could not be completed." });
    });
    return () => controller.abort();
  }, [address, thru, refreshKey, pinned]);
  // Hide the previous wallet's data synchronously, before the effect runs.
  if (state.walletAddress !== address) return initial();
  return pinned ? { ...state, organisms: [pinned, ...state.organisms.filter(item => item.address !== pinned.address)] } : state;
}
