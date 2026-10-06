import { useEffect, useRef, useState } from "react";
import { copyPublicValue, shortPublicAddress } from "../presentation-model";
import { explorerLink } from "../explorer";
import { UiIcon } from "./UiIcon";

export function AddressDisplay({ value, label, kind = "address", compact = false, tone = "light" }: {
  value: string; label?: string; kind?: "address" | "tx"; compact?: boolean; tone?: "light" | "dark";
}) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  useEffect(() => {
    version.current += 1; setStatus("idle");
    return () => { version.current += 1; if (timer.current) clearTimeout(timer.current); };
  }, [value]);
  const copy = async () => {
    if (status === "copying") return;
    const current = version.current;
    if (timer.current) clearTimeout(timer.current);
    setStatus("copying");
    try {
      await copyPublicValue(value, typeof navigator === "undefined" ? undefined : navigator.clipboard);
      if (current !== version.current) return;
      setStatus("copied"); timer.current = setTimeout(() => setStatus("idle"), 1800);
    } catch { if (current === version.current) setStatus("error"); }
  };
  const name = kind === "tx" ? "transaction signature" : `${label?.toLowerCase() || "account"} address`;
  const valueType = kind === "tx" ? "signature" : "address";
  return <div className={`address-display is-${tone} ${compact ? "is-compact" : ""}`}>
    {label && <span className="address-label">{label}</span>}
    <div className={`address-pill ${status === "copied" ? "is-copied" : ""}`}>
      <a className="address-value" href={explorerLink(kind, value)} target="_blank" rel="noreferrer" title={value} aria-label={`View ${name} ${value} in Thru explorer`}><code>{shortPublicAddress(value)}</code></a>
      <button className="address-copy" type="button" onClick={() => void copy()} disabled={status === "copying"} aria-label={status === "copied" ? `${name} copied` : `Copy ${name}`} title={status === "copied" ? "Copied" : `Copy full ${valueType}`}><UiIcon name={status === "copied" ? "check" : "copy"} /></button>
      <a className="address-explorer" href={explorerLink(kind, value)} target="_blank" rel="noreferrer" aria-label={`Open ${name} in explorer`} title="Open explorer"><UiIcon name="external" /></a>
    </div>
    <span className="sr-only" role="status">{status === "copied" ? "Copied to clipboard." : ""}</span>
    {status === "error" && <span className="address-copy-error" role="alert">Could not copy. Select the full {valueType}: <code>{value}</code></span>}
  </div>;
}
