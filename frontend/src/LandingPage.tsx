import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import './LandingPage.css'

// Real copy, mirrored from README.md — not placeholder marketing text.
const SUBCOPY =
  'A self-custody security protocol that detects suspicious withdrawal behavior on-chain and creates a programmable reaction window before funds leave your wallet.'

// Actual hackathon credentials (see README.md) — no fabricated placeholders.
const CREDENTIALS = [
  { title: 'Monad Hackathon 2026', subtitle: 'Starting of the project' },
  { title: 'ETHGlobal ETHOnline 2026', subtitle: 'Continuity Track' },
] as const

// Marketing entry point at "/". Purely presentational — no wallet/contract
// logic here beyond the ConnectButton itself; the actual vault UI lives in
// DashboardApp under "/app".
function LandingPage() {
  // Local-only dismissal — no need to persist across reloads.
  const [dismissedCredentials, setDismissedCredentials] = useState<Set<string>>(new Set())
  const visibleCredentials = CREDENTIALS.filter((credential) => !dismissedCredentials.has(credential.title))

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-navy text-cloud">
      {/* Full-width, edge-to-edge — logo flush left, wallet button flush
          right, no centered/inset max-width wrapper. */}
      <header className="landing-fade-up flex items-center justify-between border-b border-cloud/10 px-6 py-4">
        <div className="flex items-center gap-2">
          <img src="/logo-cloud.png" alt="" className="h-7 w-auto" />
          <span className="hidden font-manrope text-base font-semibold tracking-tight sm:inline">WATCHER</span>
        </div>
        <ConnectButton />
      </header>

      {/* Everything below the header shares this flexible area — badges are
          absolutely positioned within it (top-right), entirely out of
          normal flow, so they float over the hero instead of pushing it
          down. <main> is the only element in flow here, and `items-center`
          vertically centers it in whatever space is left below the header,
          independent of the badges. */}
      <div className="relative flex flex-1 items-center">
        {/* Credential badges — top-right, floating, don't affect layout.
            Desktop-only (lg+, matching the page's own mobile/desktop split
            used by the grid-cols-1 -> lg:grid-cols-2 hero layout below) —
            there's no room for them alongside the stacked mobile hero. */}
        <div className="absolute right-6 top-6 z-10 hidden lg:flex lg:flex-col gap-3">
          {visibleCredentials.map((credential, index) => (
            <div
              key={credential.title}
              className="landing-badge-slide-in relative flex items-center gap-3 rounded-xl border border-cloud/15 bg-cloud/5 px-4 py-2.5 pr-8 shadow-lg shadow-black/30 transition-colors hover:border-cloud/30 hover:bg-cloud/10"
              style={{ animationDelay: `${80 + index * 120}ms` }}
            >
              <button
                type="button"
                onClick={() => setDismissedCredentials((prev) => new Set(prev).add(credential.title))}
                aria-label={`Dismiss ${credential.title}`}
                className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full text-cloud/40 leading-none transition-colors hover:bg-cloud/15 hover:text-cloud"
              >
                <span aria-hidden="true" className="text-xs leading-none">
                  ×
                </span>
              </button>
              <div className="text-left">
                <p className="font-manrope text-sm font-semibold text-cloud">{credential.title}</p>
                <p className="font-inter text-xs text-cloud/50">{credential.subtitle}</p>
              </div>
            </div>
          ))}
        </div>

        <main className="mx-auto w-full max-w-6xl -translate-y-4 px-6 py-6 sm:-translate-y-6 lg:-translate-y-8">
          {/* items-center: the right column's graphic box is taller than
              the text column, so this centers the (shorter) text column
              within that same row height — lining its vertical midpoint up
              with the row's center, which is also where the logo sits
              centered within its own box. Both share one horizontal
              midline across the hero. */}
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            {/* Left column — headline, subcopy, CTAs */}
            <div className="text-center lg:text-left">
              <h1 className="landing-fade-up landing-delay-2 font-manrope text-4xl font-bold tracking-tight text-cloud sm:text-5xl">
                Your wallet gets one more chance.
              </h1>

              <p className="landing-fade-up landing-delay-3 mt-5 font-inter text-base text-cloud/70 sm:text-lg">
                {SUBCOPY}
              </p>

              <div className="landing-fade-up landing-delay-4 mt-8 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
                <Link
                  to="/app"
                  className="rounded-lg bg-teal px-8 py-3 font-inter text-sm font-semibold text-cloud transition-colors hover:bg-teal/90 sm:text-base"
                >
                  Protect My Wallet
                </Link>
                <Link
                  to="/architecture"
                  className="rounded-lg border border-cloud/30 px-8 py-3 font-inter text-sm font-semibold text-cloud/90 transition-colors hover:border-cloud/60 hover:text-cloud sm:text-base"
                >
                  View Architecture
                </Link>
              </div>
            </div>

            {/* Right column — big centered logo inside a layered orbit
                background. */}
            <div className="landing-fade-up landing-delay-3 relative mx-auto flex h-[520px] w-full max-w-[600px] items-center justify-center sm:h-[620px] sm:max-w-[680px] lg:h-[740px] lg:max-w-[760px]">
              {/* Soft radial glow — the "not a flat color background" layer. */}
              <div className="absolute h-2/3 w-2/3 rounded-full bg-teal/20 blur-3xl" aria-hidden="true" />

              {/* Concentric orbit rings. The dots live inside the two rings
                  that actually rotate, as children of the same element the
                  animation transform is on — that way each dot spins along
                  with its ring's line instead of sitting fixed in place
                  while the ring rotates underneath it. */}
              <div className="landing-orbit-ring absolute inset-0 rounded-full border border-cloud/10" aria-hidden="true">
                <span className="absolute right-[8%] top-[16%] h-2 w-2 rounded-full bg-teal" aria-hidden="true" />
                <span
                  className="absolute bottom-[22%] left-[6%] h-1.5 w-1.5 rounded-full bg-cloud/40"
                  aria-hidden="true"
                />
                <span
                  className="absolute right-[16%] bottom-[8%] h-1 w-1 rounded-full bg-teal/60"
                  aria-hidden="true"
                />
              </div>
              <div
                className="landing-orbit-ring-reverse absolute inset-[12%] rounded-full border border-cloud/10"
                aria-hidden="true"
              >
                <span
                  className="absolute left-[3%] top-[18%] h-1.5 w-1.5 rounded-full bg-cloud/30"
                  aria-hidden="true"
                />
              </div>
              <div className="absolute inset-[28%] rounded-full border border-teal/20" aria-hidden="true" />

              {/* The logo — large, centered, the dominant visual anchor. */}
              <img
                src="/logo-cloud.png"
                alt="Watcher"
                className="relative z-10 h-[22rem] w-auto max-w-none shrink-0 drop-shadow-[0_0_60px_rgba(15,118,110,0.55)] sm:h-[26rem] lg:h-[30rem]"
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default LandingPage
