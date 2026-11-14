import { useCallback, useEffect, useState } from 'react'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { decodeEventLog, type Address, type TransactionReceipt } from 'viem'
import { watcherAbi, watcherContract } from './lib/contract'
import { formatAmount, formatDuration, parseAmount, useCountdownSeconds } from './lib/format'
import type { Token } from './lib/tokens'
import type { TokenStatus } from './lib/useTokenOverview'
import Card from './Card'
import ContainmentLockBanner from './ContainmentLockBanner'
import DepositPanel from './DepositPanel'

// Matches the ABI's getUserState(user, token) output order exactly:
// balance, instantLimit, hasPending, pendingAmount, remainingPendingTime, isLocked, remainingLockTime
// Everything except isLocked/remainingLockTime is scoped to the token passed in.
type UserState = readonly [bigint, bigint, boolean, bigint, bigint, boolean, bigint]

/* ---------------------------------------------------------------------- */
/* Token tab — the full single-vault experience, scoped to one token:      */
/* BalanceCard, SecurityStatusCard, SecurityQueueSection, DepositPanel,    */
/* WithdrawForm. Inactive tokens get a single "Add <token>" button.        */
/* ---------------------------------------------------------------------- */

function BalanceCard({
  balance,
  instantLimit,
  token,
  decimals,
}: {
  balance: bigint | undefined
  instantLimit: bigint | undefined
  token: Token
  decimals: number | undefined
}) {
  return (
    <Card className="border-cloud/10 bg-cloud/5 p-5 md:col-span-2">
      <p className="text-sm text-cloud/60">Vault Balance</p>
      <p className="mt-1 font-manrope text-4xl font-bold text-cloud sm:text-5xl">
        {formatAmount(balance, decimals)}{' '}
        <span className="text-2xl font-semibold text-cloud/50">{token.symbol}</span>
      </p>
      <p className="mt-2 text-sm text-cloud/50">
        Instant withdrawal limit:{' '}
        <span className="font-mono text-cloud/70">
          {formatAmount(instantLimit, decimals)} {token.symbol}
        </span>
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

// withdraw() doesn't tell us which path was taken — that's only known by checking
// which event the tx receipt emitted.
type WithdrawOutcome = { kind: 'instant' } | { kind: 'queued'; unlockTime: bigint }

// Decode a tx receipt's logs against the Watcher ABI to find which of the two
// withdraw outcomes happened for this address and token.
function findWithdrawOutcome(
  receipt: TransactionReceipt | undefined,
  address: Address,
  token: Address,
): WithdrawOutcome | null {
  if (!receipt) return null

  for (const log of receipt.logs) {
    let decoded
    try {
      decoded = decodeEventLog({ abi: watcherAbi, data: log.data, topics: log.topics })
    } catch {
      continue // not an event this ABI recognizes, skip
    }

    const args = decoded.args as unknown as { user: Address; token: Address; unlockTime?: bigint }
    if (args.user?.toLowerCase() !== address.toLowerCase() || args.token?.toLowerCase() !== token.toLowerCase()) {
      continue
    }
    if (decoded.eventName === 'WithdrawalExecuted') return { kind: 'instant' }
    if (decoded.eventName === 'WithdrawalRequested' && args.unlockTime !== undefined) {
      return { kind: 'queued', unlockTime: args.unlockTime }
    }
  }

  return null
}

function WithdrawForm({
  address,
  token,
  decimals,
  vaultBalance,
  hasPending,
  isLocked,
  lockCountdown,
  onConfirmed,
}: {
  address: Address
  token: Token
  decimals: number | undefined
  vaultBalance: bigint | undefined
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
  const outcome = findWithdrawOutcome(receipt, address, token.address)

  useEffect(() => {
    if (isConfirmed) {
      onConfirmed()
      setAmount('')
    }
  }, [isConfirmed, onConfirmed])

  const parsed = parseAmount(amount, decimals)
  const exceedsBalance = parsed !== null && vaultBalance !== undefined && parsed > vaultBalance

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (parsed === null) return
    writeContract({
      ...watcherContract,
      functionName: 'withdraw',
      args: [token.address, parsed],
    })
  }

  // withdraw() reverts with EmergencyLockOngoing while locked — block it
  // client-side too, with the reason visible instead of a silent revert.
  const lockedReason = isLocked
    ? `vault is in Containment Mode — unlocks in ${lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}`
    : null

  let validation: string | null = null
  if (amount.trim() !== '' && parsed === null && decimals !== undefined) {
    validation = `Enter a positive amount with at most ${decimals} decimal places.`
  } else if (exceedsBalance) {
    validation = 'Amount exceeds your vault balance.'
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`${token.symbol} amount`}
          className="flex-1 rounded border border-cloud/20 bg-cloud/5 px-3 py-2 text-sm text-cloud placeholder:text-cloud/40"
        />
        <button
          type="submit"
          // The contract only allows one pending withdrawal per token at a
          // time — block a second submission client-side too while one is
          // already queued (see the Security Queue card).
          disabled={
            parsed === null ||
            exceedsBalance ||
            isWaitingForWallet ||
            isConfirming ||
            Boolean(isLocked) ||
            Boolean(hasPending)
          }
          className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
        >
          Withdraw
        </button>
      </div>
      {validation && <p className="text-xs text-cloud/60">{validation}</p>}
      {lockedReason && <p className="text-xs text-red">{lockedReason}</p>}
      {writeError && <p className="text-xs text-red">error: {writeError.message}</p>}
      {outcome?.kind === 'instant' && <p className="text-sm text-teal">Sent instantly</p>}
    </form>
  )
}

// Cancel Withdrawal + Execute Withdrawal — two independent write flows,
// each with its own wallet→pending→confirmed/failed lifecycle. Unlike
// withdraw() (which can resolve two different ways, requiring receipt-log
// decoding), executeWithdraw() either succeeds or reverts — isConfirmed
// alone tells us it worked. No device/signature step: executeWithdraw just
// needs the timelock to have elapsed.
function SecurityQueueSection({
  token,
  decimals,
  hasPending,
  pendingAmount,
  pendingCountdown,
  isLocked,
  lockCountdown,
  onConfirmed,
}: {
  token: Token
  decimals: number | undefined
  hasPending: boolean | undefined
  pendingAmount: bigint | undefined
  pendingCountdown: number | undefined
  isLocked: boolean | undefined
  lockCountdown: number | undefined
  onConfirmed: () => void
}) {
  // pendingCountdown is lifted from TokenTab (same pattern as lockCountdown
  // below) so this section and the Security Status card tick from one shared
  // clock instead of two independently-anchored, slightly-drifting timers.
  const countdown = pendingCountdown
  const isReady = countdown !== undefined && countdown <= 0

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
    writeCancel({ ...watcherContract, functionName: 'cancelWithdraw', args: [token.address] })
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
    writeExecute({ ...watcherContract, functionName: 'executeWithdraw', args: [token.address] })
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
          <p className="text-sm opacity-80">
            {formatAmount(pendingAmount, decimals)} {token.symbol} queued
          </p>
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
          <button
            type="button"
            onClick={handleExecute}
            disabled={executeDisabled}
            className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
          >
            Execute Withdrawal
          </button>
          {executeDisabledReason && <span className="text-xs opacity-80">{executeDisabledReason}</span>}
        </div>
      </div>

      {cancelStatus && <p className="text-xs opacity-90">cancel status: {cancelStatus}</p>}
      {cancelHash && <p className="break-all text-xs opacity-70">cancel tx hash: {cancelHash}</p>}
      {cancelError && <p className="text-xs text-red">cancel error: {cancelError.message}</p>}

      {(executeStatus || executeHash || executeError) && (
        <div className="space-y-2 border-t border-current/10 pt-3">
          {executeStatus && <p className="text-xs opacity-90">execute status: {executeStatus}</p>}
          {executeHash && <p className="break-all text-xs opacity-70">execute tx hash: {executeHash}</p>}
          {executeError && <p className="text-xs text-red">execute error: {executeError.message}</p>}
        </div>
      )}
    </Card>
  )
}

function TokenTab({
  address,
  status,
  isLocked,
  remainingLockTime,
  onRefetchOverview,
  onViewContainment,
}: {
  address: Address
  status: TokenStatus
  isLocked: boolean | undefined
  remainingLockTime: bigint | undefined
  onRefetchOverview: () => void
  onViewContainment: () => void
}) {
  const { token, decimals } = status

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: refetchUserState,
  } = useReadContract({
    ...watcherContract,
    functionName: 'getUserState',
    args: [address, token.address],
  })
  const userState = data as UserState | undefined

  // After any write on this tab: refresh this token's detailed state AND the
  // cross-token overview (wallet/vault balances drive the tab bar's muted
  // state and this tab's active/get-started switch).
  // Stable identity — children use it as an effect dependency.
  const refetchAll = useCallback(() => {
    refetchUserState()
    onRefetchOverview()
  }, [refetchUserState, onRefetchOverview])

  // Token tabs remount on switch (keyed by token in App.tsx) — refetch on
  // activation so state that changed while the tab was hidden is reflected
  // immediately rather than waiting on a stale cache hit.
  useEffect(() => {
    refetchUserState()
  }, [refetchUserState])

  const hasPending = userState?.[2]
  const pendingAmount = userState?.[3]
  const remainingPendingTime = userState?.[4]

  // Shared with WithdrawForm/SecurityQueueSection/SecurityStatusCard below so
  // all of them show the exact same ticking numbers rather than independently
  // anchored (and thus slightly drifting) countdowns.
  const lockCountdown = useCountdownSeconds(isLocked ? remainingLockTime : undefined)
  const pendingCountdown = useCountdownSeconds(hasPending ? remainingPendingTime : undefined)

  // Inactive-state CTA: "Add X" reveals the deposit flow in place.
  const [isAdding, setIsAdding] = useState(false)

  const banner = isLocked && <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={onViewContainment} />

  if (status.isActive === undefined) {
    return <p className="text-sm text-cloud/70">Loading {token.symbol}…</p>
  }

  // Inactive: nothing in the wallet, nothing in the vault, nothing queued.
  // No balances, status or rules — just one call-to-action that opens the
  // deposit flow (which wraps ETH first for WETH). Once a deposit confirms,
  // the overview refetch flips isActive and the full layout takes over.
  // The Containment banner still shows: it's a vault-wide warning, not
  // part of this token's dashboard.
  if (!status.isActive) {
    return (
      <div className="max-w-md space-y-4">
        {banner}
        {isAdding ? (
          <Card className="border-cloud/10 bg-cloud/5 p-5">
            <h3 className="mb-2 font-manrope text-sm font-semibold text-cloud/80">Add {token.symbol}</h3>
            <DepositPanel status={status} address={address} onConfirmed={refetchAll} />
          </Card>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="rounded-lg bg-teal px-6 py-3 font-manrope text-sm font-semibold text-cloud hover:bg-teal/90"
          >
            Add {token.symbol}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-4">
      {banner}

      {isLoading && <p className="text-sm text-cloud/70">Loading {token.symbol} vault state…</p>}
      {isError && <p className="text-sm text-red">Error calling getUserState: {error?.message}</p>}

      <div className="grid gap-3 md:grid-cols-3">
        <BalanceCard balance={userState?.[0]} instantLimit={userState?.[1]} token={token} decimals={decimals} />
        <SecurityStatusCard isLocked={isLocked} hasPending={hasPending} />
      </div>

      <SecurityQueueSection
        token={token}
        decimals={decimals}
        hasPending={hasPending}
        pendingAmount={pendingAmount}
        pendingCountdown={pendingCountdown}
        isLocked={isLocked}
        lockCountdown={lockCountdown}
        onConfirmed={refetchAll}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-cloud/10 bg-cloud/5 p-5">
          <h3 className="mb-2 font-manrope text-sm font-semibold text-cloud/80">Deposit</h3>
          <DepositPanel status={status} address={address} onConfirmed={refetchAll} />
        </Card>
        <Card className="border-cloud/10 bg-cloud/5 p-5">
          <h3 className="mb-2 font-manrope text-sm font-semibold text-cloud/80">Withdraw</h3>
          <WithdrawForm
            address={address}
            token={token}
            decimals={decimals}
            vaultBalance={userState?.[0]}
            hasPending={hasPending}
            isLocked={isLocked}
            lockCountdown={lockCountdown}
            onConfirmed={refetchAll}
          />
        </Card>
      </div>
    </div>
  )
}

export default TokenTab
