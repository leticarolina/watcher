import { useState, type ReactNode } from 'react'
import {
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  LargeWithdrawalIcon,
  Panel,
  ProbeIcon,
  ShieldCheckIcon,
  StatusPill,
} from './ui'

// Static, descriptive-only — no live data or contract reads. Thresholds
// mirror the contract defaults.
// TODO(threshold): Rule 1's 60% is now only the default — users can configure
// 10–100% (getThresholdState). Update once the threshold settings panel exists.
const SECURITY_RULES: { title: string; threshold: string; description: string; icon: ReactNode }[] = [
  {
    title: 'Large Withdrawal Guard',
    threshold: 'Over 60% of balance',
    description: 'Withdrawals over 60% of your balance are queued for a timelock instead of executing instantly.',
    icon: <LargeWithdrawalIcon className="h-4 w-4" />,
  },
  {
    title: 'Probe Detection',
    threshold: 'Under 5%, then any withdrawal',
    description: 'A withdrawal under 5% of your balance, followed by any withdrawal, is flagged as a possible probe.',
    icon: <ProbeIcon className="h-4 w-4" />,
  },
  {
    title: 'Rolling Window Guard',
    threshold: 'Over 30% within 72h',
    description: 'Cumulative withdrawals over 30% of your balance within a rolling 72-hour window are queued.',
    icon: <ClockIcon className="h-4 w-4" />,
  },
]

function RuleIcon({ children }: { children: ReactNode }) {
  return (
    <span className="status-pill tone-guard flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
      {children}
    </span>
  )
}

// One-line summary for the main views ("3 protection rules active"), which
// expands in place to show each rule. Keeps the dashboard focused on the
// user's funds without hiding the security model.
export function RulesSummary() {
  const [open, setOpen] = useState(false)
  return (
    <Panel className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-stone/30"
      >
        <span className="status-pill tone-guard flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <ShieldCheckIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-cloud">{SECURITY_RULES.length} protection rules active</span>
          <span className="block text-xs text-sand/60">Behavioral monitoring enabled</span>
        </span>
        <span className="hidden text-xs text-sand/50 sm:inline">{open ? 'Hide details' : 'View details'}</span>
        <ChevronIcon className={`h-4 w-4 text-sand/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="divide-y divide-stone border-t border-stone">
          {SECURITY_RULES.map((rule) => (
            <li key={rule.title} className="flex gap-3 px-4 py-3">
              <RuleIcon>{rule.icon}</RuleIcon>
              <div className="min-w-0">
                <p className="text-sm font-medium text-cloud">
                  {rule.title} <span className="font-normal text-sand/60">· {rule.threshold}</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-sand/60">{rule.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// Detailed list for the Security page.
function SecurityRules() {
  return (
    <section>
      <h2 className="text-sm font-semibold text-cloud">Protection rules</h2>
      <p className="mb-3 text-xs text-sand/60">Applied to each token independently, on every withdrawal.</p>
      <div className="grid gap-3 md:grid-cols-3">
        {SECURITY_RULES.map((rule) => (
          <Panel key={rule.title} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <RuleIcon>{rule.icon}</RuleIcon>
              <StatusPill tone="guard" icon={<CheckIcon />}>
                Active
              </StatusPill>
            </div>
            <p className="mt-4 text-sm font-semibold text-cloud">{rule.title}</p>
            <p className="mt-0.5 text-xs font-medium text-sand/80">{rule.threshold}</p>
            <p className="mt-2 text-xs leading-relaxed text-sand/60">{rule.description}</p>
          </Panel>
        ))}
      </div>
    </section>
  )
}

export default SecurityRules
