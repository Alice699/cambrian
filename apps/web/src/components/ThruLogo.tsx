import thruLogo from "../assets/thru-logo.png";

/** Original red-and-white Thru artwork; never recolored or redrawn. */
export function ThruLogo({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  return <img className={`thru-brand-logo ${className}`} src={thruLogo} width="32" height="32" alt={decorative ? "" : "Thru logo"} draggable={false} />;
}
