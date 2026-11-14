import Card from './Card'

// Static, descriptive-only — communicates the Security Engine framing.
// No status badge, no live data, no contract reads. Rendered once under
// whichever token tab is active (via the token layout route in App.tsx),
// not per token.
// TODO(threshold): Rule 1's 60% is now only the default — users can configure
// 10–100% (getThresholdState). Update once the threshold settings panel exists.
const SECURITY_RULES = [
  {
    title: 'Large Withdrawal Guard',
    description: 'Withdrawals over 60% of your balance are queued for a timelock instead of executing instantly.',
  },
  {
    title: 'Probe Detection',
    description: 'A withdrawal under 5% of your balance, followed by any withdrawal, is flagged as a possible probe.',
  },
  {
    title: 'Rolling Window Guard',
    description: 'Cumulative withdrawals over 30% of your balance within a rolling 72-hour window are queued.',
  },
] as const

function SecurityRules() {
  return (
    <div className="max-w-5xl">
      <h3 className="font-manrope text-sm font-semibold text-cloud/80">Security Rules</h3>
      <p className="mb-2 text-xs text-cloud/50">Applied to each token independently.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {SECURITY_RULES.map((rule) => (
          <Card key={rule.title} className="border-cloud/10 bg-cloud/5 p-3">
            <p className="font-manrope text-sm font-semibold text-cloud">{rule.title}</p>
            <p className="mt-1 text-xs text-cloud/60">{rule.description}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default SecurityRules
