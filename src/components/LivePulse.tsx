export function LivePulse({ tone = "success" }: { tone?: "success" | "warning" | "destructive" }) {
  const cls = tone === "success" ? "fill-success" : tone === "warning" ? "fill-warning" : "fill-destructive";
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <circle cx="6" cy="6" r="3" className={`${cls} pulse-ring`} />
      <circle cx="6" cy="6" r="3" className={cls} />
    </svg>
  );
}
