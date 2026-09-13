import { useCallback, useEffect, useState } from 'react'
import { useChainId, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { encodePacked, hexToBytes, keccak256, serializeSignature, type Hex } from 'viem'
import {
  DeviceActionStatus,
  DeviceSessionStateType,
  DeviceStatus,
  type DeviceSessionId,
  type DeviceSessionState,
} from '@ledgerhq/device-management-kit'
import { webHidIdentifier } from '@ledgerhq/device-transport-kit-web-hid'
import { speculosIdentifier } from '@ledgerhq/device-transport-kit-speculos'
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum'
import { filter, firstValueFrom, timeout } from 'rxjs'
import { dmk } from './dmk'
import { watcherContract } from './contract'
import { errorMessage } from './format'

// Standard first Ethereum account under the default BIP-44 path — must match
// whichever device address was registered as the Ledger signer, or the
// contract's ECDSA.recover check below will simply fail to match.
const ETH_DERIVATION_PATH = "44'/60'/0'/0/0"

export type TransportChoice = 'speculos' | 'webhid'

// currentApp/deviceStatus only exist once the session has reached one of
// these — not on the bare "just connected" state.
type ReadySessionState = Exclude<DeviceSessionState, { sessionStateType: DeviceSessionStateType.Connected }>

function isReadySessionState(state: DeviceSessionState): state is ReadySessionState {
  return state.sessionStateType !== DeviceSessionStateType.Connected
}

// One state machine covering the whole click-to-execute flow — connect to
// device, verify it's running Ethereum and unlocked, sign the withdrawal
// digest, then submit executeWithdraw(signature). Every distinct state gets
// its own plain-text status line rather than a spinner.
export type LedgerWithdrawState =
  | { step: 'idle' }
  | { step: 'searching' }
  | { step: 'connected' }
  | { step: 'locked' }
  | { step: 'wrong-app'; appName: string }
  | { step: 'signing' }
  | { step: 'signed' }
  | { step: 'error'; message: string }

// Extracted out of the button so the trigger (rendered at the top of the
// Security Queue card, next to Cancel Withdrawal) and the transport
// toggle/status panel (rendered further down) can live in different places
// in the tree while sharing one source of truth.
export function useLedgerAuthorizeWithdrawal({
  address,
  pendingAmount,
  onConfirmed,
}: {
  address: `0x${string}`
  pendingAmount: bigint | undefined
  onConfirmed: () => void
}) {
  const chainId = useChainId()
  const [transportChoice, setTransportChoiceState] = useState<TransportChoice>('speculos')
  const [state, setState] = useState<LedgerWithdrawState>({ step: 'idle' })

  // Switching transport mid-flow resets any in-progress attempt, same as
  // before this was split out.
  const setTransportChoice = useCallback((choice: TransportChoice) => {
    setTransportChoiceState(choice)
    setState({ step: 'idle' })
  }, [])

  const {
    writeContract: writeExecute,
    data: executeHash,
    isPending: isExecuteWaitingForWallet,
    error: executeError,
  } = useWriteContract()
  const {
    isLoading: isExecuteConfirming,
    isSuccess: isExecuteConfirmed,
    isError: isExecuteReceiptError,
  } = useWaitForTransactionReceipt({ hash: executeHash })

  useEffect(() => {
    if (isExecuteConfirmed) {
      onConfirmed()
      setState({ step: 'idle' })
    }
  }, [isExecuteConfirmed, onConfirmed])

  const handleClick = useCallback(async () => {
    setState({ step: 'searching' })

    const transportIdentifier = transportChoice === 'speculos' ? speculosIdentifier : webHidIdentifier

    let sessionId: DeviceSessionId
    try {
      // First discovered device wins — Speculos always emits exactly one
      // (itself); WebHID emits once the user picks a device from the
      // browser's native chooser (startDiscovering must run off a user
      // gesture, which the button click satisfies).
      const device = await firstValueFrom(dmk.startDiscovering({ transport: transportIdentifier }))
      dmk.stopDiscovering()
      sessionId = await dmk.connect({ device })
    } catch (error) {
      setState({ step: 'error', message: errorMessage(error) })
      return
    }

    setState({ step: 'connected' })

    let sessionState: ReadySessionState
    try {
      sessionState = await firstValueFrom(
        dmk.getDeviceSessionState({ sessionId }).pipe(filter(isReadySessionState), timeout(15_000)),
      )
    } catch (error) {
      setState({ step: 'error', message: `Device never became ready: ${errorMessage(error)}` })
      return
    }

    if (sessionState.deviceStatus === DeviceStatus.LOCKED) {
      setState({ step: 'locked' })
      return
    }

    if (sessionState.currentApp.name !== 'Ethereum') {
      setState({ step: 'wrong-app', appName: sessionState.currentApp.name })
      return
    }

    if (pendingAmount === undefined) {
      setState({ step: 'error', message: 'Pending withdrawal amount is not available yet.' })
      return
    }

    setState({ step: 'signing' })

    // Must match the contract's own digest exactly:
    // keccak256(abi.encodePacked(msg.sender, pendingWithdraw[msg.sender].amount, block.chainid))
    const digest = keccak256(encodePacked(['address', 'uint256', 'uint256'], [address, pendingAmount, BigInt(chainId)]))

    // Sign the raw 32-byte digest via the device's personal-message signing
    // flow (NOT the browser wallet's personal_sign) — the device and the
    // contract's toEthSignedMessageHash each apply the standard
    // "\x19Ethereum Signed Message:\n32" prefix on their own end, so no
    // extra prefixing is added here; doing so would double-wrap it and
    // break ECDSA.recover on the contract side.
    const signerEth = new SignerEthBuilder({ dmk, sessionId }).build()
    const { observable } = signerEth.signMessage(ETH_DERIVATION_PATH, hexToBytes(digest))

    try {
      const finalState = await firstValueFrom(
        observable.pipe(
          filter((s) => s.status === DeviceActionStatus.Completed || s.status === DeviceActionStatus.Error),
        ),
      )
      if (finalState.status === DeviceActionStatus.Completed) {
        const signature: Hex = serializeSignature({
          r: finalState.output.r,
          s: finalState.output.s,
          v: BigInt(finalState.output.v),
        })
        setState({ step: 'signed' })
        writeExecute({ ...watcherContract, functionName: 'executeWithdraw', args: [signature] })
      } else {
        setState({ step: 'error', message: errorMessage(finalState.error) })
      }
    } catch (error) {
      setState({ step: 'error', message: errorMessage(error) })
    }
  }, [transportChoice, address, pendingAmount, chainId, writeExecute])

  let executeStatus = ''
  if (isExecuteWaitingForWallet) executeStatus = 'waiting for wallet confirmation'
  else if (isExecuteConfirming) executeStatus = 'transaction pending'
  else if (isExecuteConfirmed) executeStatus = 'confirmed'
  else if (isExecuteReceiptError || executeError) executeStatus = 'failed'

  // Busy only while something is actively in flight — locked/wrong-app/error
  // are terminal-ish and stay clickable again so the user can retry.
  const isBusy =
    state.step === 'searching' ||
    state.step === 'connected' ||
    state.step === 'signing' ||
    state.step === 'signed' ||
    isExecuteWaitingForWallet ||
    isExecuteConfirming

  return {
    transportChoice,
    setTransportChoice,
    state,
    handleClick,
    isBusy,
    executeStatus,
    executeHash,
    executeError,
  }
}
