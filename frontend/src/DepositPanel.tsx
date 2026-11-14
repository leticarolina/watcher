import { useState } from 'react'
import { erc20Abi, formatUnits, type Address, type Hash } from 'viem'
import { useBalance, useConfig, useWriteContract } from 'wagmi'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { WATCHER_ADDRESS, watcherContract } from './lib/contract'
import { errorMessage, formatAmount, parseAmount } from './lib/format'
import { wethAbi } from './lib/tokens'
import type { TokenStatus } from './lib/useTokenOverview'

const ETH_DECIMALS = 18

// One continuous status line across all transactions.
type DepositPhase =
  | { step: 'idle' }
  | { step: 'wrapping'; hash?: Hash }
  | { step: 'approving'; hash?: Hash }
  | { step: 'depositing'; hash?: Hash }
  | { step: 'confirmed'; hash: Hash }
  | { step: 'error'; message: string }

const STEP_LABEL = { wrapping: 'Wrapping', approving: 'Approving', depositing: 'Depositing' } as const

// Single smart Deposit button. On click, with fresh reads:
//   1. Wrap (WETH only): if the wallet's WETH doesn't cover the amount, wrap
//      just the shortfall of native ETH via WETH.deposit{value}().
//   2. Approve: if the allowance for the Watcher contract doesn't cover the
//      amount, approve exactly that amount.
//   3. Deposit: deposit(token, amount).
// Each step waits for its receipt before the next starts. One click, up to
// three wallet popups.
//
// Approves exactly the amount being deposited (not an unlimited allowance) —
// a vault that exists to limit blast radius shouldn't leave a standing
// infinite approval behind.
function DepositPanel({
  status,
  address,
  onConfirmed,
}: {
  status: TokenStatus
  address: Address
  onConfirmed: () => void
}) {
  const { token, decimals, walletBalance } = status
  const canWrap = token.wrapsNative
  const config = useConfig()
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<DepositPhase>({ step: 'idle' })

  // Native ETH balance — only meaningful (and only fetched) for WETH.
  const { data: ethBalanceData, refetch: refetchEthBalance } = useBalance({
    address,
    query: { enabled: canWrap },
  })
  const ethBalance = canWrap ? ethBalanceData?.value : 0n

  const { writeContractAsync } = useWriteContract()

  const parsed = parseAmount(amount, decimals)
  const tokenBalance = walletBalance ?? 0n
  // For WETH, wallet ETH counts toward what can be deposited (it gets wrapped).
  const available = walletBalance !== undefined && ethBalance !== undefined ? tokenBalance + ethBalance : undefined
  const holdsAnything = available !== undefined && available > 0n
  const exceedsBalance = parsed !== null && available !== undefined && parsed > available
  const wrapShortfall = canWrap && parsed !== null && parsed > tokenBalance ? parsed - tokenBalance : 0n

  const isBusy = phase.step === 'wrapping' || phase.step === 'approving' || phase.step === 'depositing'
  const canSubmit = holdsAnything && parsed !== null && !exceedsBalance && !isBusy

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (parsed === null) return
    try {
      // Fresh reads at click time — the cached overview could be stale if
      // balances/allowance changed elsewhere since the page loaded.
      if (canWrap) {
        const currentWeth = await readContract(config, {
          address: token.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })
        if (currentWeth < parsed) {
          const shortfall = parsed - currentWeth
          setPhase({ step: 'wrapping' })
          const wrapHash = await writeContractAsync({
            address: token.address,
            abi: wethAbi,
            functionName: 'deposit',
            value: shortfall,
          })
          setPhase({ step: 'wrapping', hash: wrapHash })
          const wrapReceipt = await waitForTransactionReceipt(config, { hash: wrapHash })
          if (wrapReceipt.status !== 'success') throw new Error('Wrap transaction reverted')
        }
      }

      const allowance = await readContract(config, {
        address: token.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, WATCHER_ADDRESS],
      })
      if (allowance < parsed) {
        setPhase({ step: 'approving' })
        const approveHash = await writeContractAsync({
          address: token.address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [WATCHER_ADDRESS, parsed],
        })
        setPhase({ step: 'approving', hash: approveHash })
        const approveReceipt = await waitForTransactionReceipt(config, { hash: approveHash })
        if (approveReceipt.status !== 'success') throw new Error('Approve transaction reverted')
      }

      setPhase({ step: 'depositing' })
      const depositHash = await writeContractAsync({
        ...watcherContract,
        functionName: 'deposit',
        args: [token.address, parsed],
      })
      setPhase({ step: 'depositing', hash: depositHash })
      const depositReceipt = await waitForTransactionReceipt(config, { hash: depositHash })
      if (depositReceipt.status !== 'success') throw new Error('Deposit transaction reverted')

      setPhase({ step: 'confirmed', hash: depositHash })
      setAmount('')
      onConfirmed()
    } catch (error) {
      setPhase({ step: 'error', message: errorMessage(error) })
    } finally {
      // A wrap may have succeeded even if a later step failed — keep the
      // displayed ETH/WETH balances honest either way.
      if (canWrap) refetchEthBalance()
    }
  }

  let statusLine: string | null = null
  if (phase.step === 'wrapping' || phase.step === 'approving' || phase.step === 'depositing') {
    statusLine = `${STEP_LABEL[phase.step]}… (${phase.hash ? 'waiting for confirmation' : 'confirm in wallet'})`
  } else if (phase.step === 'confirmed') {
    statusLine = 'Deposited'
  }

  let validation: string | null = null
  if (available !== undefined && !holdsAnything) {
    validation = canWrap
      ? `You don't hold any WETH or Sepolia ETH in this wallet.`
      : `You don't hold any ${token.symbol} in this wallet.`
  } else if (amount.trim() !== '' && parsed === null && decimals !== undefined) {
    validation = `Enter a positive amount with at most ${decimals} decimal places.`
  } else if (exceedsBalance) {
    validation = canWrap ? 'Amount exceeds your WETH + ETH balance.' : 'Amount exceeds your wallet balance.'
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <p className="text-xs text-cloud/50">
        Wallet balance:{' '}
        <span className="font-mono text-cloud/70">
          {formatAmount(walletBalance, decimals)} {token.symbol}
          {canWrap && <> · {formatAmount(ethBalance, ETH_DECIMALS)} ETH</>}
        </span>
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`${token.symbol} amount`}
          disabled={!holdsAnything || isBusy}
          className="flex-1 rounded border border-cloud/20 bg-cloud/5 px-3 py-2 text-sm text-cloud placeholder:text-cloud/40 disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
        >
          Deposit
        </button>
      </div>
      {validation && <p className="text-xs text-cloud/60">{validation}</p>}
      {/* Make the ETH -> WETH conversion explicit before anything is signed. */}
      {!validation && !isBusy && wrapShortfall > 0n && (
        <p className="text-xs text-cloud/60">
          Will wrap {formatUnits(wrapShortfall, ETH_DECIMALS)} ETH into WETH first. Keep some ETH for
          gas.
        </p>
      )}
      {statusLine && <p className="text-sm text-cloud/70">{statusLine}</p>}
      {(phase.step === 'wrapping' ||
        phase.step === 'approving' ||
        phase.step === 'depositing' ||
        phase.step === 'confirmed') &&
        phase.hash && <p className="break-all text-xs text-cloud/50">tx hash: {phase.hash}</p>}
      {phase.step === 'error' && <p className="text-xs text-red">error: {phase.message}</p>}
    </form>
  )
}

export default DepositPanel
