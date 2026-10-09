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
  // Overview and Organisms default to the most recently active on-chain record,
  // not whichever address the index happened to return first.
  const ordered = (items: CambrianOrganismRecord[]) => [...items].sort((a, b) => {
    if (a.state.lastPulseSlot !== b.state.lastPulseSlot) return a.state.lastPulseSlot > b.state.lastPulseSlot ? -1 : 1;
    if (a.state.bornSlot !== b.state.bornSlot) return a.state.bornSlot > b.state.bornSlot ? -1 : 1;
    return a.address.localeCompare(b.address);
  });
  const withPinned = (items: CambrianOrganismRecord[]) => {
    if (!pinned) return ordered(items);
    const listed = items.find(item => item.address === pinned.address);
    const newer = listed && listed.state.lastPulseSlot >= pinned.state.lastPulseSlot && listed.state.pulseCount >= pinned.state.pulseCount
      && (listed.sequence === null || pinned.sequence === null || listed.sequence >= pinned.sequence);
    // Retain verified read-back through index lag, but never replace a newer
    // indexed state with an old Birth/Pulse snapshot.
    return [newer ? listed : pinned, ...ordered(items.filter(item => item.address !== pinned.address))];
  };
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
      const organisms = withPinned(result.organisms);
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
  return pinned ? { ...state, organisms: withPinned(state.organisms) } : state;
}
