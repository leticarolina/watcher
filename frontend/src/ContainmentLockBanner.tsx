import { formatDuration } from './lib/format'

// Same red "Containment Mode is ACTIVE" warning shown on every tab while the
// vault is frozen — Containment Mode locks the whole vault, not just
// whichever tab the user happens to be on, so every reachable tab shows the
// same explicit warning rather than only Overview.
function ContainmentLockBanner({
  lockCountdown,
  onViewContainment,
}: {
  lockCountdown: number | undefined
  onViewContainment: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red/40 bg-red/10 px-4 py-3 text-sm text-red">
      <div>
        <p className="font-manrope font-semibold">Containment Mode is ACTIVE</p>
        <p>Withdrawals are frozen — unlocks in {lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}</p>
      </div>
      <button
        type="button"
        onClick={onViewContainment}
        className="rounded border border-red/40 bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/20"
      >
        View Containment Mode
      </button>
    </div>
  )
}

export default ContainmentLockBanner
