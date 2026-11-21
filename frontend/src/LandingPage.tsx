import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import './LandingPage.css'
import SecurityScenario from './SecurityScenario'

// Real copy, mirrored from README.md — not placeholder marketing text.
const DESCRIPTION =
  'A self-custody security protocol that detects suspicious withdrawal behavior on-chain and creates a programmable reaction window before funds leave your wallet.'

// Actual hackathon credentials (see README.md) — no fabricated placeholders.
const CREDENTIALS = [
  { title: '1st Place', subtitle: 'Monad Hackathon São Paulo 2026' },
  { title: 'Continuity Track', subtitle: 'ETHGlobal ETHOnline 2026' },
] as const

const REPO_URL = 'https://github.com/leticarolina/watcher'

const NAV_LINKS = [
  { label: 'How it works', to: '/architecture#core-flow' },
  { label: 'Architecture', to: '/architecture#security-engine' },
  { label: 'Security', href: `${REPO_URL}/blob/main/SECURITY.md` },
] as const

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// Marketing entry point at "/". Purely presentational — no wallet/contract
// logic here beyond the ConnectButton itself; the actual vault UI lives in
// DashboardApp under "/app".
function LandingPage() {
  return (
    <div className="min-h-screen w-full bg-midnight font-inter text-cloud">
      <div>
        <header className="landing-fade-up flex items-center justify-between gap-6 border-b border-cloud/10 px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-cloud.png" alt="" className="h-7 w-auto" />
            <span className="text-base font-semibold tracking-tight">WATCHER</span>
          </Link>
          <div className="flex items-center gap-8">
            <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
              {NAV_LINKS.map((link) =>
                'href' in link ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-cloud/70 transition-colors hover:text-cloud"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    to={link.to}
                    className="text-sm font-medium text-cloud/70 transition-colors hover:text-cloud"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
            <ConnectButton />
          </div>
        </header>

        {/* Hero fills the first screen; the credibility strip sits below the fold. */}
        <main className="mx-auto flex min-h-[calc(100vh-4.25rem)] w-full max-w-6xl items-center px-6 py-16">
          <div className="grid w-full grid-cols-1 items-center gap-12 lg:gap-14 lg:grid-cols-[1fr_1.1fr]">
            {/* Left column */}
            <div className="text-center lg:text-left">
              <p className="landing-fade-up landing-delay-1 inline-flex items-center gap-2 rounded-full border border-guard/40 bg-guard/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-teal-light">
                On-chain wallet security
              </p>

              <h1 className="landing-fade-up landing-delay-2 mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-cloud sm:text-5xl lg:text-6xl">
                Your wallet gets one <span className="text-teal-light">more chance.</span>
              </h1>

              <p className="landing-fade-up landing-delay-3 mt-5 text-lg font-medium text-cloud/90 sm:text-xl">
                Stop suspicious withdrawals before they become irreversible.
              </p>

              <p className="landing-fade-up landing-delay-3 mx-auto mt-4 max-w-xl text-base leading-relaxed text-cloud/60 lg:mx-0">
                {DESCRIPTION}
              </p>

              <div className="landing-fade-up landing-delay-4 mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Link
                  to="/app"
                  className="rounded-lg bg-guard px-6 py-3 text-sm font-semibold text-cloud shadow-lg shadow-guard/20 transition-colors hover:bg-guard/90 sm:text-base"
                >
                  Protect my wallet <span aria-hidden="true">→</span>
                </Link>
                <Link
                  to="/architecture"
                  className="rounded-lg border border-cloud/25 px-6 py-3 text-sm font-semibold text-cloud/90 transition-colors hover:border-cloud/50 hover:text-cloud sm:text-base"
                >
                  Explore the architecture
                </Link>
              </div>
            </div>

            {/* Right column */}
            <div className="landing-fade-up landing-delay-3 flex justify-center lg:justify-end">
              <SecurityScenario />
            </div>
          </div>
        </main>

        {/* Credibility strip — below the fold, not floating over the hero. */}
        <section className="border-t border-cloud/10 bg-cloud/[0.02]" aria-label="Recognition">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-x-12 gap-y-3 px-6 py-6 text-sm sm:flex-row">
            {CREDENTIALS.map((credential) => (
              <p key={credential.title} className="text-cloud/60">
                <span className="font-semibold text-cloud">{credential.title}</span>
                <span className="mx-2 text-cloud/30" aria-hidden="true">·</span>
                {credential.subtitle}
              </p>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default LandingPage
