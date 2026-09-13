import { Link } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
// Reuses the landing page's reveal-animation keyframes (.landing-fade-up) so
// the two pages feel like one continuous product, not two different UIs.
import './LandingPage.css'

// Same real credentials as the landing page hero — kept as a separate copy
// here (rather than importing LandingPage's, which has since been trimmed
// down for its own layout) so this page always shows the full, exact wording.
const CREDENTIALS = [
  { icon: '🏆', title: '1st Place Winner', subtitle: 'Monad Hackathon São Paulo 2026' },
  { icon: '🔵', title: 'ETHGlobal ETHOnline 2026', subtitle: 'Continuity Track' },
] as const

const PROBLEMS = [
  { title: 'Wallet compromise', body: 'Funds drained in seconds.' },
  { title: 'Human error', body: 'Irreversible transactions.' },
  { title: 'Slow-drain attacks', body: 'Repeated withdrawals designed to evade detection.' },
] as const

const DETECTION_RULES = [
  { name: 'Large Withdrawal', trigger: 'Exceeds 60% of vault balance.' },
  { name: 'Probe Detection', trigger: 'Any withdrawal following one under 5% of balance.' },
  { name: 'Rolling Window', trigger: 'Cumulative withdrawals over 30% within a rolling 72-hour window.' },
] as const

const RECOVERY_LAYER_ITEMS = [
  { name: 'Security Queue', body: '12-hour cancellable delay.' },
  { name: 'Containment Mode', body: 'Freeze all activity for up to 30 days.' },
  { name: 'Trusted Recovery Address', body: 'Instant reroute to a pre-registered wallet.' },
  { name: 'Ledger Authorization', body: 'Optional hardware-signed early release.' },
] as const

// Small right-pointing chevron used as the connector between pipeline
// stages — rotated to point down when the stages stack on mobile.
function StageConnector() {
  return (
    <div className="flex shrink-0 items-center justify-center py-2 lg:px-2 lg:py-0">
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 rotate-90 text-cloud/30 lg:rotate-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// The centerpiece flowchart: a withdrawal request evaluated by the Risk
// Engine, forking into the instant-execution path or the Security Queue,
// which itself forks into the three actions available during the window.
// Built as one real SVG (nodes + connecting arrows), not a styled list.
function CoreFlowDiagram() {
  return (
    <svg viewBox="0 0 900 530" className="w-full" role="img" aria-label="Watcher decision flow, described in the surrounding text">
      <defs>
        <marker id="arrow-neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(248,250,252,0.35)" />
        </marker>
        <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(245,158,11,0.55)" />
        </marker>
      </defs>

      {/* Withdrawal requested -> Risk Engine */}
      <line x1={450} y1={80} x2={450} y2={120} stroke="rgba(248,250,252,0.35)" strokeWidth={2} markerEnd="url(#arrow-neutral)" />

      {/* Risk Engine forks to Normal / Suspicious */}
      <line x1={450} y1={190} x2={450} y2={210} stroke="rgba(248,250,252,0.35)" strokeWidth={2} />
      <line x1={220} y1={210} x2={680} y2={210} stroke="rgba(248,250,252,0.35)" strokeWidth={2} />
      <line x1={220} y1={210} x2={220} y2={250} stroke="rgba(248,250,252,0.35)" strokeWidth={2} markerEnd="url(#arrow-neutral)" />
      <line x1={680} y1={210} x2={680} y2={250} stroke="rgba(248,250,252,0.35)" strokeWidth={2} markerEnd="url(#arrow-neutral)" />

      {/* Suspicious/Security Queue forks to the three user actions */}
      <line x1={680} y1={340} x2={680} y2={360} stroke="rgba(245,158,11,0.4)" strokeWidth={2} />
      <line x1={160} y1={360} x2={740} y2={360} stroke="rgba(245,158,11,0.4)" strokeWidth={2} />
      <line x1={160} y1={360} x2={160} y2={400} stroke="rgba(245,158,11,0.4)" strokeWidth={2} markerEnd="url(#arrow-amber)" />
      <line x1={450} y1={360} x2={450} y2={400} stroke="rgba(245,158,11,0.4)" strokeWidth={2} markerEnd="url(#arrow-amber)" />
      <line x1={740} y1={360} x2={740} y2={400} stroke="rgba(245,158,11,0.4)" strokeWidth={2} markerEnd="url(#arrow-amber)" />

      {/* Withdrawal Requested */}
      <rect x={300} y={20} width={300} height={60} rx={12} fill="rgba(248,250,252,0.04)" stroke="rgba(248,250,252,0.18)" />
      <text x={450} y={56} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={20} fill="#f8fafc">
        Withdrawal Requested
      </text>

      {/* Risk Engine */}
      <rect x={300} y={120} width={300} height={70} rx={12} fill="rgba(15,118,110,0.15)" stroke="#0f766e" strokeWidth={1.5} />
      <text x={450} y={148} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={20} fill="#f8fafc">
        Risk Engine
      </text>
      <text x={450} y={170} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={13} fill="rgba(248,250,252,0.6)">
        Evaluates the withdrawal
      </text>

      {/* Normal branch */}
      <rect x={80} y={250} width={280} height={90} rx={12} fill="rgba(15,118,110,0.15)" stroke="#0f766e" strokeWidth={1.5} />
      <text x={220} y={288} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={18} fill="#f8fafc">
        🟢 Normal
      </text>
      <text x={220} y={312} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={13} fill="rgba(248,250,252,0.65)">
        Executes instantly
      </text>

      {/* Suspicious branch */}
      <rect x={540} y={250} width={280} height={90} rx={12} fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth={1.5} />
      <text x={680} y={288} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={18} fill="#f8fafc">
        🟠 Suspicious
      </text>
      <text x={680} y={312} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={13} fill="rgba(248,250,252,0.65)">
        Enters 12-hour Security Queue
      </text>

      {/* Three actions during the Security Queue window */}
      <rect x={30} y={400} width={260} height={100} rx={12} fill="rgba(248,250,252,0.04)" stroke="#0f766e" strokeWidth={1.5} />
      <text x={160} y={438} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={17} fill="#f8fafc">
        Cancel
      </text>
      <text x={160} y={460} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={12.5} fill="rgba(248,250,252,0.6)">
        <tspan x={160}>Funds return</tspan>
        <tspan x={160} dy={16}>instantly</tspan>
      </text>

      <rect x={320} y={400} width={260} height={100} rx={12} fill="rgba(248,250,252,0.04)" stroke="#f59e0b" strokeWidth={1.5} />
      <text x={450} y={438} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={17} fill="#f8fafc">
        Containment Mode
      </text>
      <text x={450} y={460} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={12.5} fill="rgba(248,250,252,0.6)">
        <tspan x={450}>Freeze all activity</tspan>
        <tspan x={450} dy={16}>up to 30 days</tspan>
      </text>

      <rect x={610} y={400} width={260} height={100} rx={12} fill="rgba(248,250,252,0.04)" stroke="#0f766e" strokeWidth={1.5} />
      <text x={740} y={438} textAnchor="middle" fontFamily="Manrope, sans-serif" fontWeight={700} fontSize={17} fill="#f8fafc">
        Recover Funds
      </text>
      <text x={740} y={460} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={12.5} fill="rgba(248,250,252,0.6)">
        <tspan x={740}>Route to Trusted</tspan>
        <tspan x={740} dy={16}>Recovery Address</tspan>
      </text>
    </svg>
  )
}

// Standalone deep-dive page for the "View Architecture" link on the landing
// hero. Same theme/typography as LandingPage, but a normal scrolling page
// rather than the hero's fixed h-screen layout.
function ArchitecturePage() {
  return (
    <div className="min-h-screen w-full bg-navy text-cloud">
      {/* Same nav bar as the landing page — logo + wordmark link home,
          Connect Wallet on the right. */}
      <header className="flex items-center justify-between border-b border-cloud/10 px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo-cloud.png" alt="" className="h-7 w-auto" />
          <span className="hidden font-manrope text-base font-semibold tracking-tight sm:inline">WATCHER</span>
        </Link>
        <ConnectButton />
      </header>

      {/* Hero/intro strip */}
      <section className="landing-fade-up mx-auto max-w-3xl px-6 pb-16 pt-20 text-center">
        <p className="font-inter text-sm font-semibold uppercase tracking-widest text-teal">How Watcher Works</p>
        <h1 className="mt-4 font-manrope text-3xl font-bold tracking-tight text-cloud sm:text-4xl">
          A reaction window for self-custody
        </h1>
        <p className="mt-5 font-inter text-base text-cloud/70 sm:text-lg">
          Watcher is a self-custody security protocol that adds a programmable reaction window between suspicious
          withdrawal behavior and irreversible fund movement — enforced entirely on-chain, no custodians, no
          centralized monitor.
        </p>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center font-manrope text-2xl font-bold tracking-tight text-cloud sm:text-3xl">
          The Problem
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center font-inter text-cloud/60">
          Self-custody gives users complete ownership, but also complete responsibility.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PROBLEMS.map((problem) => (
            <div
              key={problem.title}
              className="rounded-xl border border-cloud/15 bg-cloud/5 px-5 py-6 text-center"
            >
              <p className="mt-3 font-manrope text-base font-semibold text-cloud">{problem.title}</p>
              <p className="mt-1 font-inter text-sm text-cloud/60">{problem.body}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl rounded-xl border border-teal/30 bg-teal/10 px-6 py-4 text-center font-manrope text-base font-semibold text-cloud">
          Today's wallets execute instantly. Watcher adds time when behavior looks wrong.
        </p>
      </section>

      {/* The core flow diagram — the centerpiece */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center font-manrope text-2xl font-bold tracking-tight text-cloud sm:text-3xl">
          The Core Flow
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center font-inter text-cloud/60">
          Every withdrawal is evaluated before it executes.
        </p>

        <div className="mt-10 rounded-2xl border border-cloud/10 bg-cloud/[0.02] p-4 sm:p-8">
          <CoreFlowDiagram />
        </div>
      </section>

      {/* The three-layer architecture */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-manrope text-2xl font-bold tracking-tight text-cloud sm:text-3xl">
          The Security Engine
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center font-inter text-cloud/60">
          Three layers, left to right: what Watcher watches, what it decides, and what happens next.
        </p>

        <div className="mt-10 flex flex-col items-stretch lg:flex-row">
          {/* Layer 1 — Behavior Inputs */}
          <div className="flex-1 rounded-2xl border border-cloud/15 bg-cloud/5 p-6">
            <span className="text-2xl" aria-hidden="true">
              🔍
            </span>
            <h3 className="mt-2 font-manrope text-lg font-semibold text-cloud">Behavior Inputs</h3>
            <p className="mt-1 font-inter text-sm text-cloud/50">Three detection rules watch every withdrawal.</p>
            <ul className="mt-4 space-y-3">
              {DETECTION_RULES.map((rule) => (
                <li key={rule.name} className="border-t border-cloud/10 pt-3 first:border-t-0 first:pt-0">
                  <p className="font-manrope text-sm font-semibold text-cloud">{rule.name}</p>
                  <p className="mt-0.5 font-inter text-sm text-cloud/60">{rule.trigger}</p>
                </li>
              ))}
            </ul>
          </div>

          <StageConnector />

          {/* Layer 2 — Risk Engine */}
          <div className="flex flex-1 flex-col justify-center rounded-2xl border border-teal/30 bg-teal/10 p-6 text-center lg:max-w-[280px]">
            <span className="text-2xl" aria-hidden="true">
              ⚖️
            </span>
            <h3 className="mt-2 font-manrope text-lg font-semibold text-cloud">Risk Engine</h3>
            <p className="mt-2 font-inter text-sm text-cloud/70">
              Decides whether a withdrawal is safe to execute now, or suspicious enough to hold.
            </p>
          </div>

          <StageConnector />

          {/* Layer 3 — Recovery Layer */}
          <div className="flex-1 rounded-2xl border border-cloud/15 bg-cloud/5 p-6">
            <span className="text-2xl" aria-hidden="true">
              🛡️
            </span>
            <h3 className="mt-2 font-manrope text-lg font-semibold text-cloud">Recovery Layer</h3>
            <p className="mt-1 font-inter text-sm text-cloud/50">What's available once something is flagged.</p>
            <ul className="mt-4 space-y-3">
              {RECOVERY_LAYER_ITEMS.map((item) => (
                <li key={item.name} className="border-t border-cloud/10 pt-3 first:border-t-0 first:pt-0">
                  <p className="font-manrope text-sm font-semibold text-cloud">{item.name}</p>
                  <p className="mt-0.5 font-inter text-sm text-cloud/60">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Ledger Authorization callout */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-teal/30 bg-teal/10 p-8 text-center">
          <span className="text-3xl" aria-hidden="true">
            🔑
          </span>
          <h2 className="mt-3 font-manrope text-xl font-bold tracking-tight text-cloud">Ledger Authorization</h2>
          <p className="mx-auto mt-3 max-w-xl font-inter text-sm text-cloud/70 sm:text-base">
            If a Ledger hardware signer is registered, a queued withdrawal can be authorized early with a hardware
            signature instead of waiting the full 12 hours. Even an attacker who compromises the software wallet
            cannot execute the withdrawal without physical access to the registered Ledger device.
          </p>
        </div>
      </section>

      {/* Credentials strip — same badges as the landing hero */}
      <section className="px-6 py-12">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-3 sm:flex-row">
          {CREDENTIALS.map((credential) => (
            <div
              key={credential.title}
              className="flex items-center gap-3 rounded-xl border border-cloud/15 bg-cloud/5 px-4 py-2.5 shadow-lg shadow-black/30"
            >
              <span className="text-lg" aria-hidden="true">
                {credential.icon}
              </span>
              <div className="text-left">
                <p className="font-manrope text-sm font-semibold text-cloud">{credential.title}</p>
                <p className="font-inter text-xs text-cloud/50">{credential.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-6 pb-24 pt-4 text-center">
        <Link
          to="/app"
          className="inline-block rounded-lg bg-teal px-8 py-3 font-inter text-sm font-semibold text-cloud transition-colors hover:bg-teal/90 sm:text-base"
        >
          Protect My Wallet
        </Link>
      </section>
    </div>
  )
}

export default ArchitecturePage
