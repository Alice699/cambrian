export type UiIconName = "wallet" | "organism" | "activity" | "faucet" | "copy" | "check" | "external" | "chevron" | "retry" | "alert" | "broadcast" | "shield";

export function UiIcon({ name, className = "" }: { name: UiIconName; className?: string }) {
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "wallet" ? <><path d="M19 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h13a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V7" /><path d="M20 12h-4a2 2 0 0 0 0 4h4" /></>
      : name === "organism" ? <><path d="M12 20v-7m0 3c-5 0-8-3-8-8 5 0 8 3 8 8Zm0-3c0-5 3-8 8-8 0 5-3 8-8 8Z" /><path d="M8 21h8" /></>
      : name === "activity" ? <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>
      : name === "broadcast" ? <><circle cx="12" cy="12" r="1.5" /><path d="M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8" /></>
      : name === "shield" ? <><path d="m12 3 8 3v6c0 4-3.7 7.5-8 9-4.3-1.5-8-5-8-9V6l8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>
      : name === "faucet" ? <><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" /><path d="M9 14a3 3 0 0 0 3 3" /></>
      : name === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>
      : name === "check" ? <path d="m5 12 4 4 10-10" />
      : name === "external" ? <><rect x="8" y="3" width="13" height="13" rx="2" /><path d="M8 8H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3M8 7h13" /></>
      : name === "chevron" ? <path d="m7 10 5 5 5-5" />
      : name === "retry" ? <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>
      : <><path d="M12 8v5m0 4h.01" /><path d="m10.3 4.8-8 14A1.5 1.5 0 0 0 3.6 21h16.8a1.5 1.5 0 0 0 1.3-2.2l-8-14a2 2 0 0 0-3.4 0Z" /></>}
  </svg>;
}
