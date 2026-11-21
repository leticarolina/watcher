import type { Address } from 'viem'

// Tracks whether a wallet has finished (or exited) the guided vault setup.
// Persistent per wallet (localStorage) so returning users aren't sent back
// through onboarding; see Onboarding.tsx.
const key = (address: Address) => `watcher:setup-done:${address.toLowerCase()}`

export function isSetupDone(address: Address): boolean {
  try {
    return window.localStorage.getItem(key(address)) === '1'
  } catch {
    return true // storage unavailable — never force the flow
  }
}

export function markSetupDone(address: Address) {
  try {
    window.localStorage.setItem(key(address), '1')
  } catch {
    /* ignore */
  }
}
