// Formatting/countdown helpers shared across multiple dashboard tabs
// (Overview, Recovery, Containment, Ledger Signer). Split out from App.tsx
// so tabs can share them without an App.tsx <-> tab circular import.

import { useEffect, useState } from 'react'

// Normalizes a caught value (Error or otherwise) into a display string —
// shared by the Ledger connect/sign flows, which surface plain-text error
// states rather than a spinner.
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// Seconds -> "1d 2h 30m" style string. Good enough for status text, not a
// polished countdown widget.
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s'
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (!days && !hours && seconds) parts.push(`${seconds}s`)
  return parts.length ? parts.join(' ') : '0s'
}

// "0x0944...06C6" — first 6 chars + last 4. Display only; pair with a
// title="" of the full address so it's still verifiable on hover.
export function maskAddress(address: string | undefined): string {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Ticks down to zero once per second from an absolute target timestamp,
// captured once (Date.now() + remainingSeconds * 1000) whenever a fresh
// value comes in from a read. From there it counts down on its own clock,
// independent of the read's refetch cadence — the number moves live in the
// UI instead of only jumping on the next refetch. "Now" is tracked as state
// (updated by an effect/interval) rather than read via Date.now() during
// render — the passage of time is exactly the kind of external system an
// effect exists to synchronize with.
export function useCountdownSeconds(remainingSeconds: bigint | undefined): number | undefined {
  const [target, setTarget] = useState<number | null>(null)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (remainingSeconds === undefined) {
      setTarget(null)
      setNow(null)
      return
    }
    const start = Date.now()
    setTarget(start + Number(remainingSeconds) * 1000)
    setNow(start)
  }, [remainingSeconds])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (target === null || now === null) return undefined
  return Math.max(0, Math.round((target - now) / 1000))
}
