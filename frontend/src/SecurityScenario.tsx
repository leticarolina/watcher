import { useEffect, useState } from 'react'
import { AlertIcon, EyeIcon, LockIcon, ShieldCheckIcon, StatusPill } from './ui'

// Landing-page hero card: a live-looking, fully client-side walkthrough of
// the moment Watcher exists for — a suspicious withdrawal caught and held in
// the security queue while the owner still has time to act. No wallet or
// contract reads; every number here is illustrative but follows the real
// rules (Rule 1: >60% of balance → RISKY_WITHDRAWAL_DELAY = 12h queue, and
// Containment auto-cancels a pending withdrawal).

const QUEUE_SECONDS = 12 * 3600 // RISKY_WITHDRAWAL_DELAY
const START_REMAINING = 4 * 3600 + 47 * 60 + 52 // ~60% of the window elapsed
const WITHDRAWAL = 3.2 // of a 4.20 ETH vault — 76%, over Rule 1's 60%

type Phase = 'queued' | 'cancelled' | 'contained'

function formatClock(totalSeconds: number) {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':')
}

function SecurityScenario() {
  const [phase, setPhase] = useState<Phase>('queued')
  const [remaining, setRemaining] = useState(START_REMAINING)

  // The countdown only ticks while the withdrawal is actually queued.
  useEffect(() => {
    if (phase !== 'queued') return
    const id = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => window.clearInterval(id)
  }, [phase])

  const elapsedPct = ((QUEUE_SECONDS - remaining) / QUEUE_SECONDS) * 100

  const replay = () => {
    setRemaining(START_REMAINING)
    setPhase('queued')
  }

  return (
    <figure className="w-full max-w-xl">
      <div className="relative overflow-hidden rounded-2xl border border-stone bg-slate p-5 shadow-2xl sm:p-6 shadow-black/40">
        {/* Soft glow tinted by the current state */}
        <div
          className={`pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl transition-colors duration-700 ${
            phase === 'queued' ? 'bg-warn/15' : phase === 'cancelled' ? 'bg-guard/25' : 'bg-lock/20'
          }`}
          aria-hidden="true"
        />

        {/* Header */}
        <div className="relative flex items-center justify-between gap-3 border-b border-stone pb-4">
          <div className="flex items-center gap-2.5 text-cloud">
            <EyeIcon className="h-5 w-5 text-sand/80" />
            <span className="text-base font-medium">Vault protection</span>
          </div>
          {phase === 'queued' && (
            <StatusPill tone="warn">
              <span className="relative mr-0.5 flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warn" />
              </span>
              Action required
            </StatusPill>
          )}
          {phase === 'cancelled' && (
            <StatusPill tone="guard" icon={<ShieldCheckIcon />}>
              Healthy
            </StatusPill>
          )}
          {phase === 'contained' && (
            <StatusPill tone="lock" icon={<LockIcon />}>
              Contained
            </StatusPill>
          )}
        </div>

        {/* Body */}
        <div className="relative pt-5" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wider text-sand/60">
            {phase === 'queued' ? 'Suspicious withdrawal' : 'Withdrawal stopped'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p
              className={`text-3xl font-semibold tracking-tight tabular-nums transition-colors ${
                phase === 'queued' ? 'text-cloud' : 'text-sand/50 line-through decoration-2'
              }`}
            >
              {WITHDRAWAL.toFixed(2)} <span className="text-xl font-medium text-sand/60">ETH</span>
            </p>
            {phase === 'queued' && (
              <p className="tone-warn tone-text flex items-center gap-1.5 text-sm font-medium">
                <AlertIcon className="h-4 w-4" />
                Large withdrawal detected
              </p>
            )}
          </div>

          {phase === 'queued' && (
            // Desktop: queue on the left, actions stacked on the right — keeps
            // the card wide and short. Mobile: everything stacks.
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-stretch">
              <div className="status-card tone-warn px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-sand">Security queue</span>
                  <span className="tone-text font-mono text-lg font-medium tabular-nums">{formatClock(remaining)}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-warn/20">
                  <div
                    className="h-full rounded-full bg-warn transition-[width] duration-1000 ease-linear"
                    style={{ width: `${elapsedPct}%` }}
                  />
                </div>
                <p className="mt-2.5 text-xs text-sand/80">Withdrawal delayed. You still have time to act.</p>
              </div>

              <div className="flex flex-col gap-2 sm:justify-center">
                <button
                  type="button"
                  onClick={() => setPhase('cancelled')}
                  className="whitespace-nowrap rounded-lg bg-guard px-4 py-2.5 text-sm font-semibold text-cloud transition-colors hover:bg-guard/90"
                >
                  Cancel withdrawal
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('contained')}
                  className="whitespace-nowrap rounded-lg border border-stone px-4 py-2.5 text-sm font-semibold text-cloud transition-colors hover:bg-stone/50"
                >
                  Contain vault
                </button>
              </div>
            </div>
          )}

          {phase === 'cancelled' && (
            <div className="status-card tone-guard mt-4 px-4 py-3.5">
              <p className="tone-text flex items-center gap-2 text-sm font-semibold">
                <ShieldCheckIcon className="h-4 w-4" />
                Withdrawal cancelled
              </p>
              <p className="mt-1 text-xs text-sand/80">
                The queued withdrawal was reversed — {WITHDRAWAL.toFixed(2)} ETH is back in your vault.
              </p>
            </div>
          )}

          {phase === 'contained' && (
            <div className="status-card tone-lock mt-4 px-4 py-3.5">
              <p className="tone-text flex items-center gap-2 text-sm font-semibold">
                <LockIcon className="h-4 w-4" />
                Vault contained
              </p>
              <p className="mt-1 text-xs text-sand/80">
                The pending withdrawal was cancelled and all withdrawals are frozen until the lock ends.
              </p>
            </div>
          )}

          {phase !== 'queued' && (
            <button
              type="button"
              onClick={replay}
              className="mt-4 text-xs font-medium text-sand/60 underline decoration-stone underline-offset-4 transition-colors hover:text-cloud"
            >
              Replay scenario
            </button>
          )}
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-sand/50">Illustrative security scenario</figcaption>
    </figure>
  )
}

export default SecurityScenario
