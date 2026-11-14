import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { zeroAddress } from 'viem'
import { watcherContract } from './lib/contract'
import { formatDuration, maskAddress, useCountdownSeconds } from './lib/format'
import { TOKENS, type TokenSlug } from './lib/tokens'
import { pickDefaultToken, useTokenOverview, type TokenStatus } from './lib/useTokenOverview'
import Card from './Card'
import ContainmentLockBanner from './ContainmentLockBanner'
import SecurityRules from './SecurityRules'
import TokenTab from './TokenTab'

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
/* Dashboard app shell — logo + wordmark top-left, two tab bars:          */
/*   token tabs (per-token vaults)  |  vault-wide tabs (recovery, lock)   */
/* Rendered under the /app/* route; landing page lives in LandingPage.tsx.*/
/*                                                                        */
/*   /app             → auto-selects a token tab (see DefaultTokenRedirect)*/
/*   /app/weth|usdc|wbtc → TokenTab for that token                        */
/*   /app/recovery    → Trusted Recovery Address                          */
/*   /app/containment → Containment Mode                                  */
/* ---------------------------------------------------------------------- */

type TabItem = { to: string; label: string; muted?: boolean; title?: string }

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
            ? 'font-medium text-navy/60'
            : 'font-medium text-navy'
          : item.muted
            ? 'text-cloud/25 hover:text-cloud/50'
            : 'text-cloud/50 hover:text-cloud/80'
        return (
          <Link
            key={item.to}
            to={item.to}
            title={item.title}
            aria-current={isActive ? 'page' : undefined}
            ref={(el) => {
              linkRefs.current[item.to] = el
            }}
            className={`relative z-10 rounded-full px-4 py-1.5 text-sm transition-colors ${tone}`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

const VAULT_TABS: TabItem[] = [
  { to: '/app/recovery', label: 'Trusted Recovery Address' },
  { to: '/app/containment', label: 'Containment Mode' },
]

// /app with no tab: wait for the cross-token overview, then jump to the most
// relevant token tab (replace, so Back doesn't bounce through /app).
function DefaultTokenRedirect({
  statuses,
  isLoading,
}: {
  statuses: Record<TokenSlug, TokenStatus>
  isLoading: boolean
}) {
  const allLoaded = TOKENS.every((t) => statuses[t.slug].isActive !== undefined)
  if (isLoading || !allLoaded) return <p className="text-sm text-cloud/70">Loading your vaults…</p>
  return <Navigate to={`/app/${pickDefaultToken(statuses)}`} replace />
}

// Pathless layout route for the token tabs — renders the active token tab
// plus the shared Security Rules cards once below it. Rules are hidden on an
// inactive token, whose tab is just the "Add <token>" button.
function TokenLayout({ statuses }: { statuses: Record<TokenSlug, TokenStatus> }) {
  const { pathname } = useLocation()
  const activeToken = TOKENS.find((t) => pathname === `/app/${t.slug}`)
  const showRules = activeToken !== undefined && statuses[activeToken.slug].isActive === true
  return (
    <div className="space-y-6">
      <Outlet />
      {showRules && <SecurityRules />}
    </div>
  )
}

function DashboardApp() {
  const { address, isConnected } = useAccount()
  const navigate = useNavigate()

  const { statuses, isLoading: isOverviewLoading, refetch: refetchOverview } = useTokenOverview(address)

  // Containment Mode is vault-wide (not per-token), so it's read from the
  // token-independent getters and shared by every tab.
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

  const tokenTabs: TabItem[] = TOKENS.map((t) => {
    const muted = statuses[t.slug].isActive === false
    return {
      to: `/app/${t.slug}`,
      label: t.symbol,
      muted,
      title: muted ? `No ${t.symbol} in your wallet or vault yet` : undefined,
    }
  })

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

      {/* Independent centered column for the tab bars + tab content — a fixed
          max-width block floating in the middle of the page, unrelated to
          the header's full-width edges. Every tab shares this one wrapper
          so they all line up to the same width and alignment. */}
      <div className="mx-auto w-full max-w-4xl px-6">
        {/* Token tabs on the left, vault-wide tabs on the right; they stack
            on narrow screens. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cloud/10 py-2">
          <TabBar items={tokenTabs} label="Token vaults" />
          <TabBar items={VAULT_TABS} label="Vault-wide settings" />
        </div>

        <main className="py-4">
          {!isConnected || !address ? (
            <p className="text-sm text-cloud/60">Connect a wallet to continue.</p>
          ) : (
            <Routes>
              <Route index element={<DefaultTokenRedirect statuses={statuses} isLoading={isOverviewLoading} />} />
              <Route element={<TokenLayout statuses={statuses} />}>
                {TOKENS.map((t) => (
                  <Route
                    key={t.slug}
                    path={t.slug}
                    element={
                      // key: remount per token so form inputs / tx status
                      // never carry over from one token's tab to another's.
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
              </Route>
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
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  )
}

export default DashboardApp
