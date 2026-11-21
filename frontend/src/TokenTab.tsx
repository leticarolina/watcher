import { useCallback, useEffect, useState } from 'react'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { decodeEventLog, type Address, type TransactionReceipt } from 'viem'
import { watcherAbi, watcherContract } from './lib/contract'
import { formatAmount, formatDuration, parseAmount, useCountdownSeconds } from './lib/format'
import type { Token } from './lib/tokens'
import type { TokenStatus } from './lib/useTokenOverview'
import ContainmentLockBanner from './ContainmentLockBanner'
import DepositPanel from './DepositPanel'
import { RulesSummary } from './SecurityRules'
import {
  ClockIcon,
  LockIcon,
  PageHeading,
  Panel,
  ShieldCheckIcon,
  StatusCard,
  btnPrimary,
  btnSecondary,
  inputClass,
} from './ui'

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
    <Panel className="p-5 md:col-span-3">
      <p className="text-xs font-medium uppercase tracking-wider text-sand/70">Vault balance</p>
      <p className="mt-3 text-4xl font-semibold tracking-tight text-cloud tabular-nums sm:text-5xl">
        {formatAmount(balance, decimals)} <span className="text-2xl font-medium text-sand/60">{token.symbol}</span>
      </p>
      <p className="mt-2 text-sm text-sand/60">
        Instant withdrawal limit:{' '}
        <span className="font-mono text-sand">
          {formatAmount(instantLimit, decimals)} {token.symbol}
        </span>
      </p>
    </Panel>
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
  if (isLocked) {
    return (
      <StatusCard tone="lock" icon={<LockIcon />} label="Security status" title="Contained" className="md:col-span-2">
        <p>Containment Mode is freezing all withdrawals.</p>
      </StatusCard>
    )
  }
  if (hasPending) {
    return (
      <StatusCard tone="warn" icon={<ClockIcon />} label="Security status" title="Pending review" className="md:col-span-2">
        <p>A withdrawal is waiting in the security queue.</p>
      </StatusCard>
    )
  }
  return (
    <StatusCard tone="guard" icon={<ShieldCheckIcon />} label="Security status" title="Healthy" className="md:col-span-2">
      <p>All protection rules are active.</p>
    </StatusCard>
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
          className={inputClass}
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
          className={btnPrimary}
        >
          Withdraw
        </button>
      </div>
      {validation && <p className="text-xs text-sand/70">{validation}</p>}
      {lockedReason && <p className="text-xs text-lock">{lockedReason}</p>}
      {writeError && <p className="text-xs text-alert">error: {writeError.message}</p>}
      {outcome?.kind === 'instant' && <p className="text-sm font-medium text-guard">Sent instantly</p>}
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

  // Full-width Pending (Warn) action bar: what's queued on the left, the two
  // actions on the right.
  return (
    <div className="status-card tone-warn space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="status-pill tone-warn flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <ClockIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="tone-text text-sm font-semibold">Pending withdrawal</p>
            <p className="text-sm text-sand">
              <span className="font-mono text-cloud">
                {formatAmount(pendingAmount, decimals)} {token.symbol}
              </span>
              <span className="mx-2 text-sand/40" aria-hidden="true">
                ·
              </span>
              {isReady ? 'Ready to execute' : <>Unlocks in <span className="font-mono">{countdownText}</span></>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {executeDisabledReason && <span className="text-xs text-lock">{executeDisabledReason}</span>}
          <button type="button" onClick={handleCancel} disabled={isCancelBusy} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={handleExecute} disabled={executeDisabled} className={btnPrimary}>
            Execute
          </button>
        </div>
      </div>

      {(cancelStatus || cancelHash || cancelError || executeStatus || executeHash || executeError) && (
        <div className="space-y-1 border-t border-warn/20 pt-3 text-xs">
          {cancelStatus && <p className="text-sand">cancel status: {cancelStatus}</p>}
          {cancelHash && <p className="break-all font-mono text-sand/60">cancel tx hash: {cancelHash}</p>}
          {cancelError && <p className="text-alert">cancel error: {cancelError.message}</p>}
          {executeStatus && <p className="text-sand">execute status: {executeStatus}</p>}
          {executeHash && <p className="break-all font-mono text-sand/60">execute tx hash: {executeHash}</p>}
          {executeError && <p className="text-alert">execute error: {executeError.message}</p>}
        </div>
      )}
    </div>
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

  const heading = <PageHeading title={`${token.symbol} vault`} subtitle="Your assets, secured on-chain." />

  if (status.isActive === undefined) {
    return (
      <div className="space-y-6">
        {heading}
        <p className="text-sm text-sand/70">Loading {token.symbol}…</p>
      </div>
    )
  }

  // Inactive: nothing in the wallet, nothing in the vault, nothing queued.
  // No balances, status or rules — just one call-to-action that opens the
  // deposit flow (which wraps ETH first for WETH). Once a deposit confirms,
  // the overview refetch flips isActive and the full layout takes over.
  // The Containment banner still shows: it's a vault-wide warning, not
  // part of this token's dashboard.
  if (!status.isActive) {
    return (
      <div className="space-y-6">
        {heading}
        {banner}
        <Panel className="max-w-xl p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-sand/70">Vault balance</p>
          {isAdding ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-cloud">Add {token.symbol}</h3>
              <DepositPanel status={status} address={address} onConfirmed={refetchAll} />
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-sand/70">
                You don't have any {token.symbol} protected yet. Deposit some to put it under Watcher's rules.
              </p>
              <button type="button" onClick={() => setIsAdding(true)} className={btnPrimary}>
                Add {token.symbol}
              </button>
            </div>
          )}
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {heading}
      {banner}

      {isLoading && <p className="text-sm text-sand/70">Loading {token.symbol} vault state…</p>}
      {isError && <p className="text-sm text-alert">Error calling getUserState: {error?.message}</p>}

      <div className="grid gap-4 md:grid-cols-5">
        <BalanceCard
          balance={userState?.[0]}
          instantLimit={userState?.[1]}
          token={token}
          decimals={decimals}
        />
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-cloud">Deposit</h3>
          <DepositPanel status={status} address={address} onConfirmed={refetchAll} />
        </Panel>
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-cloud">Withdraw</h3>
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
        </Panel>
      </div>

      <RulesSummary />
    </div>
  )
}

export default TokenTab
