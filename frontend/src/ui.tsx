import type { ReactNode, SVGProps } from 'react'

/* ---------------------------------------------------------------------- */
/* Shared class strings                                                   */
/* ---------------------------------------------------------------------- */

export const btnPrimary =
  'rounded-lg bg-guard px-4 py-2 text-sm font-semibold text-cloud transition-colors hover:bg-guard/90 disabled:cursor-not-allowed disabled:opacity-40'
export const btnSecondary =
  'rounded-lg border border-stone px-4 py-2 text-sm font-semibold text-cloud transition-colors hover:bg-stone/50 disabled:cursor-not-allowed disabled:opacity-40'
export const inputClass =
  'flex-1 rounded-lg border border-stone bg-midnight px-3 py-2 text-sm text-cloud placeholder:text-sand/40 focus:border-sand/40 focus:outline-none disabled:opacity-40'

/* ---------------------------------------------------------------------- */
/* Status system — see .status-card / .status-pill in index.css           */
/* ---------------------------------------------------------------------- */

export type Tone = 'guard' | 'warn' | 'lock' | 'alert' | 'recovery'

// Tinted state card: hue blended into Slate, full-hue left accent, and the
// heading + icon in the hue itself.
export function StatusCard({
  tone,
  icon,
  label,
  title,
  children,
  className = '',
}: {
  tone: Tone
  icon: ReactNode
  label?: string
  title: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={`status-card tone-${tone} p-5 ${className}`}>
      {label && <p className="text-xs font-medium uppercase tracking-wider text-sand/70">{label}</p>}
      <div className={`tone-text flex items-center gap-2 ${label ? 'mt-2' : ''}`}>
        <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      {children && <div className="mt-2 space-y-1 text-sm text-sand">{children}</div>}
    </div>
  )
}

// Inline status indicator: fully rounded, hue-tinted, no border.
export function StatusPill({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`status-pill tone-${tone} inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold [&>svg]:h-3.5 [&>svg]:w-3.5`}
    >
      {icon}
      {children}
    </span>
  )
}

// Neutral Slate surface for non-status content (forms, lists).
export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-stone bg-slate ${className}`}>{children}</div>
}

export function PageHeading({ title, subtitle, aside }: { title: string; subtitle: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cloud sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-sand/70">{subtitle}</p>
      </div>
      {aside}
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Icons — 24px stroke icons, sized by the caller via className           */
/* ---------------------------------------------------------------------- */

function Icon({ children, className = 'h-5 w-5', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  )
}

type IconProps = { className?: string }

export const VaultIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 9V7.5M12 16.5V15M15 12h1.5M7.5 12H9" />
  </Icon>
)
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
  </Icon>
)
export const ShieldCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
)
export const RecoveryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4h4" />
    <path d="M12 8v4l2.5 1.5" />
  </Icon>
)
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Icon>
)
export const UnlockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.5-1.9" />
  </Icon>
)
// Gear / cog.
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 3.6a1.7 1.7 0 0 1 3.4 0l.2 1a1.7 1.7 0 0 0 2.5 1.1l.9-.6a1.7 1.7 0 0 1 2.4 2.4l-.6.9a1.7 1.7 0 0 0 1.1 2.5l1 .2a1.7 1.7 0 0 1 0 3.4l-1 .2a1.7 1.7 0 0 0-1.1 2.5l.6.9a1.7 1.7 0 0 1-2.4 2.4l-.9-.6a1.7 1.7 0 0 0-2.5 1.1l-.2 1a1.7 1.7 0 0 1-3.4 0l-.2-1a1.7 1.7 0 0 0-2.5-1.1l-.9.6a1.7 1.7 0 0 1-2.4-2.4l.6-.9a1.7 1.7 0 0 0-1.1-2.5l-1-.2a1.7 1.7 0 0 1 0-3.4l1-.2a1.7 1.7 0 0 0 1.1-2.5l-.6-.9a1.7 1.7 0 0 1 2.4-2.4l.9.6a1.7 1.7 0 0 0 2.5-1.1z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)
export const ProbeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
)
export const LargeWithdrawalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </Icon>
)
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4l9 16H3l9-16z" />
    <path d="M12 10v4M12 17.2v.1" />
  </Icon>
)
export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
)
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 11l8-6.5 8 6.5" />
    <path d="M6 9.5V19h12V9.5" />
  </Icon>
)
export const CoinsIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="9" cy="7" rx="5.5" ry="2.5" />
    <path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5S14.5 12.4 14.5 11V7" />
    <path d="M9.5 16.3c.9.4 2.1.7 3.5.7 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.8-2.2-4.2-2.4" />
  </Icon>
)
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)
export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8-8M16 7l2 2" />
  </Icon>
)

/* ---------------------------------------------------------------------- */
/* Decorative arc motifs (from the brand "visual motifs" sheet).          */
/* Midnight-on-Midnight: thin Cloud strokes at very low opacity.          */
/* Background-only — absolutely positioned, pointer-events: none.         */
/* ---------------------------------------------------------------------- */

export type Motif = 'orbit' | 'corner' | 'horizon'

export function ArcBackdrop({ motif }: { motif: Motif }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio={motif === 'corner' ? 'xMinYMax slice' : 'xMaxYMid slice'}
        fill="none"
        stroke="var(--color-cloud)"
        strokeWidth="1"
      >
        {motif === 'orbit' && (
          // Concentric rings + a tilted orbit with a single satellite dot.
          <g strokeOpacity="0.07">
            <circle cx="930" cy="560" r="330" />
            <circle cx="980" cy="600" r="430" />
            <path d="M520 860 C 700 560, 1000 470, 1260 540" />
            <circle cx="912" cy="512" r="5" fill="var(--color-cloud)" fillOpacity="0.22" stroke="none" />
          </g>
        )}
        {motif === 'corner' && (
          // Quarter arcs sweeping in from the bottom-left corner.
          <g strokeOpacity="0.07">
            <circle cx="0" cy="800" r="360" />
            <circle cx="0" cy="800" r="500" />
            <circle cx="0" cy="800" r="660" />
          </g>
        )}
        {motif === 'horizon' && (
          // A bright edge on a dark horizon with a rising disc above it.
          <>
            <defs>
              <radialGradient id="arc-horizon-glow" cx="50%" cy="100%" r="60%">
                <stop offset="0%" stopColor="var(--color-cloud)" stopOpacity="0.08" />
                <stop offset="100%" stopColor="var(--color-cloud)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect x="0" y="200" width="1200" height="460" fill="url(#arc-horizon-glow)" stroke="none" />
            <path d="M597 632 a 46 46 0 0 1 92 0" fill="var(--color-cloud)" fillOpacity="0.1" stroke="none" />
            <path d="M80 700 Q 646 560 1200 700" strokeOpacity="0.14" />
          </>
        )}
      </svg>
    </div>
  )
}
