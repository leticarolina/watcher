import { useEffect } from 'react'
import './IntroOverlay.css'

// The "eye" intro: full-screen Midnight overlay with the logo — bounce in,
// hold, then zoom through and fade to reveal the dashboard underneath.
// Played by DashboardApp each time the user enters /app (e.g. "Protect my
// wallet" from the landing page), right before balances and tokens appear.
// Switching tabs inside /app doesn't replay it: DashboardApp stays mounted.
// Timing lives in IntroOverlay.css (~0.9s total).

function IntroOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    // Safety net in case animationend never fires (e.g. tab backgrounded).
    const fallback = window.setTimeout(onDone, 1500)
    return () => window.clearTimeout(fallback)
  }, [onDone])

  return (
    <div
      className="intro-overlay fixed inset-0 z-50 flex items-center justify-center bg-midnight"
      aria-hidden="true"
      onAnimationEnd={(e) => {
        // Only the overlay's own fade marks the end — ignore the logo's
        // animation events bubbling up.
        if (e.target === e.currentTarget) onDone()
      }}
    >
      <img src="/logo-cloud.png" alt="" className="intro-logo h-40 w-auto sm:h-56" />
    </div>
  )
}

export default IntroOverlay
