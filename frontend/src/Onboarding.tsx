import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import DepositPanel from './DepositPanel'
import { watcherContract } from './lib/contract'
import { formatAmount, maskAddress } from './lib/format'
import { markSetupDone } from './lib/setup'
import { TOKENS, type TokenSlug } from './lib/tokens'
import type { TokenStatus } from './lib/useTokenOverview'
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  KeyIcon,
  LargeWithdrawalIcon,
  LockIcon,
  Panel,
  ProbeIcon,
  ShieldCheckIcon,
  StatusPill,
  btnPrimary,
  btnSecondary,
  inputClass,
} from './ui'

/* ---------------------------------------------------------------------- */
/* Guided vault setup — /app/setup                                        */
/*                                                                        */
/* One decision per step, sensible defaults, every on-chain step either   */
/* optional or skippable. Commitment escalates gradually:                 */
/*   1. pick an asset (no tx)                                             */
/*   2. deposit (tx — skippable)                                          */
/*   3. protection: keep defaults (no tx) or tighten Rule 1 (tx)          */
/*   4. recovery address (tx — skippable, with a clear warning)           */
/*   5. review, then enter the dashboard                                  */
/*                                                                        */
/* Only the contract's real knobs are exposed: Rule 1's threshold is the  */
/* only configurable rule; the probe and rolling-window rules are fixed.  */
/* ---------------------------------------------------------------------- */

const STEPS = ['Choose asset', 'Deposit', 'Protection', 'Recovery', 'Review'] as const

function txStatusLabel(waiting: boolean, confirming: boolean, failed: boolean) {
  if (waiting) return 'Confirm in your wallet…'
  if (confirming) return 'Waiting for confirmation…'
  if (failed) return 'Transaction failed.'
  return null
}

/* ----------------------------- Stepper -------------------------------- */

function Stepper({ step }: { step: number }) {
  return (
    <div>
      {/* Mobile: compact "Step n of 5" + bar */}
      <div className="sm:hidden">
        <p className="text-xs font-medium text-sand/70">
          Step {step + 1} of {STEPS.length} · <span className="text-cloud">{STEPS[step]}</span>
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone">
          <div
            className="h-full rounded-full bg-guard transition-[width] duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>
      {/* Desktop: labelled steps */}
      <ol className="hidden items-center gap-2 sm:flex">
        {STEPS.map((label, i) => {
          const done = i < step
          const current = i === step
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  done ? 'status-pill tone-guard' : current ? 'bg-cloud text-midnight' : 'bg-stone text-sand/60'
                }`}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-xs font-medium ${current ? 'text-cloud' : 'text-sand/50'}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-stone" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <Panel className="p-5 sm:p-7">
      <h1 className="text-xl font-semibold tracking-tight text-cloud sm:text-2xl">{title}</h1>
      <p className="mt-1 text-sm leading-relaxed text-sand/70">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <div className="mt-7 flex flex-col-reverse gap-2 border-t border-stone pt-5 sm:flex-row sm:items-center sm:justify-between">
        {footer}
      </div>
    </Panel>
  )
}

/* ------------------------- Step 1: asset ------------------------------ */

function AssetStep({
  statuses,
  selected,
  onSelect,
  onNext,
}: {
  statuses: Record<TokenSlug, TokenStatus>
  selected: TokenSlug
  onSelect: (slug: TokenSlug) => void
  onNext: () => void
}) {
  return (
    <StepShell
      title="Welcome to Watcher"
      subtitle="Let's set up your vault. Pick the asset you want to protect first — each token gets its own isolated rules, and you can add the others any time."
      footer={
        <>
          <span className="hidden sm:block" />
          <button type="button" onClick={onNext} className={btnPrimary}>
            Continue
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Asset" className="grid gap-3 sm:grid-cols-3">
        {TOKENS.map((t) => {
          const st = statuses[t.slug]
          const active = selected === t.slug
          return (
            <button
              key={t.slug}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(t.slug)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active ? 'border-cloud/70 bg-stone/50' : 'border-stone hover:border-sand/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-cloud">{t.symbol}</span>
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    active ? 'border-cloud bg-cloud' : 'border-sand/40'
                  }`}
                  aria-hidden="true"
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-midnight" />}
                </span>
              </div>
              <p className="mt-3 text-xs text-sand/60">In your wallet</p>
              <p className="font-mono text-sm text-sand">{formatAmount(st.walletBalance, st.decimals)}</p>
              {t.wrapsNative && <p className="mt-1 text-[11px] text-sand/50">Sepolia ETH is wrapped automatically</p>}
            </button>
          )
        })}
      </div>
    </StepShell>
  )
}

/* ------------------------- Step 2: deposit ---------------------------- */

function DepositStep({
  status,
  address,
  deposited,
  onDeposited,
  onBack,
  onNext,
}: {
  status: TokenStatus
  address: Address
  deposited: boolean
  onDeposited: () => void
  onBack: () => void
  onNext: () => void
}) {
  const { token } = status
  return (
    <StepShell
      title={`Deposit ${token.symbol}`}
      subtitle={`Funds in your vault are covered by Watcher's rules from the moment they land. You can withdraw normally — only suspicious patterns get delayed.`}
      footer={
        <>
          <button type="button" onClick={onBack} className={btnSecondary}>
            Back
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {!deposited && (
              <button type="button" onClick={onNext} className={btnSecondary}>
                Skip — deposit later
              </button>
            )}
            <button type="button" onClick={onNext} disabled={!deposited} className={btnPrimary}>
              Continue
            </button>
          </div>
        </>
      }
    >
      {deposited ? (
        <div className="status-card tone-guard px-4 py-3">
          <p className="tone-text flex items-center gap-2 text-sm font-semibold">
            <ShieldCheckIcon className="h-4 w-4" />
            Deposit confirmed
          </p>
          <p className="mt-1 text-xs text-sand/80">
            Your {token.symbol} is in the vault. You can add more any time from the dashboard.
          </p>
        </div>
      ) : (
        <DepositPanel status={status} address={address} onConfirmed={onDeposited} />
      )}
    </StepShell>
  )
}

/* ------------------------ Step 3: protection -------------------------- */

const FIXED_RULES = [
  {
    icon: <ProbeIcon className="h-4 w-4" />,
    title: 'Probe detection',
    detail: 'A withdrawal under 5% of your balance flags the next one for review.',
  },
  {
    icon: <ClockIcon className="h-4 w-4" />,
    title: 'Rolling window',
    detail: 'Withdrawals adding up to over 30% within 72 hours are queued.',
  },
]

function ProtectionStep({
  address,
  onBack,
  onNext,
}: {
  address: Address
  onBack: () => void
  onNext: () => void
}) {
  const { data, refetch } = useReadContract({
    ...watcherContract,
    functionName: 'getThresholdState',
    args: [address],
  })
  const { data: minData } = useReadContract({ ...watcherContract, functionName: 'MIN_LARGE_WITHDRAW_PERCENT' })
  const thresholdState = data as readonly [bigint, bigint, bigint] | undefined
  const current = thresholdState ? Number(thresholdState[0]) : undefined
  const min = minData !== undefined ? Number(minData as bigint) : 10

  const [customizing, setCustomizing] = useState(false)
  const [percent, setPercent] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (percent === undefined && current !== undefined) setPercent(current)
  }, [current, percent])

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({ hash })
  useEffect(() => {
    if (isSuccess) {
      refetch()
      reset()
    }
  }, [isSuccess, refetch, reset])

  const busy = isPending || isConfirming
  // Onboarding only offers tightening: it applies instantly. Loosening is
  // queued for 24h on-chain and has no confirm UI yet, so it isn't offered.
  const canApply = percent !== undefined && current !== undefined && percent < current && !busy
  const statusLine = txStatusLabel(isPending, isConfirming, isError || Boolean(error))

  return (
    <StepShell
      title="Configure protection"
      subtitle="Watcher's recommended defaults are already active on your vault. Keep them, or make the large-withdrawal rule stricter."
      footer={
        <>
          <button type="button" onClick={onBack} className={btnSecondary}>
            Back
          </button>
          <button type="button" onClick={onNext} disabled={busy} className={btnPrimary}>
            {customizing ? 'Continue' : 'Keep recommended defaults'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Rule 1 — the configurable one */}
        <div className="rounded-xl border border-stone p-4">
          <div className="flex items-start gap-3">
            <span className="status-pill tone-guard flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <LargeWithdrawalIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-cloud">Large withdrawal</p>
                <StatusPill tone="guard" icon={<CheckIcon />}>
                  {current !== undefined ? `${current}%` : '…'}
                  {current === 60 ? ' · recommended' : ''}
                </StatusPill>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-sand/60">
                Withdrawals over {current ?? '…'}% of a token's balance wait 12 hours before they can execute.
              </p>
            </div>
          </div>

          {!customizing ? (
            <button
              type="button"
              onClick={() => setCustomizing(true)}
              className="mt-3 text-xs font-medium text-sand/70 underline decoration-stone underline-offset-4 hover:text-cloud"
            >
              Make it stricter
            </button>
          ) : (
            current !== undefined &&
            percent !== undefined && (
              <div className="mt-4 space-y-3 border-t border-stone pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-sand/70">New threshold</span>
                  <span className="text-sm font-semibold text-cloud">{percent}%</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={current}
                  step={5}
                  value={percent}
                  onChange={(e) => setPercent(Number(e.target.value))}
                  className="w-full accent-guard"
                  aria-label="Large withdrawal threshold"
                />
                <p className="text-xs text-sand/60">
                  Lower = stricter. Tightening applies instantly. Loosening later takes a 24-hour delay, so an attacker
                  can't quietly switch it off.
                </p>
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={() =>
                    writeContract({ ...watcherContract, functionName: 'requestThresholdChange', args: [BigInt(percent)] })
                  }
                  className={btnPrimary}
                >
                  Apply {percent}%
                </button>
                {statusLine && <p className="text-xs text-sand">{statusLine}</p>}
                {error && <p className="break-words text-xs text-alert">{error.message.split('\n')[0]}</p>}
              </div>
            )
          )}
        </div>

        {/* Rules 2 & 3 — fixed in the contract */}
        {FIXED_RULES.map((rule) => (
          <div key={rule.title} className="flex items-start gap-3 rounded-xl border border-stone p-4">
            <span className="status-pill tone-guard flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              {rule.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-cloud">{rule.title}</p>
                <StatusPill tone="guard" icon={<CheckIcon />}>
                  Always on
                </StatusPill>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-sand/60">{rule.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </StepShell>
  )
}

/* ------------------------- Step 4: recovery --------------------------- */

function RecoveryStep({
  address,
  onBack,
  onNext,
}: {
  address: Address
  onBack: () => void
  onNext: () => void
}) {
  const { data, refetch } = useReadContract({
    ...watcherContract,
    functionName: 'getSafeAddresses',
    args: [address],
  })
  const primary = (data as readonly [Address, Address] | undefined)?.[0]
  const hasSafe = primary !== undefined && primary !== zeroAddress

  const [input, setInput] = useState('')
  const isValid = /^0x[a-fA-F0-9]{40}$/.test(input)
  const isSelf = isValid && input.toLowerCase() === address.toLowerCase()

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({ hash })
  useEffect(() => {
    if (isSuccess) refetch()
  }, [isSuccess, refetch])

  const busy = isPending || isConfirming
  const statusLine = txStatusLabel(isPending, isConfirming, isError || Boolean(error))

  return (
    <StepShell
      title="Set up recovery"
      subtitle="A trusted recovery address is where you can send funds if your wallet is ever compromised — even while a suspicious withdrawal is waiting in the queue."
      footer={
        <>
          <button type="button" onClick={onBack} className={btnSecondary}>
            Back
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {!hasSafe && (
              <button type="button" onClick={onNext} disabled={busy} className={btnSecondary}>
                Skip for now
              </button>
            )}
            <button type="button" onClick={onNext} disabled={!hasSafe} className={btnPrimary}>
              Continue
            </button>
          </div>
        </>
      }
    >
      {hasSafe ? (
        <div className="status-card tone-recovery px-4 py-3">
          <p className="tone-text flex items-center gap-2 text-sm font-semibold">
            <KeyIcon className="h-4 w-4" />
            Recovery address set
          </p>
          <p className="mt-1 font-mono text-sm text-cloud" title={primary}>
            {maskAddress(primary)}
          </p>
          <p className="mt-1 text-xs text-sand/70">Future changes take 24 hours, so an attacker can't redirect it.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              writeContract({ ...watcherContract, functionName: 'setSafeAddress', args: [input] })
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x… a wallet you control, e.g. a hardware wallet"
              className={`${inputClass} font-mono`}
            />
            <button type="submit" disabled={!isValid || isSelf || busy} className={btnPrimary}>
              Set address
            </button>
          </form>
          {isSelf && <p className="text-xs text-alert">Use a different wallet from the one you're connected with.</p>}
          <p className="text-xs text-sand/60">
            Setting it the first time is instant. Use an address only you control — ideally cold storage.
          </p>
          {statusLine && <p className="text-xs text-sand">{statusLine}</p>}
          {error && <p className="break-words text-xs text-alert">{error.message.split('\n')[0]}</p>}
        </div>
      )}
    </StepShell>
  )
}

/* -------------------------- Step 5: review ---------------------------- */

function ReviewRow({ icon, label, children, tone }: { icon: ReactNode; label: string; children: ReactNode; tone?: 'warn' }) {
  return (
    <li className="flex items-start gap-3 py-3.5">
      <span
        className={`status-pill flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          tone === 'warn' ? 'tone-warn' : 'tone-guard'
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-sand/60">{label}</p>
        <div className="mt-0.5 text-sm text-cloud">{children}</div>
      </div>
    </li>
  )
}

function ReviewStep({
  address,
  status,
  onBack,
  onFinish,
}: {
  address: Address
  status: TokenStatus
  onBack: () => void
  onFinish: () => void
}) {
  const { data: thresholdData } = useReadContract({
    ...watcherContract,
    functionName: 'getThresholdState',
    args: [address],
  })
  const { data: safeData } = useReadContract({ ...watcherContract, functionName: 'getSafeAddresses', args: [address] })
  const threshold = (thresholdData as readonly [bigint, bigint, bigint] | undefined)?.[0]
  const primary = (safeData as readonly [Address, Address] | undefined)?.[0]
  const hasSafe = primary !== undefined && primary !== zeroAddress
  const hasDeposit = (status.vaultBalance ?? 0n) > 0n

  return (
    <StepShell
      title="Review your vault"
      subtitle="Here's what's protecting you. Everything can be changed later from the dashboard."
      footer={
        <>
          <button type="button" onClick={onBack} className={btnSecondary}>
            Back
          </button>
          <button type="button" onClick={onFinish} className={btnPrimary}>
            Enter dashboard →
          </button>
        </>
      }
    >
      <ul className="divide-y divide-stone">
        <ReviewRow icon={<ShieldCheckIcon className="h-4 w-4" />} label="Protected asset" tone={hasDeposit ? undefined : 'warn'}>
          {hasDeposit ? (
            <span className="font-mono">
              {formatAmount(status.vaultBalance, status.decimals)} {status.token.symbol}
            </span>
          ) : (
            <>No {status.token.symbol} deposited yet — add funds from the dashboard.</>
          )}
        </ReviewRow>
        <ReviewRow icon={<LargeWithdrawalIcon className="h-4 w-4" />} label="Protection rules">
          3 rules active · large withdrawals over {threshold !== undefined ? `${threshold}%` : '…'} wait 12h
        </ReviewRow>
        <ReviewRow
          icon={hasSafe ? <KeyIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
          label="Recovery address"
          tone={hasSafe ? undefined : 'warn'}
        >
          {hasSafe ? (
            <span className="font-mono" title={primary}>
              {maskAddress(primary)}
            </span>
          ) : (
            <>Not set — we recommend adding one from Security → Recovery.</>
          )}
        </ReviewRow>
        <ReviewRow icon={<LockIcon className="h-4 w-4" />} label="Containment Mode">
          Available — freeze all withdrawals instantly if something looks wrong.
        </ReviewRow>
      </ul>
    </StepShell>
  )
}

/* ------------------------------ Flow ---------------------------------- */

function Onboarding({
  address,
  statuses,
  defaultToken,
  onRefetchOverview,
}: {
  address: Address
  statuses: Record<TokenSlug, TokenStatus>
  defaultToken: TokenSlug
  onRefetchOverview: () => void
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState<TokenSlug>(defaultToken)
  const [deposited, setDeposited] = useState(false)

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const exit = (to: string) => {
    markSetupDone(address)
    navigate(to)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sand/60">Vault setup</p>
        <button
          type="button"
          onClick={() => exit('/app')}
          className="text-xs font-medium text-sand/60 underline decoration-stone underline-offset-4 hover:text-cloud"
        >
          Exit setup
        </button>
      </div>
      <Stepper step={step} />

      {step === 0 && <AssetStep statuses={statuses} selected={token} onSelect={setToken} onNext={next} />}
      {step === 1 && (
        <DepositStep
          status={statuses[token]}
          address={address}
          deposited={deposited}
          onDeposited={() => {
            setDeposited(true)
            onRefetchOverview()
          }}
          onBack={back}
          onNext={next}
        />
      )}
      {step === 2 && <ProtectionStep address={address} onBack={back} onNext={next} />}
      {step === 3 && <RecoveryStep address={address} onBack={back} onNext={next} />}
      {step === 4 && (
        <ReviewStep address={address} status={statuses[token]} onBack={back} onFinish={() => exit(`/app/${token}`)} />
      )}
    </div>
  )
}

export default Onboarding
