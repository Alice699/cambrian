export type UiIconName = "wallet" | "organism" | "activity" | "faucet" | "copy" | "check" | "external" | "arrow" | "chevron" | "retry" | "alert";

export function UiIcon({ name, className = "" }: { name: UiIconName; className?: string }) {
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "wallet" ? <><path d="M19 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h13a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V7" /><path d="M20 12h-4a2 2 0 0 0 0 4h4" /></>
      : name === "organism" ? <><path d="M12 20v-7m0 3c-5 0-8-3-8-8 5 0 8 3 8 8Zm0-3c0-5 3-8 8-8 0 5-3 8-8 8Z" /><path d="M8 21h8" /></>
      : name === "activity" ? <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>
      : name === "faucet" ? <><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" /><path d="M9 14a3 3 0 0 0 3 3" /></>
      : name === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>
      : name === "check" ? <path d="m5 12 4 4 10-10" />
      : name === "external" ? <><path d="M14 4h6v6m0-6-9 9" /><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>
      : name === "arrow" ? <path d="M4 12h16m-6-6 6 6-6 6" />
      : name === "chevron" ? <path d="m7 10 5 5 5-5" />
      : name === "retry" ? <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>
      : <><path d="M12 8v5m0 4h.01" /><path d="m10.3 4.8-8 14A1.5 1.5 0 0 0 3.6 21h16.8a1.5 1.5 0 0 0 1.3-2.2l-8-14a2 2 0 0 0-3.4 0Z" /></>}
  </svg>;
}
