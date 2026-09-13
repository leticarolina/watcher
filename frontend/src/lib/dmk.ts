import { DeviceManagementKitBuilder, DeviceModelId, type DeviceManagementKit } from '@ledgerhq/device-management-kit'
import { webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid'
import { speculosTransportFactory } from '@ledgerhq/device-transport-kit-speculos'

// Speculos runs as its own local process (see LEDGER_DEMO_SETUP.md at the
// repo root) — this only needs its HTTP address, not the simulator binary
// itself. @ledgerhq/device-transport-kit-speculos defaults to this same
// address when no URL is given; the fallback is repeated here explicitly
// rather than relying on that internal default staying unchanged.
const PUBLIC_SPECULOS_URL = 'http://127.0.0.1:5000'

export const speculosUrl = import.meta.env.VITE_SPECULOS_URL || PUBLIC_SPECULOS_URL

// Single shared DMK instance for the whole app — same spirit as
// wagmiConfig.ts. Both transports are registered up front; which one is
// actually used for a given discover/connect call is a per-call choice (see
// LedgerConnect's transport selector), not a build-time one.
//
// The Speculos transport emulates a Nano X by default here since that's the
// demo path; swap DeviceModelId if a different simulated model is needed.
export const dmk: DeviceManagementKit = new DeviceManagementKitBuilder()
  .addTransport(webHidTransportFactory)
  .addTransport(speculosTransportFactory(speculosUrl, false, DeviceModelId.NANO_X))
  .build()
