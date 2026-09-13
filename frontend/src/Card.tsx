// Bare structural shell shared by every card across the dashboard tabs —
// callers supply their own border/bg color and padding via className so
// tone variants (e.g. an amber/red-tinted status card) don't fight the
// default neutral colors in the Tailwind cascade. Split out from App.tsx so
// tabs can share it without an App.tsx <-> tab circular import.
function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-2xl border ${className}`}>{children}</div>
}

export default Card
