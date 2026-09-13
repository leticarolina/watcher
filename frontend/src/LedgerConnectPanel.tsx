import { useCallback, useState } from 'react'
import {
  DeviceSessionStateType,
  DeviceStatus,
  type DeviceSessionId,
  type DeviceSessionState,
} from '@ledgerhq/device-management-kit'
import { webHidIdentifier } from '@ledgerhq/device-transport-kit-web-hid'
import { speculosIdentifier } from '@ledgerhq/device-transport-kit-speculos'
import { SignerEthBuilder, type SignerEth } from '@ledgerhq/device-signer-kit-ethereum'
import { filter, firstValueFrom, timeout } from 'rxjs'
import { dmk } from './lib/dmk'
import { errorMessage } from './lib/format'

// currentApp/deviceStatus only exist once the session has reached one of
// these — not on the bare "just connected" state.
type ReadySessionState = Exclude<DeviceSessionState, { sessionStateType: DeviceSessionStateType.Connected }>

function isReadySessionState(state: DeviceSessionState): state is ReadySessionState {
  return state.sessionStateType !== DeviceSessionStateType.Connected
}

export type TransportChoice = 'speculos' | 'webhid'

type ConnectState =
  | { step: 'idle' }
  | { step: 'searching' }
  | { step: 'connected' }
  | { step: 'locked' }
  | { step: 'wrong-app'; appName: string }
  | { step: 'ready' }
  | { step: 'error'; message: string }

// Reusable "connect to a Ledger device and hand back a ready SignerEth"
// panel — transport toggle, Connect Ledger button, and connection status as
// distinct plain-text states (idle/searching/connected/locked/wrong-app/
// error), not a spinner. What happens once the device is ready (fetch an
// address, sign a message, ...) is entirely up to the caller via onReady;
// this component's own job ends there. Shared by LedgerSignerTab (fetching
// an address) and LedgerAuthorizeWithdrawal (signing a withdrawal digest).
function LedgerConnectPanel({
  onReady,
  disabled = false,
  connectLabel = 'Connect Ledger',
  hideIdleStatus = false,
}: {
  onReady: (signerEth: SignerEth) => void
  disabled?: boolean
  connectLabel?: string
  // Suppresses the "Not connected." resting-state line so the status box
  // only appears once the user has actually clicked the button and
  // something is happening — for contexts where the button itself already
  // names the outcome (e.g. "Execute Withdrawal") and a permanent "Not
  // connected." next to it would misleadingly read as something being wrong.
  hideIdleStatus?: boolean
}) {
  const [transportChoice, setTransportChoice] = useState<TransportChoice>('speculos')
  const [state, setState] = useState<ConnectState>({ step: 'idle' })

  const handleConnect = useCallback(async () => {
    setState({ step: 'searching' })

    const transportIdentifier = transportChoice === 'speculos' ? speculosIdentifier : webHidIdentifier

    let sessionId: DeviceSessionId
    try {
      // First discovered device wins — Speculos always emits exactly one
      // (itself); WebHID emits once the user picks a device from the
      // browser's native chooser (startDiscovering must run off a user
      // gesture for WebHID, which the onClick below satisfies).
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

    const signerEth = new SignerEthBuilder({ dmk, sessionId }).build()
    setState({ step: 'ready' })
    onReady(signerEth)
  }, [transportChoice, onReady])

  const isBusy = state.step === 'searching' || state.step === 'connected'

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="ledger-transport"
            checked={transportChoice === 'speculos'}
            onChange={() => {
              setTransportChoice('speculos')
              setState({ step: 'idle' })
            }}
            disabled={isBusy || disabled}
          />
          Speculos (Simulator)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="ledger-transport"
            checked={transportChoice === 'webhid'}
            onChange={() => {
              setTransportChoice('webhid')
              setState({ step: 'idle' })
            }}
            disabled={isBusy || disabled}
          />
          Physical Device (WebHID)
        </label>
      </div>

      <button
        type="button"
        onClick={handleConnect}
        disabled={isBusy || disabled}
        className="rounded border border-cloud/20 bg-cloud/10 px-4 py-2 text-sm font-medium text-cloud disabled:opacity-40"
      >
        {connectLabel}
      </button>

      {!(hideIdleStatus && state.step === 'idle') && (
        <div className="rounded-lg border border-cloud/10 bg-cloud/5 px-4 py-3 font-mono text-sm text-cloud/80">
          {state.step === 'idle' && <p>Not connected.</p>}
          {state.step === 'searching' && (
            <p>Searching for device via {transportChoice === 'speculos' ? 'Speculos' : 'WebHID'}…</p>
          )}
          {state.step === 'connected' && <p>Connected. Checking device app…</p>}
          {state.step === 'locked' && <p className="text-amber">Device is locked — unlock it and try again.</p>}
          {state.step === 'wrong-app' && (
            <p className="text-amber">
              Wrong app open on device ("{state.appName}" is running) — open the Ethereum app and try again.
            </p>
          )}
          {state.step === 'ready' && <p className="text-teal">Device connected.</p>}
          {state.step === 'error' && <p className="text-red">Error: {state.message}</p>}
        </div>
      )}
    </div>
  )
}

export default LedgerConnectPanel
