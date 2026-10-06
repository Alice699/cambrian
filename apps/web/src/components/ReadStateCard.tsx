import type { ReactNode } from "react";
import { StatusIcon } from "./TransactionFeedback";
import { UiIcon, type UiIconName } from "./UiIcon";

export function ReadStateCard({ title, description, tone = "neutral", loading = false, onRetry, icon = "organism", eyebrow, action }: {
  title: string; description: string; tone?: "neutral" | "error"; loading?: boolean; onRetry?: () => void;
  icon?: UiIconName; eyebrow?: string; action?: ReactNode;
}) {
  return <div className={`data-state-card ${tone === "error" ? "is-error" : ""} ${loading ? "is-loading" : "is-empty"}`} role={tone === "error" ? "alert" : "status"} aria-busy={loading}>
    <div className="read-state-visual" aria-hidden="true"><span className="read-state-icon">{loading ? <StatusIcon tone="pending" spinning /> : tone === "error" ? <UiIcon name="alert" /> : <UiIcon name={icon} />}</span><i /><i /></div>
    <div className="read-state-copy"><span className="read-state-eyebrow">{eyebrow ?? (loading ? "READING LIVE STATE" : tone === "error" ? "READ INTERRUPTED" : "A FRESH START")}</span><strong>{title}</strong><p>{description}</p></div>
    {loading && <div className="read-skeletons" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>}
    {tone === "error" && onRetry && <button className="read-state-retry" type="button" onClick={onRetry}><UiIcon name="retry" />Retry read</button>}
    {!loading && tone !== "error" && action && <div className="read-state-actions">{action}</div>}
    {!loading && tone !== "error" && !action && <span className="read-state-footnote">Live data will appear here when it is available.</span>}
  </div>;
}
