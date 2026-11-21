import { formatDuration } from './lib/format'
import { LockIcon } from './ui'

// Same "Containment Mode is active" warning shown on every page while the
// vault is frozen — Containment Mode locks the whole vault, not just
// whichever page the user happens to be on. Uses the Lock (Contained) tone.
function ContainmentLockBanner({
  lockCountdown,
  onViewContainment,
}: {
  lockCountdown: number | undefined
  onViewContainment: () => void
}) {
  return (
    <div className="status-card tone-lock flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <LockIcon className="tone-text h-5 w-5 shrink-0" />
        <div>
          <p className="tone-text font-semibold">Containment Mode is active</p>
          <p className="text-sand">
            Withdrawals are frozen — unlocks in {lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onViewContainment}
        className="status-pill tone-lock rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
      >
        View Containment Mode
      </button>
    </div>
  )
}

export default ContainmentLockBanner
