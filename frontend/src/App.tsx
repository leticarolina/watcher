import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import LedgerSignerTab from './LedgerSignerTab'
import LedgerAuthorizeWithdrawal from './LedgerAuthorizeWithdrawal'
import { useLedgerAuthorizeWithdrawal } from './lib/useLedgerAuthorizeWithdrawal'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { decodeEventLog, formatEther, parseEther, zeroAddress, type TransactionReceipt } from 'viem'
import { watcherAbi, watcherContract } from './lib/contract'
import { formatDuration, maskAddress, useCountdownSeconds } from './lib/format'
import Card from './Card'
import ContainmentLockBanner from './ContainmentLockBanner'

// Matches the ABI's getUserState output order exactly:
// balance, instantLimit, hasPending, pendingAmount, remainingPendingTime, isLocked, remainingLockTime
type UserState = readonly [bigint, bigint, boolean, bigint, bigint, boolean, bigint]

// Wei -> a rounded, human-readable ETH string (default 6 decimals, trailing
// zeros trimmed). Display only — inputs still parse with parseEther as wei.
function formatEth(value: bigint | undefined, maxDecimals = 6): string {
  if (value === undefined) return '—'
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: maxDecimals })
}

/* ---------------------------------------------------------------------- */
/* Overview tab — BalanceCard, SecurityStatusCard, DepositForm,           */
/* WithdrawForm. Logic unchanged from the previous step, styling only.    */
/* ---------------------------------------------------------------------- */

function BalanceCard({
  balance,
  instantLimit,
}: {
  balance: bigint | undefined
  instantLimit: bigint | undefined
}) {
  return (
    <Card className="border-cloud/10 bg-cloud/5 p-5 md:col-span-2">
      <p className="text-sm text-cloud/60">Total Balance</p>
      <p className="mt-1 font-manrope text-4xl font-bold text-cloud sm:text-5xl">
        {formatEth(balance)} <span className="text-2xl font-semibold text-cloud/50">ETH</span>
      </p>
      <p className="mt-2 text-sm text-cloud/50">
        Instant withdrawal limit: <span className="font-mono text-cloud/70">{formatEth(instantLimit)} ETH</span>
      </p>
    </Card>
  )
}

// Reads as Healthy (teal) when nothing's going on, otherwise reflects
// whichever active state is more severe — a Containment lock outranks a
// merely-pending withdrawal since activating it auto-cancels any pending one.
// No countdown/detail line here on purpose — the Security Queue card right
// below already shows the pending amount and unlock countdown; repeating it
// here was pure duplication.
function SecurityStatusCard({
  isLocked,
  hasPending,
}: {
  isLocked: boolean | undefined
  hasPending: boolean | undefined
}) {
  const tone = isLocked ? 'locked' : hasPending ? 'pending' : 'healthy'

  const toneStyles = {
    healthy: { border: 'border-teal/30', bg: 'bg-teal/10', text: 'text-teal', dot: 'bg-teal' },
    pending: { border: 'border-amber/30', bg: 'bg-amber/10', text: 'text-amber', dot: 'bg-amber' },
    locked: { border: 'border-red/30', bg: 'bg-red/10', text: 'text-red', dot: 'bg-red' },
  }[tone]

  const heading = tone === 'healthy' ? 'Healthy' : tone === 'pending' ? 'Withdrawal pending' : 'Containment Mode active'

  return (
    <Card className={`flex flex-col justify-center gap-2 p-5 ${toneStyles.border} ${toneStyles.bg}`}>
      <p className="text-sm text-cloud/60">Security Status</p>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${toneStyles.dot}`} />
        <p className={`font-manrope text-lg font-semibold ${toneStyles.text}`}>{heading}</p>
      </div>
    </Card>
  )
}

// Static, descriptive-only — communicates the Security Engine framing.
// No status badge, no live data, no contract reads.
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

function RuleCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-cloud/10 bg-cloud/5 p-3">
      <p className="font-manrope text-sm font-semibold text-cloud">{title}</p>
      <p className="mt-1 text-xs text-cloud/60">{description}</p>
    </Card>
  )
}

function DepositForm({ onConfirmed }: { onConfirmed: () => void }) {
  const [amount, setAmount] = useState('')

  const { writeContract, data: hash, isPending: isWaitingForWallet, error: writeError } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isConfirmed) {
      onConfirmed()
      setAmount('')
    }
  }, [isConfirmed, onConfirmed])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    writeContract({
      ...watcherContract,
      functionName: 'deposit',
      value: parseEther(amount),
    })
  }

  let status = ''
  if (isWaitingForWallet) status = 'waiting for wallet confirmation'
  else if (isConfirming) status = 'transaction pending'
  else if (isConfirmed) status = 'confirmed'
  else if (isReceiptError || writeError) status = 'failed'

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="ETH amount"
          className="flex-1 rounded border border-cloud/20 bg-cloud/5 px-3 py-2 text-sm text-cloud placeholder:text-cloud/40"
        />
        <button
          type="submit"
          disabled={isWaitingForWallet || isConfirming}
          className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
        >
          Deposit
        </button>
      </div>
      {status && <p className="text-sm text-cloud/70">status: {status}</p>}
      {hash && <p className="break-all text-xs text-cloud/50">tx hash: {hash}</p>}
      {writeError && <p className="text-xs text-red">error: {writeError.message}</p>}
    </form>
  )
}

// withdraw() doesn't tell us which path was taken — that's only known by checking
// which event the tx receipt emitted.
type WithdrawOutcome = { kind: 'instant' } | { kind: 'queued'; unlockTime: bigint }

// Decode a tx receipt's logs against the Watcher ABI to find which of the two
// withdraw outcomes happened for this address.
function findWithdrawOutcome(
  receipt: TransactionReceipt | undefined,
  address: `0x${string}`,
): WithdrawOutcome | null {
  if (!receipt) return null

  for (const log of receipt.logs) {
    let decoded
    try {
      decoded = decodeEventLog({ abi: watcherAbi, data: log.data, topics: log.topics })
    } catch {
      continue // not an event this ABI recognizes, skip
    }

    if (decoded.eventName === 'WithdrawalExecuted') {
      const args = decoded.args as unknown as { user: `0x${string}`; amount: bigint }
      if (args.user.toLowerCase() === address.toLowerCase()) {
        return { kind: 'instant' }
      }
    } else if (decoded.eventName === 'WithdrawalRequested') {
      const args = decoded.args as unknown as {
        user: `0x${string}`
        amount: bigint
        unlockTime: bigint
        requestTime: bigint
      }
      if (args.user.toLowerCase() === address.toLowerCase()) {
        return { kind: 'queued', unlockTime: args.unlockTime }
      }
    }
  }

  return null
}

function WithdrawForm({
  address,
  hasPending,
  isLocked,
  lockCountdown,
  onConfirmed,
}: {
  address: `0x${string}`
  hasPending: boolean | undefined
  isLocked: boolean | undefined
  lockCountdown: number | undefined
  onConfirmed: () => void
}) {
  const [amount, setAmount] = useState('')

  const { writeContract, data: hash, isPending: isWaitingForWallet, error: writeError } = useWriteContract()

  const { data: receipt, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  // Pure function of receipt/address — derived directly during render, no
  // effect or memoization needed for a handful of logs.
  const outcome = findWithdrawOutcome(receipt, address)

  useEffect(() => {
    if (isConfirmed) {
      onConfirmed()
      setAmount('')
    }
  }, [isConfirmed, onConfirmed])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    writeContract({
      ...watcherContract,
      functionName: 'withdraw',
      args: [parseEther(amount)],
    })
  }

  // withdraw() reverts with EmergencyLockOngoing while locked — block it
  // client-side too, with the reason visible instead of a silent revert.
  const lockedReason = isLocked
    ? `vault is in Containment Mode — unlocks in ${lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}`
    : null

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="ETH amount"
          className="flex-1 rounded border border-cloud/20 bg-cloud/5 px-3 py-2 text-sm text-cloud placeholder:text-cloud/40"
        />
        <button
          type="submit"
          // The contract only allows one pending withdrawal at a time —
          // block a second submission client-side too while one is already
          // queued (see the Security Queue card).
          disabled={isWaitingForWallet || isConfirming || Boolean(isLocked) || Boolean(hasPending)}
          className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
        >
          Withdraw
        </button>
      </div>
      {lockedReason && <p className="text-xs text-red">{lockedReason}</p>}
      {writeError && <p className="text-xs text-red">error: {writeError.message}</p>}
      {outcome?.kind === 'instant' && <p className="text-sm text-teal">Sent instantly</p>}
    </form>
  )
}

// Cancel Withdrawal + Authorize Withdrawal — two independent write flows,
// each with its own wallet→pending→confirmed/failed lifecycle. Unlike
// withdraw() (which can resolve two different ways, requiring receipt-log
// decoding), executeWithdraw() either succeeds or reverts — isConfirmed
// alone tells us it worked.
function SecurityQueueSection({
  hasPending,
  pendingAmount,
  pendingCountdown,
  isLocked,
  lockCountdown,
  requiresLedgerSignature,
  address,
  onConfirmed,
}: {
  hasPending: boolean | undefined
  pendingAmount: bigint | undefined
  pendingCountdown: number | undefined
  isLocked: boolean | undefined
  lockCountdown: number | undefined
  requiresLedgerSignature: boolean
  address: `0x${string}`
  onConfirmed: () => void
}) {
  // pendingCountdown is lifted from OverviewTab (same pattern as lockCountdown
  // below) so this section and the Security Status card tick from one shared
  // clock instead of two independently-anchored, slightly-drifting timers.
  const countdown = pendingCountdown
  const isReady = countdown !== undefined && countdown <= 0

  // Called unconditionally regardless of requiresLedgerSignature (Rules of
  // Hooks) — its output only actually gets used in the Ledger-required
  // branch below. Owns the whole connect -> sign -> executeWithdraw flow so
  // the trigger button (top of the card, next to Cancel Withdrawal) and the
  // transport toggle/status panel (further down) can render in different
  // places while staying in sync.
  const ledgerFlow = useLedgerAuthorizeWithdrawal({ address, pendingAmount, onConfirmed })

  const {
    writeContract: writeCancel,
    data: cancelHash,
    isPending: isCancelWaitingForWallet,
    error: cancelError,
    reset: resetCancel,
  } = useWriteContract()
  const {
    isLoading: isCancelConfirming,
    isSuccess: isCancelConfirmed,
    isError: isCancelReceiptError,
  } = useWaitForTransactionReceipt({ hash: cancelHash })

  useEffect(() => {
    if (isCancelConfirmed) onConfirmed()
  }, [isCancelConfirmed, onConfirmed])

  let cancelStatus = ''
  if (isCancelWaitingForWallet) cancelStatus = 'waiting for wallet confirmation'
  else if (isCancelConfirming) cancelStatus = 'transaction pending'
  else if (isCancelConfirmed) cancelStatus = 'confirmed'
  else if (isCancelReceiptError || cancelError) cancelStatus = 'failed'

  const handleCancel = () => {
    writeCancel({ ...watcherContract, functionName: 'cancelWithdraw', args: [] })
  }

  const {
    writeContract: writeExecute,
    data: executeHash,
    isPending: isExecuteWaitingForWallet,
    error: executeError,
    reset: resetExecute,
  } = useWriteContract()
  const {
    isLoading: isExecuteConfirming,
    isSuccess: isExecuteConfirmed,
    isError: isExecuteReceiptError,
  } = useWaitForTransactionReceipt({ hash: executeHash })

  useEffect(() => {
    if (isExecuteConfirmed) onConfirmed()
  }, [isExecuteConfirmed, onConfirmed])

  // This component's own render output goes to null (not unmounted) whenever
  // there's no pending withdrawal, so writeCancel/writeExecute's mutation
  // state — status, hash, error — otherwise survives across two completely
  // different withdrawals. Reset both the moment a (new) pending withdrawal
  // appears so a previous withdrawal's cancel/execute status never bleeds
  // into this one's display.
  useEffect(() => {
    if (hasPending) {
      resetCancel()
      resetExecute()
    }
  }, [hasPending, resetCancel, resetExecute])

  let executeStatus = ''
  if (isExecuteWaitingForWallet) executeStatus = 'waiting for wallet confirmation'
  else if (isExecuteConfirming) executeStatus = 'transaction pending'
  else if (isExecuteConfirmed) executeStatus = 'confirmed'
  else if (isExecuteReceiptError || executeError) executeStatus = 'failed'

  const handleExecute = () => {
    // Only reachable when requiresLedgerSignature is false — the contract
    // skips signature verification entirely when no Ledger signer is
    // registered for this user, so "0x" is the correct call here. The
    // Ledger-signed path lives in LedgerAuthorizeWithdrawal below.
    writeExecute({ ...watcherContract, functionName: 'executeWithdraw', args: ['0x'] })
  }

  const isCancelBusy = isCancelWaitingForWallet || isCancelConfirming
  const isExecuteBusy = isExecuteWaitingForWallet || isExecuteConfirming
  const countdownText = countdown !== undefined ? formatDuration(countdown) : '…'

  // executeWithdraw() reverts with EmergencyLockOngoing while locked — block
  // it client-side too. Cancel is never blocked by the lock per the
  // contract, so it's unaffected. The reason string only covers the
  // Containment Mode case (a different timer) — the plain "still locked"
  // case is omitted since the card's own big countdown above already says
  // that; repeating "unlocks in X" here would just be the same line twice.
  const executeDisabled = !isReady || isExecuteBusy || Boolean(isLocked)
  const executeDisabledReason = isLocked
    ? `vault is in Containment Mode — unlocks in ${lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}`
    : null

  // Nothing to show — no card at all rather than a "No pending withdrawal"
  // placeholder. All the hooks above still run unconditionally either way.
  if (!hasPending) return null

  return (
    <Card className="space-y-3 border-amber/40 bg-amber/10 p-5 text-amber">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs opacity-70">Security Queue</p>
          <p className="font-manrope text-3xl font-bold leading-tight">{isReady ? 'Ready' : countdownText}</p>
          <p className="text-sm opacity-80">{formatEth(pendingAmount)} ETH queued</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isCancelBusy}
            className="rounded border border-cloud/20 bg-cloud/10 px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
          >
            Cancel Withdrawal
          </button>
          {requiresLedgerSignature ? (
            <button
              type="button"
              onClick={ledgerFlow.handleClick}
              disabled={executeDisabled || ledgerFlow.isBusy}
              className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Execute Withdrawal
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleExecute}
                disabled={executeDisabled}
                className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
              >
                Authorize Withdrawal
              </button>
              {executeDisabledReason && <span className="text-xs opacity-80">{executeDisabledReason}</span>}
            </>
          )}
        </div>
      </div>

      {cancelStatus && <p className="text-xs opacity-90">cancel status: {cancelStatus}</p>}
      {cancelHash && <p className="break-all text-xs opacity-70">cancel tx hash: {cancelHash}</p>}
      {cancelError && <p className="text-xs text-red">cancel error: {cancelError.message}</p>}

      {requiresLedgerSignature ? (
        <div className="space-y-2 border-t border-current/10 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
            Authorize Withdrawal (Ledger signature required)
          </p>
          <LedgerAuthorizeWithdrawal
            transportChoice={ledgerFlow.transportChoice}
            setTransportChoice={ledgerFlow.setTransportChoice}
            state={ledgerFlow.state}
            isBusy={ledgerFlow.isBusy}
            executeStatus={ledgerFlow.executeStatus}
            executeHash={ledgerFlow.executeHash}
            executeError={ledgerFlow.executeError}
            disabled={executeDisabled}
            disabledReason={executeDisabledReason}
          />
        </div>
      ) : (
        (executeStatus || executeHash || executeError) && (
          <div className="space-y-2 border-t border-current/10 pt-3">
            {executeStatus && <p className="text-xs opacity-90">authorize status: {executeStatus}</p>}
            {executeHash && <p className="break-all text-xs opacity-70">authorize tx hash: {executeHash}</p>}
            {executeError && <p className="text-xs text-red">authorize error: {executeError.message}</p>}
          </div>
        )
      )}
    </Card>
  )
}

function OverviewTab({
  address,
  userState,
  isLoading,
  isError,
  error,
  refetch,
  setActiveTab,
}: {
  address: `0x${string}`
  userState: UserState | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null | undefined
  refetch: () => void
  setActiveTab: (tab: TabId) => void
}) {
  // Whether Authorize Withdrawal needs a Ledger co-signature — read
  // separately from getUserState since it's a different mapping entirely.
  const { data: ledgerStateData, refetch: refetchLedgerState } = useReadContract({
    ...watcherContract,
    functionName: 'getLedgerSignerState',
    args: [address],
  })
  const ledgerCurrentSigner = (ledgerStateData as readonly [`0x${string}`, `0x${string}`, bigint] | undefined)?.[0]
  const requiresLedgerSignature = ledgerCurrentSigner !== undefined && ledgerCurrentSigner !== zeroAddress

  // Overview content unmounts/remounts when the tab is switched away and
  // back (App only keeps the getUserState *read* lifted, not this view) —
  // refetch on activation so a queue state that changed while this tab was
  // hidden is reflected immediately rather than waiting on a stale cache hit.
  useEffect(() => {
    refetch()
    refetchLedgerState()
  }, [refetch, refetchLedgerState])

  const hasPending = userState?.[2]
  const pendingAmount = userState?.[3]
  const remainingPendingTime = userState?.[4]
  const isLocked = userState?.[5]
  const remainingLockTime = userState?.[6]

  // Shared with WithdrawForm/SecurityQueueSection/SecurityStatusCard below so
  // all of them show the exact same ticking numbers rather than independently
  // anchored (and thus slightly drifting) countdowns.
  const lockCountdown = useCountdownSeconds(isLocked ? remainingLockTime : undefined)
  const pendingCountdown = useCountdownSeconds(hasPending ? remainingPendingTime : undefined)

  return (
    <div className="max-w-5xl space-y-4">
      {isLocked && (
        <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={() => setActiveTab('containment')} />
      )}

      {isLoading && <p className="text-sm text-cloud/70">Loading getUserState...</p>}
      {isError && <p className="text-sm text-red">Error calling getUserState: {error?.message}</p>}

      <div className="grid gap-3 md:grid-cols-3">
        <BalanceCard balance={userState?.[0]} instantLimit={userState?.[1]} />
        <SecurityStatusCard isLocked={isLocked} hasPending={hasPending} />
      </div>

      <SecurityQueueSection
        hasPending={hasPending}
        pendingAmount={pendingAmount}
        pendingCountdown={pendingCountdown}
        isLocked={isLocked}
        lockCountdown={lockCountdown}
        requiresLedgerSignature={requiresLedgerSignature}
        address={address}
        onConfirmed={refetch}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-cloud/10 bg-cloud/5 p-5">
          <h3 className="mb-2 font-manrope text-sm font-semibold text-cloud/80">Deposit</h3>
          <DepositForm onConfirmed={refetch} />
        </Card>
        <Card className="border-cloud/10 bg-cloud/5 p-5">
          <h3 className="mb-2 font-manrope text-sm font-semibold text-cloud/80">Withdraw</h3>
          <WithdrawForm
            address={address}
            hasPending={hasPending}
            isLocked={isLocked}
            lockCountdown={lockCountdown}
            onConfirmed={refetch}
          />
        </Card>
      </div>

      <div>
        <h3 className="mb-2 font-manrope text-sm font-semibold text-cloud/80">Security Rules</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {SECURITY_RULES.map((rule) => (
            <RuleCard key={rule.title} title={rule.title} description={rule.description} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Containment Mode tab — emergencyLock flow                              */
/* ---------------------------------------------------------------------- */

function ContainmentModeTab({
  address,
  isLocked,
  remainingLockTime,
  onConfirmed,
}: {
  address: `0x${string}`
  isLocked: boolean | undefined
  remainingLockTime: bigint | undefined
  onConfirmed: () => void
}) {
  void address // not needed for reads/writes here (msg.sender is implicit), kept for symmetry with other tabs

  // Live-ticking countdown, independent of the next getUserState refetch.
  const lockCountdown = useCountdownSeconds(isLocked ? remainingLockTime : undefined)

  const { data: minLockDurationData } = useReadContract({
    ...watcherContract,
    functionName: 'MIN_LOCK_DURATION',
  })
  const { data: maxLockDurationData } = useReadContract({
    ...watcherContract,
    functionName: 'MAX_LOCK_DURATION',
  })
  const minLockDuration = minLockDurationData as bigint | undefined
  const maxLockDuration = maxLockDurationData as bigint | undefined

  // Slider works directly in seconds now — one control spanning the full
  // allowed range, with the displayed value auto-formatted (via
  // formatDuration) rather than driven by a separate unit picker.
  const sliderMin = minLockDuration !== undefined ? Number(minLockDuration) : undefined
  const sliderMax = maxLockDuration !== undefined ? Number(maxLockDuration) : undefined

  const [durationSeconds, setDurationSeconds] = useState<number | undefined>(undefined)

  // Default to the minimum allowed duration once the live bounds first load.
  useEffect(() => {
    if (durationSeconds === undefined && sliderMin !== undefined) {
      setDurationSeconds(sliderMin)
    }
  }, [sliderMin, durationSeconds])

  const { writeContract, data: hash, isPending: isWaitingForWallet, error: writeError } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isConfirmed) {
      onConfirmed()
      setDurationSeconds(sliderMin)
    }
  }, [isConfirmed, onConfirmed, sliderMin])

  let status = ''
  if (isWaitingForWallet) status = 'waiting for wallet confirmation'
  else if (isConfirming) status = 'transaction pending'
  else if (isConfirmed) status = 'confirmed'
  else if (isReceiptError || writeError) status = 'failed'

  // The range input's own min/max already keep durationSeconds within
  // bounds, so this is mostly a defensive check for the brief window before
  // sliderMin/sliderMax have loaded.
  let validationError: string | null = null
  if (durationSeconds !== undefined && minLockDuration !== undefined && maxLockDuration !== undefined) {
    if (durationSeconds < Number(minLockDuration)) {
      validationError = `Duration must be at least ${formatDuration(Number(minLockDuration))}.`
    } else if (durationSeconds > Number(maxLockDuration)) {
      validationError = `Duration must be at most ${formatDuration(Number(maxLockDuration))}.`
    }
  }

  const canSubmit = durationSeconds !== undefined && !validationError && !isWaitingForWallet && !isConfirming

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (durationSeconds === undefined) return
    writeContract({
      ...watcherContract,
      functionName: 'emergencyLock',
      args: [BigInt(durationSeconds)],
    })
  }

  // Anchor "now" via an effect rather than calling Date.now() during render
  // (an impure call — render must stay a pure function of props/state).
  const [lockAnchorNow, setLockAnchorNow] = useState<number | null>(null)
  useEffect(() => {
    setLockAnchorNow(remainingLockTime !== undefined ? Date.now() : null)
  }, [remainingLockTime])

  const unlockDate =
    isLocked && remainingLockTime !== undefined && lockAnchorNow !== null
      ? new Date(lockAnchorNow + Number(remainingLockTime) * 1000).toLocaleString()
      : null

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="font-manrope text-lg font-semibold">Containment Mode</h2>
        <p className="text-sm text-cloud/70">
          Freeze all withdrawals for a fixed duration if you suspect your wallet has been compromised.
        </p>
      </div>

      <Card
        className={`p-5 ${isLocked ? 'border-red/40 bg-red/10 text-red' : 'border-teal/40 bg-teal/10 text-teal'}`}
      >
        {isLocked ? (
          <>
            <p className="font-manrope font-semibold">ACTIVE</p>
            <p className="text-sm">Unlocks at {unlockDate}</p>
            <p className="text-xs opacity-80">
              remaining: {lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}
            </p>
          </>
        ) : (
          <p className="font-manrope font-semibold">Inactive</p>
        )}
      </Card>

      <Card className="border-cloud/10 bg-cloud/5 p-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <span className="font-manrope text-sm font-semibold text-cloud">
              {formatDuration(durationSeconds ?? sliderMin ?? 0)}
            </span>

            {sliderMin !== undefined && sliderMax !== undefined ? (
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={600}
                value={durationSeconds ?? sliderMin}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                className="w-full accent-red"
              />
            ) : (
              <p className="text-sm text-cloud/50">Loading duration limits…</p>
            )}
          </div>

          {minLockDuration !== undefined && maxLockDuration !== undefined && (
            <p className="text-xs text-cloud/50">
              Allowed range: {formatDuration(Number(minLockDuration))} – {formatDuration(Number(maxLockDuration))}
            </p>
          )}
          {validationError && <p className="text-xs text-red">{validationError}</p>}

          <p className="rounded border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
            Activating Containment Mode auto-cancels any pending Security Queue withdrawal and refunds it to your
            vault balance.
          </p>

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-red px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
          >
            Activate Containment Mode
          </button>

          {status && <p className="text-sm text-cloud/70">status: {status}</p>}
          {hash && <p className="break-all text-xs text-cloud/50">tx hash: {hash}</p>}
          {writeError && <p className="text-xs text-red">error: {writeError.message}</p>}
        </form>
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Trusted Recovery Address tab                                           */
/* ---------------------------------------------------------------------- */

function RecoveryTab({
  address,
  isLocked,
  remainingLockTime,
  onViewContainment,
}: {
  address: `0x${string}`
  isLocked: boolean | undefined
  remainingLockTime: bigint | undefined
  onViewContainment: () => void
}) {
  // Independent from Overview's own lockCountdown instance — this tab has no
  // other countdown to share it with, so a fresh one here is fine (matches
  // the same pattern ContainmentModeTab itself already uses).
  const lockCountdown = useCountdownSeconds(isLocked ? remainingLockTime : undefined)

  const { data: safeAddressData, refetch: refetchSafeAddress } = useReadContract({
    ...watcherContract,
    functionName: 'safeAddress',
    args: [address],
  })
  const { data: pendingChangeData, refetch: refetchPendingChange } = useReadContract({
    ...watcherContract,
    functionName: 'getPendingSafeChange',
    args: [address],
  })

  const currentSafe = safeAddressData as `0x${string}` | undefined
  const pending = pendingChangeData as readonly [`0x${string}`, bigint] | undefined
  const pendingSafe = pending?.[0]
  const pendingRemaining = pending?.[1]

  const hasPendingChange = pendingSafe !== undefined && pendingSafe !== zeroAddress
  const hasSafeSet = currentSafe !== undefined && currentSafe !== zeroAddress

  const countdown = useCountdownSeconds(hasPendingChange ? pendingRemaining : undefined)

  const [inputAddress, setInputAddress] = useState('')

  const { writeContract, data: hash, isPending: isWaitingForWallet, error: writeError } = useWriteContract()

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isConfirmed) {
      refetchSafeAddress()
      refetchPendingChange()
      setInputAddress('')
    }
  }, [isConfirmed, refetchSafeAddress, refetchPendingChange])

  let status = ''
  if (isWaitingForWallet) status = 'waiting for wallet confirmation'
  else if (isConfirming) status = 'transaction pending'
  else if (isConfirmed) status = 'confirmed'
  else if (isReceiptError || writeError) status = 'failed'

  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(inputAddress)
  const isBusy = isWaitingForWallet || isConfirming

  const handleSet = (e: React.FormEvent) => {
    e.preventDefault()
    writeContract({ ...watcherContract, functionName: 'setSafeAddress', args: [inputAddress] })
  }

  const handleRequestChange = (e: React.FormEvent) => {
    e.preventDefault()
    writeContract({ ...watcherContract, functionName: 'requestSafeAddressChange', args: [inputAddress] })
  }

  const handleConfirm = () => {
    writeContract({ ...watcherContract, functionName: 'confirmSafeAddressChange', args: [] })
  }

  const handleCancel = () => {
    writeContract({ ...watcherContract, functionName: 'cancelSafeAddressChange', args: [] })
  }

  const statusBlock = (
    <>
      {status && <p className="text-sm text-cloud/70">status: {status}</p>}
      {hash && <p className="break-all text-xs text-cloud/50">tx hash: {hash}</p>}
      {writeError && <p className="text-xs text-red">error: {writeError.message}</p>}
    </>
  )

  return (
    <div className="max-w-xl space-y-4">
      {isLocked && <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={onViewContainment} />}

      <div>
        <h2 className="font-manrope text-lg font-semibold">Trusted Recovery Address</h2>
        <p className="text-sm text-cloud/70">
          A backup address that can help recover your account. Changing it after the first time takes a 24-hour
          delay.
        </p>
      </div>

      {hasPendingChange ? (
        <Card className="space-y-3 border-cloud/10 bg-cloud/5 p-5">
          <p className="text-sm">
            Pending change to:{' '}
            <span className="font-mono" title={pendingSafe}>
              {maskAddress(pendingSafe)}
            </span>
          </p>
          <p className="text-sm text-amber">
            Unlocks in {countdown !== undefined ? formatDuration(countdown) : '…'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={countdown === undefined || countdown > 0 || isBusy}
              className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Confirm Change
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isBusy}
              className="rounded border border-cloud/20 bg-cloud/10 px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Cancel Change
            </button>
          </div>
          {countdown !== undefined && countdown > 0 && (
            <p className="text-xs text-cloud/50">Confirm Change unlocks once the 24h delay finishes.</p>
          )}
          {statusBlock}
        </Card>
      ) : hasSafeSet ? (
        <Card className="space-y-3 border-cloud/10 bg-cloud/5 p-5">
          <p className="text-sm">
            Current recovery address:{' '}
            <span className="font-mono" title={currentSafe}>
              {maskAddress(currentSafe)}
            </span>
          </p>
          <form onSubmit={handleRequestChange} className="flex gap-2">
            <input
              type="text"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="0x..."
              className="flex-1 rounded border border-cloud/20 bg-cloud/5 px-3 py-2 font-mono text-sm text-cloud placeholder:text-cloud/40"
            />
            <button
              type="submit"
              disabled={!isValidAddress || isBusy}
              className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Request Change
            </button>
          </form>
          <p className="text-xs text-cloud/50">Changes take effect 24 hours after being requested.</p>
          {statusBlock}
        </Card>
      ) : (
        <Card className="space-y-3 border-cloud/10 bg-cloud/5 p-5">
          <p className="text-sm text-cloud/70">No trusted recovery address set yet.</p>
          <form onSubmit={handleSet} className="flex gap-2">
            <input
              type="text"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="0x..."
              className="flex-1 rounded border border-cloud/20 bg-cloud/5 px-3 py-2 font-mono text-sm text-cloud placeholder:text-cloud/40"
            />
            <button
              type="submit"
              disabled={!isValidAddress || isBusy}
              className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Set Trusted Recovery Address
            </button>
          </form>
          {statusBlock}
        </Card>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Dashboard app shell — top tab bar, logo + wordmark top-left            */
/* Rendered under the /app route; landing page lives in LandingPage.tsx.  */
/* ---------------------------------------------------------------------- */

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'recovery', label: 'Trusted Recovery Address' },
  { id: 'containment', label: 'Containment Mode' },
  { id: 'ledger', label: 'Ledger Signer' },
] as const

type TabId = (typeof NAV_ITEMS)[number]['id']

function DashboardApp() {
  const { address, isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Sliding active-tab pill: measured off the actual button's box (offsets
  // are relative to `nav`, its positioned ancestor) rather than hardcoded,
  // so it stays correct regardless of label length. Recomputed whenever the
  // active tab changes; the CSS transition below is what makes it slide
  // instead of jumping.
  const tabButtonRefs = useRef<Partial<Record<TabId, HTMLButtonElement>>>({})
  const [pillRect, setPillRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    const activeButton = tabButtonRefs.current[activeTab]
    if (activeButton) {
      setPillRect({
        left: activeButton.offsetLeft,
        top: activeButton.offsetTop,
        width: activeButton.offsetWidth,
        height: activeButton.offsetHeight,
      })
    }
  }, [activeTab])

  const { data, isLoading, isError, error, refetch } = useReadContract({
    ...watcherContract,
    functionName: 'getUserState',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const userState = data as UserState | undefined

  return (
    <div className="min-h-screen bg-navy font-inter text-cloud">
      {/* Header stays full-width edge-to-edge — its own px-6, not part of the
          centered content column below. */}
      <header className="flex items-center justify-between border-b border-cloud/10 px-6 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo-cloud.png" alt="" className="h-7 w-auto" />
          <span className="font-manrope text-lg font-semibold tracking-tight">Watcher</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-cloud/15 bg-cloud/5 px-2.5 py-1 text-xs font-medium text-cloud/60">
            Sepolia
          </span>
          <ConnectButton />
        </div>
      </header>

      {/* Independent centered column for the tab row + tab content — a fixed
          max-width block floating in the middle of the page, unrelated to
          the header's full-width edges. Every tab shares this one wrapper
          so they all line up to the same width and alignment. */}
      <div className="mx-auto w-full max-w-4xl px-6">
        <nav className="relative flex gap-1 border-b border-cloud/10 py-2">
          {pillRect && (
            <span
              aria-hidden="true"
              className="absolute rounded-full bg-cloud transition-all duration-200 ease-out"
              style={{ left: pillRect.left, top: pillRect.top, width: pillRect.width, height: pillRect.height }}
            />
          )}
          {NAV_ITEMS.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabButtonRefs.current[tab.id] = el ?? undefined
              }}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative z-10 rounded-full px-4 py-1.5 text-sm transition-colors ${
                activeTab === tab.id ? 'font-medium text-navy' : 'text-cloud/50 hover:text-cloud/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="py-4">
          {!isConnected || !address ? (
            <p className="text-sm text-cloud/60">Connect a wallet to continue.</p>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewTab
                  address={address}
                  userState={userState}
                  isLoading={isLoading}
                  isError={isError}
                  error={error}
                  refetch={refetch}
                  setActiveTab={setActiveTab}
                />
              )}
              {activeTab === 'containment' && (
                <ContainmentModeTab
                  address={address}
                  isLocked={userState?.[5]}
                  remainingLockTime={userState?.[6]}
                  onConfirmed={refetch}
                />
              )}
              {activeTab === 'recovery' && (
                <RecoveryTab
                  address={address}
                  isLocked={userState?.[5]}
                  remainingLockTime={userState?.[6]}
                  onViewContainment={() => setActiveTab('containment')}
                />
              )}
              {activeTab === 'ledger' && (
                <LedgerSignerTab
                  address={address}
                  isLocked={userState?.[5]}
                  remainingLockTime={userState?.[6]}
                  onViewContainment={() => setActiveTab('containment')}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default DashboardApp
