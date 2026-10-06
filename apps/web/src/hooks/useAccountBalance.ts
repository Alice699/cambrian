import { useEffect, useState } from "react";
import { useThru } from "@thru/wallet/react";
import { readAccountSnapshot } from "@cambrian/sdk";

type BalanceState = { address: string | null; status: "loading" | "ready" | "unavailable"; balance: string | null };

export function useAccountBalance(address: string | null, refreshKey = 0) {
  const { thru } = useThru();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<BalanceState>({ address, status: "loading", balance: null });
  useEffect(() => {
    let active = true;
    setState({ address, status: "loading", balance: null });
    if (!address || !thru) return () => { active = false; };
    readAccountSnapshot(thru, address).then((account) => {
      if (active) setState({ address, status: account.balance === null ? "unavailable" : "ready", balance: account.balance?.toString() ?? null });
    }).catch(() => {
      if (active) setState({ address, status: "unavailable", balance: null });
    });
    return () => { active = false; };
  }, [address, thru, refreshKey, retryKey]);
  return { ...(state.address === address ? state : { address, status: "loading" as const, balance: null }), retry: () => setRetryKey(key => key + 1) };
}
