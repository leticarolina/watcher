import { useCallback, useEffect, useState } from 'react'
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { zeroAddress } from 'viem'
import { DeviceActionStatus } from '@ledgerhq/device-management-kit'
import type { SignerEth } from '@ledgerhq/device-signer-kit-ethereum'
import { filter, firstValueFrom } from 'rxjs'
import { watcherContract } from './lib/contract'
import { errorMessage, formatDuration, maskAddress, useCountdownSeconds } from './lib/format'
import Card from './Card'
import ContainmentLockBanner from './ContainmentLockBanner'
import LedgerConnectPanel from './LedgerConnectPanel'

// Standard first Ethereum account under the default BIP-44 path — this is
// what getAddress() below asks the device to derive from.
const ETH_DERIVATION_PATH = "44'/60'/0'/0/0"

// Every distinct state gets its own plain-text status line rather than a
// spinner — same visibility this got when it was the standalone test panel.
type AddressFetchState =
  | { step: 'connecting' }
  | { step: 'fetching' }
  | { step: 'address-ready'; address: `0x${string}` }
  | { step: 'error'; message: string }

/* ---------------------------------------------------------------------- */
/* "Get an address from a Ledger device, then run an action with it" UI — */
/* built on the shared LedgerConnectPanel, reused by both the             */
/* initial-registration flow and the request-a-new-signer flow below.     */
/* ---------------------------------------------------------------------- */

function LedgerDeviceConnect({
  connectLabel,
  confirmPrompt,
  actionLabel,
  onConfirm,
  isActionBusy,
}: {
  connectLabel?: string
  confirmPrompt: (address: `0x${string}`) => string
  actionLabel: string
  onConfirm: (address: `0x${string}`) => void
  isActionBusy: boolean
}) {
  const [state, setState] = useState<AddressFetchState>({ step: 'connecting' })

  const handleReady = useCallback(async (signerEth: SignerEth) => {
    setState({ step: 'fetching' })

    const { observable } = signerEth.getAddress(ETH_DERIVATION_PATH)

    try {
      const finalState = await firstValueFrom(
        observable.pipe(
          filter((s) => s.status === DeviceActionStatus.Completed || s.status === DeviceActionStatus.Error),
        ),
      )
      if (finalState.status === DeviceActionStatus.Completed) {
        setState({ step: 'address-ready', address: finalState.output.address })
      } else {
        setState({ step: 'error', message: errorMessage(finalState.error) })
      }
    } catch (error) {
      setState({ step: 'error', message: errorMessage(error) })
    }
  }, [])

  return (
    <div className="space-y-3">
      {state.step === 'connecting' && <LedgerConnectPanel onReady={handleReady} connectLabel={connectLabel} />}
      {state.step === 'fetching' && <p className="font-mono text-sm text-cloud/70">Retrieving address from device…</p>}
      {state.step === 'address-ready' && (
        <p className="break-all font-mono text-sm text-teal">{confirmPrompt(state.address)}</p>
      )}
      {state.step === 'error' && <p className="font-mono text-sm text-red">Error: {state.message}</p>}

      {state.step === 'address-ready' && (
        <button
          type="button"
          onClick={() => onConfirm(state.address)}
          disabled={isActionBusy}
          className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------- */
/* Ledger Signer tab                                                       */
/* ---------------------------------------------------------------------- */

function LedgerSignerTab({
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

  const { data: ledgerStateData, refetch: refetchLedgerState } = useReadContract({
    ...watcherContract,
    functionName: 'getLedgerSignerState',
    args: [address],
  })
  // getLedgerSignerState alone can't tell "no pending change" apart from "a
  // pending *removal* (pendingSigner is also address(0)) whose delay has
  // already elapsed" — both report pendingSigner === address(0) and
  // remainingTime === 0. The raw ledgerSignerChangeUnlockTime mapping (the
  // contract's own gating flag for request/confirm/cancel) isn't clamped to
  // 0 the same way, so it's what actually distinguishes the two.
  const { data: rawUnlockTimeData, refetch: refetchUnlockTime } = useReadContract({
    ...watcherContract,
    functionName: 'ledgerSignerChangeUnlockTime',
    args: [address],
  })

  const ledgerState = ledgerStateData as readonly [`0x${string}`, `0x${string}`, bigint] | undefined
  const currentSigner = ledgerState?.[0]
  const pendingSigner = ledgerState?.[1]
  const remainingTime = ledgerState?.[2]
  const rawUnlockTime = rawUnlockTimeData as bigint | undefined

  const hasPendingChange = rawUnlockTime !== undefined && rawUnlockTime !== 0n
  const hasSignerSet = currentSigner !== undefined && currentSigner !== zeroAddress

  const countdown = useCountdownSeconds(hasPendingChange ? remainingTime : undefined)

  const refetchAll = useCallback(() => {
    refetchLedgerState()
    refetchUnlockTime()
  }, [refetchLedgerState, refetchUnlockTime])

  // registerLedgerSigner — only reachable while no signer is set yet.
  const {
    writeContract: writeRegister,
    data: registerHash,
    isPending: isRegisterWaiting,
    error: registerError,
  } = useWriteContract()
  const {
    isLoading: isRegisterConfirming,
    isSuccess: isRegisterConfirmed,
    isError: isRegisterReceiptError,
  } = useWaitForTransactionReceipt({ hash: registerHash })

  useEffect(() => {
    if (isRegisterConfirmed) refetchAll()
  }, [isRegisterConfirmed, refetchAll])

  let registerStatus = ''
  if (isRegisterWaiting) registerStatus = 'waiting for wallet confirmation'
  else if (isRegisterConfirming) registerStatus = 'transaction pending'
  else if (isRegisterConfirmed) registerStatus = 'confirmed'
  else if (isRegisterReceiptError || registerError) registerStatus = 'failed'

  const isRegisterBusy = isRegisterWaiting || isRegisterConfirming

  const handleRegister = (signerAddress: `0x${string}`) => {
    writeRegister({ ...watcherContract, functionName: 'registerLedgerSigner', args: [signerAddress] })
  }

  // requestLedgerSignerChange — used both for a real address (change) and
  // for zeroAddress (removal), per the contract's own convention.
  const {
    writeContract: writeRequestChange,
    data: requestHash,
    isPending: isRequestWaiting,
    error: requestError,
  } = useWriteContract()
  const {
    isLoading: isRequestConfirming,
    isSuccess: isRequestConfirmed,
    isError: isRequestReceiptError,
  } = useWaitForTransactionReceipt({ hash: requestHash })

  useEffect(() => {
    if (isRequestConfirmed) refetchAll()
  }, [isRequestConfirmed, refetchAll])

  let requestStatus = ''
  if (isRequestWaiting) requestStatus = 'waiting for wallet confirmation'
  else if (isRequestConfirming) requestStatus = 'transaction pending'
  else if (isRequestConfirmed) requestStatus = 'confirmed'
  else if (isRequestReceiptError || requestError) requestStatus = 'failed'

  const isRequestBusy = isRequestWaiting || isRequestConfirming

  const handleRequestChange = (newSigner: `0x${string}`) => {
    writeRequestChange({ ...watcherContract, functionName: 'requestLedgerSignerChange', args: [newSigner] })
  }

  const handleRemove = () => {
    writeRequestChange({ ...watcherContract, functionName: 'requestLedgerSignerChange', args: [zeroAddress] })
  }

  // confirmLedgerSignerChange
  const {
    writeContract: writeConfirm,
    data: confirmHash,
    isPending: isConfirmWaiting,
    error: confirmError,
  } = useWriteContract()
  const {
    isLoading: isConfirmConfirming,
    isSuccess: isConfirmConfirmed,
    isError: isConfirmReceiptError,
  } = useWaitForTransactionReceipt({ hash: confirmHash })

  useEffect(() => {
    if (isConfirmConfirmed) refetchAll()
  }, [isConfirmConfirmed, refetchAll])

  let confirmStatus = ''
  if (isConfirmWaiting) confirmStatus = 'waiting for wallet confirmation'
  else if (isConfirmConfirming) confirmStatus = 'transaction pending'
  else if (isConfirmConfirmed) confirmStatus = 'confirmed'
  else if (isConfirmReceiptError || confirmError) confirmStatus = 'failed'

  const isConfirmBusy = isConfirmWaiting || isConfirmConfirming

  const handleConfirm = () => {
    writeConfirm({ ...watcherContract, functionName: 'confirmLedgerSignerChange', args: [] })
  }

  // cancelLedgerSignerChange
  const {
    writeContract: writeCancel,
    data: cancelHash,
    isPending: isCancelWaiting,
    error: cancelError,
  } = useWriteContract()
  const {
    isLoading: isCancelConfirming,
    isSuccess: isCancelConfirmed,
    isError: isCancelReceiptError,
  } = useWaitForTransactionReceipt({ hash: cancelHash })

  useEffect(() => {
    if (isCancelConfirmed) refetchAll()
  }, [isCancelConfirmed, refetchAll])

  let cancelStatus = ''
  if (isCancelWaiting) cancelStatus = 'waiting for wallet confirmation'
  else if (isCancelConfirming) cancelStatus = 'transaction pending'
  else if (isCancelConfirmed) cancelStatus = 'confirmed'
  else if (isCancelReceiptError || cancelError) cancelStatus = 'failed'

  const isCancelBusy = isCancelWaiting || isCancelConfirming

  const handleCancel = () => {
    writeCancel({ ...watcherContract, functionName: 'cancelLedgerSignerChange', args: [] })
  }

  const isReady = countdown !== undefined && countdown <= 0
  const countdownText = countdown !== undefined ? formatDuration(countdown) : '…'

  return (
    <div className="max-w-xl space-y-4">
      {isLocked && <ContainmentLockBanner lockCountdown={lockCountdown} onViewContainment={onViewContainment} />}

      <div>
        <h2 className="font-manrope text-lg font-semibold">Ledger Signer</h2>
        <p className="text-sm text-cloud/70">
          Optionally require a Ledger hardware wallet to co-sign withdrawals. Changing or removing it after the
          first time takes a 24-hour delay.
        </p>
      </div>

      {hasPendingChange ? (
        <Card className="space-y-3 border-cloud/10 bg-cloud/5 p-5">
          <p className="text-sm">
            {pendingSigner === zeroAddress ? (
              'Removal pending'
            ) : (
              <>
                Pending change to:{' '}
                <span className="font-mono" title={pendingSigner}>
                  {maskAddress(pendingSigner)}
                </span>
              </>
            )}
          </p>
          <p className="text-sm text-amber">Unlocks in {countdownText}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isReady || isConfirmBusy}
              className="rounded bg-teal px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Confirm Change
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelBusy}
              className="rounded border border-cloud/20 bg-cloud/10 px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
            >
              Cancel Change
            </button>
          </div>
          {!isReady && <p className="text-xs text-cloud/50">Confirm Change unlocks once the 24h delay finishes.</p>}
          {confirmStatus && <p className="text-xs text-cloud/70">confirm status: {confirmStatus}</p>}
          {confirmHash && <p className="break-all text-xs text-cloud/50">confirm tx hash: {confirmHash}</p>}
          {confirmError && <p className="text-xs text-red">confirm error: {confirmError.message}</p>}
          {cancelStatus && <p className="text-xs text-cloud/70">cancel status: {cancelStatus}</p>}
          {cancelHash && <p className="break-all text-xs text-cloud/50">cancel tx hash: {cancelHash}</p>}
          {cancelError && <p className="text-xs text-red">cancel error: {cancelError.message}</p>}
        </Card>
      ) : hasSignerSet ? (
        <Card className="space-y-4 border-cloud/10 bg-cloud/5 p-5">
          <div className="space-y-1 rounded-xl border border-teal/40 bg-teal/10 px-4 py-3 text-teal">
            <p className="font-manrope font-semibold">Ledger co-signer active</p>
            <p className="font-mono text-sm text-cloud" title={currentSigner}>
              {maskAddress(currentSigner)}
            </p>
          </div>

          <div className="space-y-3 border-t border-cloud/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cloud/40">Change or Remove Signer</p>
            <p className="text-xs text-cloud/50">
              Only do this if you want to switch to a different Ledger or remove the requirement — your currently
              registered signer above doesn't need to reconnect for normal use.
            </p>
            <LedgerDeviceConnect
              connectLabel="Connect New Device"
              confirmPrompt={(newAddress) => `Switch signer to ${newAddress}?`}
              actionLabel="Request Change"
              onConfirm={handleRequestChange}
              isActionBusy={isRequestBusy}
            />
            {requestStatus && <p className="text-xs text-cloud/70">status: {requestStatus}</p>}
            {requestHash && <p className="break-all text-xs text-cloud/50">tx hash: {requestHash}</p>}
            {requestError && <p className="text-xs text-red">error: {requestError.message}</p>}
          </div>

          <div className="border-t border-cloud/10 pt-4">
            <button
              type="button"
              onClick={handleRemove}
              disabled={isRequestBusy}
              className="rounded border border-red/40 bg-red/10 px-4 py-2 text-sm font-medium text-red disabled:opacity-40"
            >
              Remove Ledger Requirement
            </button>
            <p className="mt-1 text-xs text-cloud/50">Requests removal of the co-signing requirement — also takes 24 hours.</p>
          </div>
        </Card>
      ) : (
        <Card className="space-y-3 border-cloud/10 bg-cloud/5 p-5">
          <p className="text-sm text-cloud/70">No Ledger signer registered yet.</p>
          <LedgerDeviceConnect
            confirmPrompt={(newAddress) => `Register ${newAddress} as your Ledger signer?`}
            actionLabel="Register This Signer"
            onConfirm={handleRegister}
            isActionBusy={isRegisterBusy}
          />
          {registerStatus && <p className="text-xs text-cloud/70">status: {registerStatus}</p>}
          {registerHash && <p className="break-all text-xs text-cloud/50">tx hash: {registerHash}</p>}
          {registerError && <p className="text-xs text-red">error: {registerError.message}</p>}
        </Card>
      )}
    </div>
  )
}

export default LedgerSignerTab
