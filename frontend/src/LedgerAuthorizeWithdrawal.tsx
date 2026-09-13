import type { LedgerWithdrawState, TransportChoice } from './lib/useLedgerAuthorizeWithdrawal'

// Transport toggle + connection/signing status for the Ledger-required
// Authorize Withdrawal flow. The trigger button itself lives in the Security
// Queue card's header (next to Cancel Withdrawal) — this only renders
// everything below it, driven by the same useLedgerAuthorizeWithdrawal
// state so the two stay in sync despite living in different places.
function LedgerAuthorizeWithdrawal({
  transportChoice,
  setTransportChoice,
  state,
  isBusy,
  executeStatus,
  executeHash,
  executeError,
  disabled,
  disabledReason,
}: {
  transportChoice: TransportChoice
  setTransportChoice: (choice: TransportChoice) => void
  state: LedgerWithdrawState
  isBusy: boolean
  executeStatus: string
  executeHash: `0x${string}` | undefined
  executeError: Error | null
  disabled: boolean
  disabledReason: string | null
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="ledger-transport"
            checked={transportChoice === 'speculos'}
            onChange={() => setTransportChoice('speculos')}
            disabled={isBusy || disabled}
          />
          Speculos (Simulator)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="ledger-transport"
            checked={transportChoice === 'webhid'}
            onChange={() => setTransportChoice('webhid')}
            disabled={isBusy || disabled}
          />
          Physical Device (WebHID)
        </label>
      </div>

      {(state.step === 'searching' || state.step === 'connected' || state.step === 'locked' || state.step === 'wrong-app') && (
        <div className="rounded-lg border border-cloud/10 bg-cloud/5 px-4 py-3 font-mono text-sm text-cloud/80">
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
        </div>
      )}
      {state.step === 'signing' && <p className="font-mono text-sm text-cloud/70">Signing withdrawal with Ledger…</p>}
      {state.step === 'signed' && (
        <p className="font-mono text-sm text-teal">Signed. Submitting to the contract…</p>
      )}
      {state.step === 'error' && <p className="font-mono text-sm text-red">Error: {state.message}</p>}

      {disabled && disabledReason && <p className="text-xs opacity-80">{disabledReason}</p>}

      {executeStatus && <p className="text-xs opacity-90">authorize status: {executeStatus}</p>}
      {executeHash && <p className="break-all text-xs opacity-70">authorize tx hash: {executeHash}</p>}
      {executeError && <p className="text-xs text-red">authorize error: {executeError.message}</p>}
    </div>
  )
}

export default LedgerAuthorizeWithdrawal
