import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { zeroAddress } from 'viem'
import { WATCHER_ADDRESS, watcherContract } from './lib/contract'
import { formatAmount, formatDuration, maskAddress, useCountdownSeconds } from './lib/format'
import { TOKENS, type TokenSlug } from './lib/tokens'
import { pickDefaultToken, useTokenOverview, type TokenStatus } from './lib/useTokenOverview'
import ContainmentLockBanner from './ContainmentLockBanner'
import IntroOverlay from './IntroOverlay'
import Onboarding from './Onboarding'
import { isSetupDone } from './lib/setup'
import SecurityRules, { RulesSummary } from './SecurityRules'
import TokenTab from './TokenTab'
import {
  AlertIcon,
  ArcBackdrop,
  ChevronRightIcon,
  CoinsIcon,
  HomeIcon,
  RecoveryIcon,
  SettingsIcon,
  ShieldIcon,
  ClockIcon,
  KeyIcon,
  LockIcon,
  PageHeading,
  Panel,
  ShieldCheckIcon,
  StatusCard,
  StatusPill,
  UnlockIcon,
  btnPrimary,
  btnSecondary,
  inputClass,
  type Motif,
} from './ui'

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
    <div className="max-w-2xl space-y-6">
      <PageHeading
        title="Containment"
        subtitle="Freeze all withdrawals for a fixed duration if you suspect your wallet has been compromised."
      />

      {isLocked ? (
        <StatusCard tone="lock" icon={<LockIcon />} label="Containment Mode" title="Active — vault contained">
          <p>Unlocks at {unlockDate}</p>
          <p className="text-sand/70">
            Remaining:{' '}
            <span className="font-mono">{lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}</span>
          </p>
        </StatusCard>
      ) : (
        <StatusCard tone="guard" icon={<UnlockIcon />} label="Containment Mode" title="Inactive">
          <p>Withdrawals follow your normal protection rules.</p>
        </StatusCard>
      )}

      <Panel className="p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-sand/80">Lock duration</span>
              <span className="text-sm font-semibold text-cloud">
                {formatDuration(durationSeconds ?? sliderMin ?? 0)}
              </span>
            </div>

            {sliderMin !== undefined && sliderMax !== undefined ? (
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={600}
                value={durationSeconds ?? sliderMin}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                className="w-full accent-lock"
              />
            ) : (
              <p className="text-sm text-sand/60">Loading duration limits…</p>
            )}
          </div>

          {minLockDuration !== undefined && maxLockDuration !== undefined && (
            <p className="text-xs text-sand/60">
              Allowed range: {formatDuration(Number(minLockDuration))} – {formatDuration(Number(maxLockDuration))}
            </p>
          )}
          {validationError && <p className="text-xs text-alert">{validationError}</p>}

          <p className="status-card tone-warn px-3 py-2 text-xs text-sand">
            Activating Containment Mode auto-cancels any pending Security Queue withdrawal and refunds it to your
            vault balance.
          </p>

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-lock px-4 py-2 text-sm font-semibold text-cloud transition-colors hover:bg-lock/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Activate Containment Mode
          </button>

          {status && <p className="text-sm text-sand">status: {status}</p>}
          {hash && <p className="break-all font-mono text-xs text-sand/60">tx hash: {hash}</p>}
          {writeError && <p className="text-xs text-alert">error: {writeError.message}</p>}
        </form>
      </Panel>
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

  // The single `safeAddress(user)` getter is gone — the contract now has two
  // slots (0 = primary, 1 = backup). This tab still only manages the primary
  // slot, preserving the previous single-address behavior.
  // TODO(safe-slots): show/manage the backup slot (getSafeAddresses()[1]).
  const { data: safeAddressesData, refetch: refetchSafeAddress } = useReadContract({
    ...watcherContract,
    functionName: 'getSafeAddresses',
    args: [address],
  })
  const { data: pendingChangeData, refetch: refetchPendingChange } = useReadContract({
    ...watcherContract,
    functionName: 'getPendingSafeChange',
    args: [address],
  })

  const currentSafe = (safeAddressesData as readonly [`0x${string}`, `0x${string}`] | undefined)?.[0]
  // getPendingSafeChange now returns (newSafe, slot, remainingTime).
  // TODO(safe-slots): surface which slot (pending?.[1]) the change targets.
  const pending = pendingChangeData as readonly [`0x${string}`, number, bigint] | undefined
  const pendingSafe = pending?.[0]
  const pendingRemaining = pending?.[2]

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
    // Signature is now requestSafeAddressChange(uint8 slot, address newSafe).
    // Slot 0 (primary) keeps the old "replace my recovery address" behavior.
    // TODO(safe-slots): let the user pick slot 0 or 1.
    writeContract({ ...watcherContract, functionName: 'requestSafeAddressChange', args: [0, inputAddress] })
  }

  const handleConfirm = () => {
    writeContract({ ...watcherContract, functionName: 'confirmSafeAddressChange', args: [] })
  }

  const handleCancel = () => {
    writeContract({ ...watcherContract, functionName: 'cancelSafeAddressChange', args: [] })
  }

  const statusBlock = (
    <>
      {status && <p className="text-sm text-sand">status: {status}</p>}
      {hash && <p className="break-all font-mono text-xs text-sand/60">tx hash: {hash}</p>}
      {writeError && <p className="text-xs text-alert">error: {writeError.message}</p>}
    </>
  )

  const addressInput = (
    <input
      type="text"
      value={inputAddress}
      onChange={(e) => setInputAddress(e.target.value)}
      placeholder="0x..."
      className={`${inputClass} font-mono`}
    />
  )

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeading
        title="Recovery"
        subtitle="A trusted backup address that can help recover your account. Changing it after the first time takes a 24-hour delay."
      />

      {isLocked && <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={onViewContainment} />}

      {hasPendingChange ? (
        <>
          <StatusCard tone="warn" icon={<ClockIcon />} label="Trusted recovery address" title="Change pending">
            <p>
              New address:{' '}
              <span className="font-mono text-cloud" title={pendingSafe}>
                {maskAddress(pendingSafe)}
              </span>
            </p>
            <p>
              Unlocks in <span className="font-mono">{countdown !== undefined ? formatDuration(countdown) : '…'}</span>
            </p>
          </StatusCard>
          <Panel className="space-y-3 p-5">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={countdown === undefined || countdown > 0 || isBusy}
                className={btnPrimary}
              >
                Confirm Change
              </button>
              <button type="button" onClick={handleCancel} disabled={isBusy} className={btnSecondary}>
                Cancel Change
              </button>
            </div>
            {countdown !== undefined && countdown > 0 && (
              <p className="text-xs text-sand/60">Confirm Change unlocks once the 24h delay finishes.</p>
            )}
            {statusBlock}
          </Panel>
        </>
      ) : hasSafeSet ? (
        <>
          <StatusCard tone="recovery" icon={<KeyIcon />} label="Trusted recovery address" title="Recovery address set">
            <p className="font-mono text-cloud" title={currentSafe}>
              {maskAddress(currentSafe)}
            </p>
          </StatusCard>
          <Panel className="space-y-3 p-5">
            <h3 className="text-sm font-semibold text-cloud">Change recovery address</h3>
            <form onSubmit={handleRequestChange} className="flex flex-wrap gap-2">
              {addressInput}
              <button type="submit" disabled={!isValidAddress || isBusy} className={btnPrimary}>
                Request Change
              </button>
            </form>
            <p className="text-xs text-sand/60">Changes take effect 24 hours after being requested.</p>
            {statusBlock}
          </Panel>
        </>
      ) : (
        <>
          <StatusCard tone="warn" icon={<AlertIcon />} label="Trusted recovery address" title="Not set">
            <p>Add a backup address you control so your funds have somewhere safe to go.</p>
          </StatusCard>
          <Panel className="space-y-3 p-5">
            <h3 className="text-sm font-semibold text-cloud">Set recovery address</h3>
            <form onSubmit={handleSet} className="flex flex-wrap gap-2">
              {addressInput}
              <button type="submit" disabled={!isValidAddress || isBusy} className={btnPrimary}>
                Set Trusted Recovery Address
              </button>
            </form>
            {statusBlock}
          </Panel>
        </>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Shared status helpers for the multi-asset views.                       */
/* Read-only: everything comes from data the shell already fetches.       */
/* ---------------------------------------------------------------------- */

// Vault-wide state, most severe first: a Containment lock outranks pending
// withdrawals (activating it auto-cancels them).
function VaultStatusCard({
  statuses,
  isLocked,
  lockCountdown,
}: {
  statuses: Record<TokenSlug, TokenStatus>
  isLocked: boolean | undefined
  lockCountdown: number | undefined
}) {
  const pendingTokens = TOKENS.filter((t) => statuses[t.slug].hasPending)
  if (isLocked) {
    return (
      <StatusCard tone="lock" icon={<LockIcon />} label="Vault status" title="Contained" className="h-full">
        <p>
          Withdrawals frozen — unlocks in{' '}
          <span className="font-mono">{lockCountdown !== undefined ? formatDuration(lockCountdown) : '…'}</span>
        </p>
      </StatusCard>
    )
  }
  if (pendingTokens.length > 0) {
    return (
      <StatusCard tone="warn" icon={<ClockIcon />} label="Vault status" title="Pending review" className="h-full">
        <p>
          {pendingTokens.map((t) => t.symbol).join(', ')} {pendingTokens.length === 1 ? 'has' : 'have'} a withdrawal
          in the security queue.
        </p>
      </StatusCard>
    )
  }
  return (
    <StatusCard tone="guard" icon={<ShieldCheckIcon />} label="Vault status" title="Healthy" className="h-full">
      <p>No active threats.</p>
    </StatusCard>
  )
}

function TokenStatusPill({ status, isLocked }: { status: TokenStatus; isLocked: boolean | undefined }) {
  if (status.isActive === undefined) return <span className="text-xs text-sand/50">Loading…</span>
  if (isLocked && status.isActive)
    return (
      <StatusPill tone="lock" icon={<LockIcon />}>
        Contained
      </StatusPill>
    )
  if (status.hasPending)
    return (
      <StatusPill tone="warn" icon={<ClockIcon />}>
        Pending
      </StatusPill>
    )
  if (status.isActive)
    return (
      <StatusPill tone="guard" icon={<ShieldCheckIcon />}>
        Protected
      </StatusPill>
    )
  return <span className="text-xs text-sand/50">Not in use</span>
}

/* ---------------------------------------------------------------------- */
/* Overview — default /app view: every asset at a glance.                 */
/* ---------------------------------------------------------------------- */

function OverviewPage({
  address,
  statuses,
  isLocked,
  remainingLockTime,
  isLoading,
  onViewContainment,
}: {
  statuses: Record<TokenSlug, TokenStatus>
  isLocked: boolean | undefined
  remainingLockTime: bigint | undefined
  isLoading: boolean
  onViewContainment: () => void
  address: `0x${string}`
}) {
  const lockCountdown = useCountdownSeconds(isLocked ? remainingLockTime : undefined)
  // "Protected" = something in the vault or queued for this token.
  const protectedTokens = TOKENS.filter((t) => (statuses[t.slug].vaultBalance ?? 0n) > 0n || statuses[t.slug].hasPending)
  const pendingTokens = TOKENS.filter((t) => statuses[t.slug].hasPending)
  const allLoaded = TOKENS.every((t) => statuses[t.slug].isActive !== undefined)
  const isNewVault = allLoaded && protectedTokens.length === 0

  // First visit with an empty vault → guided setup (once per wallet; exiting
  // or finishing setup marks it done).
  if (isNewVault && !isSetupDone(address)) return <Navigate to="/app/setup" replace />

  return (
    <div className="space-y-6">
      <PageHeading title="Overview" subtitle="Your assets, secured on-chain." />
      {isLocked && <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={onViewContainment} />}

      {isNewVault && (
        <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-cloud">Your vault is empty</p>
            <p className="mt-0.5 text-sm text-sand/60">
              Set it up in a few steps: pick an asset, deposit, and choose your protection.
            </p>
          </div>
          <Link to="/app/setup" className={`${btnPrimary} shrink-0 text-center`}>
            Start setup
          </Link>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* No price feed in the app, so this counts assets rather than
            summing a fiat total across different tokens. */}
        <Panel className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-sand/70">Protected assets</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-cloud">
            {isLoading ? '…' : protectedTokens.length}
            <span className="ml-2 text-lg font-medium text-sand/60">of {TOKENS.length}</span>
          </p>
          <p className="mt-1 text-sm text-sand/60">
            {protectedTokens.length > 0
              ? `${protectedTokens.map((t) => t.symbol).join(' · ')} in your vault`
              : 'Deposit a token to put it under Watcher’s rules'}
          </p>
        </Panel>
        <VaultStatusCard statuses={statuses} isLocked={isLocked} lockCountdown={lockCountdown} />
      </div>

      {pendingTokens.length > 0 && (
        <div className="space-y-2">
          {pendingTokens.map((t) => (
            <Link
              key={t.slug}
              to={`/app/${t.slug}`}
              className="status-card tone-warn flex items-center gap-3 px-4 py-3 transition-opacity hover:opacity-90"
            >
              <ClockIcon className="tone-text h-5 w-5 shrink-0" />
              <span className="flex-1 text-sm">
                <span className="tone-text font-semibold">Pending {t.symbol} withdrawal</span>
                <span className="text-sand"> — review, cancel or execute</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 text-sand/60" />
            </Link>
          ))}
        </div>
      )}

      <Panel>
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold text-cloud">Assets</h2>
          <span className="text-xs text-sand/60">{TOKENS.length} supported</span>
        </div>
        <ul className="divide-y divide-stone px-5">
          {TOKENS.map((t) => {
            const st = statuses[t.slug]
            return (
              <li key={t.slug}>
                <Link to={`/app/${t.slug}`} className="group flex items-center gap-4 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone/60 text-sand">
                    <ShieldIcon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-cloud">{t.symbol}</span>
                    <span className="block truncate font-mono text-xs text-sand/60">
                      Wallet: {formatAmount(st.walletBalance, st.decimals)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-mono text-sm text-cloud tabular-nums">
                      {formatAmount(st.vaultBalance, st.decimals)} {t.symbol}
                    </span>
                    <TokenStatusPill status={st} isLocked={isLocked} />
                  </span>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-sand/40 transition-colors group-hover:text-cloud" />
                </Link>
              </li>
            )
          })}
        </ul>
      </Panel>

      <RulesSummary />
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Security — vault status, the security tools, and rule details.         */
/* On mobile this is also the hub for Recovery / Containment / Settings.  */
/* ---------------------------------------------------------------------- */

const SECURITY_TOOLS: { to: string; label: string; description: string; icon: ReactNode }[] = [
  {
    to: '/app/recovery',
    label: 'Recovery',
    description: 'Trusted backup address for your funds',
    icon: <RecoveryIcon className="h-5 w-5" />,
  },
  {
    to: '/app/containment',
    label: 'Containment',
    description: 'Freeze all withdrawals in an emergency',
    icon: <LockIcon className="h-5 w-5" />,
  },
  {
    to: '/app/settings',
    label: 'Settings',
    description: 'Network and contract details',
    icon: <SettingsIcon className="h-5 w-5" />,
  },
]

function SecurityPage({
  statuses,
  isLocked,
  remainingLockTime,
  onViewContainment,
}: {
  statuses: Record<TokenSlug, TokenStatus>
  isLocked: boolean | undefined
  remainingLockTime: bigint | undefined
  onViewContainment: () => void
}) {
  const lockCountdown = useCountdownSeconds(isLocked ? remainingLockTime : undefined)

  return (
    <div className="space-y-6">
      <PageHeading title="Security" subtitle="How Watcher is guarding your vault." />
      {isLocked && <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={onViewContainment} />}

      <VaultStatusCard statuses={statuses} isLocked={isLocked} lockCountdown={lockCountdown} />

      <Panel>
        <ul className="divide-y divide-stone">
          {SECURITY_TOOLS.map((tool) => (
            <li key={tool.to}>
              <Link to={tool.to} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-stone/30">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone/60 text-sand">
                  {tool.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-cloud">{tool.label}</span>
                  <span className="block text-xs text-sand/60">{tool.description}</span>
                </span>
                <ChevronRightIcon className="h-4 w-4 text-sand/40 transition-colors group-hover:text-cloud" />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <SecurityRules />
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Settings page — read-only connection/contract details for now.         */
/* ---------------------------------------------------------------------- */

function SettingsPage({ address }: { address: `0x${string}` }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Network', value: 'Sepolia' },
    {
      label: 'Connected wallet',
      value: (
        <span className="font-mono" title={address}>
          {maskAddress(address)}
        </span>
      ),
    },
    {
      label: 'Watcher contract',
      value: (
        <a
          href={`https://sepolia.etherscan.io/address/${WATCHER_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono underline decoration-stone underline-offset-4 hover:decoration-sand"
          title={WATCHER_ADDRESS}
        >
          {maskAddress(WATCHER_ADDRESS)}
        </a>
      ),
    },
    { label: 'Supported tokens', value: TOKENS.map((t) => t.symbol).join(' · ') },
    {
      label: 'Transaction history',
      value: (
        <a
          href={`https://sepolia.etherscan.io/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-stone underline-offset-4 hover:decoration-sand"
        >
          View on Etherscan
        </a>
      ),
    },
  ]

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeading title="Settings" subtitle="Connection and contract details." />
      <Panel className="divide-y divide-stone">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
            <span className="text-sand/70">{row.label}</span>
            <span className="text-cloud">{row.value}</span>
          </div>
        ))}
      </Panel>
      {/* TODO(threshold) / TODO(safe-slots): configurable Rule 1 threshold and
          the backup recovery slot will live here once their panels exist. */}
      <p className="text-xs text-sand/50">
        Rule thresholds and a backup recovery address will be configurable here in a future release.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Dashboard app shell — full-width header (logo | network + wallet),     */
/* then two sliding tab bars:                                             */
/*   token tabs (per-token vaults)  |  vault-wide tabs                    */
/* Rendered under the /app/* route; landing page lives in LandingPage.tsx.*/
/*                                                                        */
/* On mobile the tab bars give way to a bottom nav (Overview / Assets /    */
/* Security); Recovery, Containment and Settings are reached from the     */
/* Security page there.                                                   */
/*                                                                        */
/*   /app             → Overview (all assets)                             */
/*   /app/assets      → auto-selects a token (see DefaultTokenRedirect)   */
/*   /app/weth|usdc|wbtc → Vault page for that token                      */
/*   /app/security    → Security overview                                 */
/*   /app/recovery    → Trusted Recovery Address                          */
/*   /app/containment → Containment Mode                                  */
/*   /app/settings    → Settings                                          */
/* ---------------------------------------------------------------------- */

// `icon` replaces the text label (label is then used as the accessible name).
type TabItem = { to: string; label: string; icon?: ReactNode; muted?: boolean; title?: string }

// One pill-style tab bar. Sliding active-tab pill: measured off the actual
// link's box (offsets are relative to `nav`, its positioned ancestor) rather
// than hardcoded, so it stays correct regardless of label length.
// Recomputed whenever the active route changes; the CSS transition is what
// makes it slide instead of jumping. Each bar owns its own pill and hides it
// while the active route belongs to the other bar.
function TabBar({ items, label }: { items: TabItem[]; label: string }) {
  const { pathname } = useLocation()
  const activeTo = items.find((item) => pathname === item.to)?.to

  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [pillRect, setPillRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    const activeLink = activeTo ? linkRefs.current[activeTo] : null
    setPillRect(
      activeLink
        ? {
            left: activeLink.offsetLeft,
            top: activeLink.offsetTop,
            width: activeLink.offsetWidth,
            height: activeLink.offsetHeight,
          }
        : null,
    )
  }, [activeTo])

  return (
    <nav aria-label={label} className="relative flex gap-1">
      {pillRect && (
        <span
          aria-hidden="true"
          className="absolute rounded-full bg-cloud transition-all duration-200 ease-out"
          style={{ left: pillRect.left, top: pillRect.top, width: pillRect.width, height: pillRect.height }}
        />
      )}
      {items.map((item) => {
        const isActive = item.to === activeTo
        // Muted = inactive token: greyed out but still clickable.
        const tone = isActive
          ? item.muted
            ? 'font-semibold text-midnight/60'
            : 'font-semibold text-midnight'
          : item.muted
            ? 'text-sand/25 hover:text-sand/50'
            : 'text-sand/60 hover:text-cloud'
        return (
          <Link
            key={item.to}
            to={item.to}
            title={item.title ?? (item.icon ? item.label : undefined)}
            aria-label={item.icon ? item.label : undefined}
            aria-current={isActive ? 'page' : undefined}
            ref={(el) => {
              linkRefs.current[item.to] = el
            }}
            className={`relative z-10 flex items-center rounded-full py-1.5 text-sm transition-colors ${
              item.icon ? 'px-2.5' : 'px-4'
            } ${tone}`}
          >
            {item.icon ?? item.label}
          </Link>
        )
      })}
    </nav>
  )
}

const VAULT_TABS: TabItem[] = [
  { to: '/app/security', label: 'Security' },
  { to: '/app/recovery', label: 'Recovery' },
  { to: '/app/containment', label: 'Containment' },
  { to: '/app/settings', label: 'Settings', icon: <SettingsIcon className="h-5 w-5" /> },
]

// Decorative arcs only behind Recovery and Containment — Vault/Security stay
// clean for readability.
const PAGE_MOTIFS: Record<string, Motif> = {
  '/app/setup': 'horizon',
  '/app/recovery': 'orbit',
  '/app/containment': 'corner',
}

const TOKEN_PATHS = TOKENS.map((t) => `/app/${t.slug}`)
const SECURITY_PATHS = ['/app/security', '/app/recovery', '/app/containment', '/app/settings']

const BOTTOM_NAV: { to: string; label: string; icon: ReactNode; isActive: (pathname: string) => boolean }[] = [
  { to: '/app', label: 'Overview', icon: <HomeIcon />, isActive: (p) => p === '/app' || p === '/app/' },
  { to: '/app/assets', label: 'Assets', icon: <CoinsIcon />, isActive: (p) => TOKEN_PATHS.includes(p) },
  { to: '/app/security', label: 'Security', icon: <ShieldIcon />, isActive: (p) => SECURITY_PATHS.includes(p) },
]

// Mobile-only bottom navigation.
function BottomNav() {
  const { pathname } = useLocation()
  return (
    <nav
      aria-label="Dashboard"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-stone bg-slate/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {BOTTOM_NAV.map((item) => {
        const active = item.isActive(pathname)
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              active ? 'text-cloud' : 'text-sand/50'
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

// /app/assets: wait for the cross-token overview, then jump to the
// most relevant token (replace, so Back doesn't bounce through /app).
function DefaultTokenRedirect({
  statuses,
  isLoading,
}: {
  statuses: Record<TokenSlug, TokenStatus>
  isLoading: boolean
}) {
  const allLoaded = TOKENS.every((t) => statuses[t.slug].isActive !== undefined)
  if (isLoading || !allLoaded) {
    return (
      <div className="space-y-6">
        <PageHeading title="Assets" subtitle="Your assets, secured on-chain." />
        <p className="text-sm text-sand/70">Loading your vaults…</p>
      </div>
    )
  }
  return <Navigate to={`/app/${pickDefaultToken(statuses)}`} replace />
}

// Skip the eye intro entirely for users who prefer reduced motion.
function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function DashboardApp() {
  const { address, isConnected } = useAccount()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const { statuses, isLoading: isOverviewLoading, refetch: refetchOverview } = useTokenOverview(address)

  // Containment Mode is vault-wide (not per-token), so it's read from the
  // token-independent getters and shared by every page.
  const { data: isLockedData, refetch: refetchIsLocked } = useReadContract({
    ...watcherContract,
    functionName: 'isVaultLocked',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })
  const { data: remainingLockTimeData, refetch: refetchRemainingLockTime } = useReadContract({
    ...watcherContract,
    functionName: 'getRemainingLockTime',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })
  const isLocked = isLockedData as boolean | undefined
  const remainingLockTime = remainingLockTimeData as bigint | undefined

  // Stable identity — children use these as effect dependencies.
  const refetchOverviewStable = useCallback(() => {
    refetchOverview()
  }, [refetchOverview])
  // Activating Containment Mode auto-cancels pending withdrawals across every
  // token, so balances/pending state are refreshed along with the lock.
  const refetchAfterLock = useCallback(() => {
    refetchIsLocked()
    refetchRemainingLockTime()
    refetchOverview()
  }, [refetchIsLocked, refetchRemainingLockTime, refetchOverview])
  const goToContainment = useCallback(() => navigate('/app/containment'), [navigate])

  const isReady = isConnected && Boolean(address)

  // The eye intro plays once per entry into /app (this component stays
  // mounted while switching tabs, so tab changes don't replay it).
  const [introActive, setIntroActive] = useState(shouldPlayIntro)
  // Remembered separately so the page's reveal-zoom still applies after the
  // overlay unmounts.
  const [playedIntro] = useState(introActive)
  const handleIntroDone = useCallback(() => setIntroActive(false), [])
  const motif: Motif | undefined = isReady ? PAGE_MOTIFS[pathname] : 'horizon'

  const tokenOnlyTabs: TabItem[] = TOKENS.map((t) => {
    const muted = statuses[t.slug].isActive === false
    return {
      to: `/app/${t.slug}`,
      label: t.symbol,
      muted,
      title: muted ? `No ${t.symbol} in your wallet or vault yet` : undefined,
    }
  })
  const tokenTabs: TabItem[] = [{ to: '/app', label: 'Overview' }, ...tokenOnlyTabs]
  const onTokenPage = TOKEN_PATHS.includes(pathname)
  // Setup is a focused flow: no tab bars or bottom nav while it's open.
  const inSetup = pathname === '/app/setup'
  const onSecuritySubpage = SECURITY_PATHS.includes(pathname) && pathname !== '/app/security'

  return (
    <div className="flex min-h-screen flex-col bg-midnight font-inter text-cloud">
      {introActive && <IntroOverlay onDone={handleIntroDone} />}
      <div className={`flex min-w-0 flex-1 flex-col ${playedIntro ? 'intro-page-reveal' : ''}`}>
        {/* Header stays full-width edge-to-edge. */}
        <header className="flex items-center justify-between gap-3 border-b border-stone px-6 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-cloud.png" alt="" className="h-7 w-auto" />
            <span className="hidden text-base font-semibold tracking-tight sm:inline">WATCHER</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-stone bg-slate px-2.5 py-1 text-xs font-medium text-sand/80">
              Sepolia
            </span>
            <ConnectButton />
          </div>
        </header>

        {/* Desktop: Overview + token tabs on the left, vault-wide tabs on the
            right. Same centered width as the page content. */}
        <div className={`hidden border-b border-stone ${inSetup ? '' : 'md:block'}`}>
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-2">
            <TabBar items={tokenTabs} label="Token vaults" />
            <TabBar items={VAULT_TABS} label="Vault-wide settings" />
          </div>
        </div>
        {/* Mobile: token switcher only while viewing a token (Assets). */}
        {isReady && onTokenPage && (
          <div className="border-b border-stone px-4 py-2 md:hidden">
            <TabBar items={tokenOnlyTabs} label="Token vaults" />
          </div>
        )}

        {/* pb-24 on mobile leaves room for the fixed bottom nav. */}
        <main className={`relative flex-1 md:pb-0 ${inSetup ? 'pb-8' : 'pb-24'}`}>
          {motif && <ArcBackdrop motif={motif} />}
          <div className="relative mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:py-8">
            {isReady && onSecuritySubpage && (
              <Link
                to="/app/security"
                className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sand/70 hover:text-cloud md:hidden"
              >
                <ChevronRightIcon className="h-4 w-4 rotate-180" />
                Security
              </Link>
            )}
            {!isReady || !address ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Connect a wallet to continue</h1>
                <p className="max-w-sm text-sm text-sand/70">
                  Watcher reads your vault directly from the Sepolia contract — nothing to sign until you act.
                </p>
                <ConnectButton />
              </div>
            ) : (
              <Routes>
                <Route
                  index
                  element={
                    <OverviewPage
                      address={address}
                      statuses={statuses}
                      isLocked={isLocked}
                      remainingLockTime={remainingLockTime}
                      isLoading={isOverviewLoading}
                      onViewContainment={goToContainment}
                    />
                  }
                />
                <Route
                  path="setup"
                  element={
                    TOKENS.every((t) => statuses[t.slug].isActive !== undefined) ? (
                      <Onboarding
                        address={address}
                        statuses={statuses}
                        defaultToken={pickDefaultToken(statuses)}
                        onRefetchOverview={refetchOverviewStable}
                      />
                    ) : (
                      <p className="text-sm text-sand/70">Loading your wallet…</p>
                    )
                  }
                />
                <Route path="assets" element={<DefaultTokenRedirect statuses={statuses} isLoading={isOverviewLoading} />} />

                {TOKENS.map((t) => (
                  <Route
                    key={t.slug}
                    path={t.slug}
                    element={
                      // key: remount per token so form inputs / tx status
                      // never carry over from one token's page to another's.
                      <TokenTab
                        key={t.slug}
                        address={address}
                        status={statuses[t.slug]}
                        isLocked={isLocked}
                        remainingLockTime={remainingLockTime}
                        onRefetchOverview={refetchOverviewStable}
                        onViewContainment={goToContainment}
                      />
                    }
                  />
                ))}
                <Route
                  path="security"
                  element={
                    <SecurityPage
                      statuses={statuses}
                      isLocked={isLocked}
                      remainingLockTime={remainingLockTime}
                      onViewContainment={goToContainment}
                    />
                  }
                />
                <Route
                  path="containment"
                  element={
                    <ContainmentModeTab
                      address={address}
                      isLocked={isLocked}
                      remainingLockTime={remainingLockTime}
                      onConfirmed={refetchAfterLock}
                    />
                  }
                />
                <Route
                  path="recovery"
                  element={
                    <RecoveryTab
                      address={address}
                      isLocked={isLocked}
                      remainingLockTime={remainingLockTime}
                      onViewContainment={goToContainment}
                    />
                  }
                />
                <Route path="settings" element={<SettingsPage address={address} />} />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Routes>
            )}
          </div>
        </main>
      </div>
      {isReady && !inSetup && <BottomNav />}
    </div>
  )
}

export default DashboardApp
