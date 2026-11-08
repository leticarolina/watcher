![Watcher](frontend/public/WATCHER.png)

# Watcher

**Your wallet gets one more chance.**

Watcher is a behavioral security protocol for self-custody wallets. It watches every withdrawal, detects suspicious patterns on-chain, and delays anything that looks wrong, giving you time to react before funds leave.

**1st Place — Monad Hackathon São Paulo 2026**  
**Continuity Track — ETHGlobal ETHOnline 2026**

### Live Demo

- **Live:** [Website](https://watcher-funds.vercel.app/)
- **Watcher on Sepolia:** [0x5777D32B8Daf4624776CBBc1C7A0dD403Cd5cD8a](https://sepolia.etherscan.io/address/0x5777D32B8Daf4624776CBBc1C7A0dD403Cd5cD8a)
- **Security Design:** [`SECURITY.md`](./SECURITY.md)

---

## The idea

Crypto wallets execute transactions the moment you sign them. That's the design, but it's also the attack surface. A compromised key, a phishing signature, a slow-drain, funds are gone before you even notice.

Watcher doesn't change who controls the wallet. It adds a behavioral layer on top: withdrawals are evaluated in real time, and anything suspicious enters a 12-hour queue instead of executing immediately. That window is yours to cancel, freeze, or redirect funds before anything is irreversible.

---

## How it detects suspicious behavior

Three independent rules, any one of them triggers the delay:

**Rule 1 — Large withdrawal**  
Withdrawing more than your configured threshold (default 60%, adjustable 10–100%) triggers a 12h queue.

**Rule 2 — Probe detection**  
If your last withdrawal was under 5% of your balance, your next withdrawal is flagged regardless of size.

**Rule 3 — Rolling window**  
Cumulative withdrawals within a 72-hour window are tracked. Once they exceed 30% of your balance, further withdrawals are queued.

```solidity
Balance: 1000 USDC

Withdrawal 1:  80 USDC (8%)  → instant
Withdrawal 2: 100 USDC (10%) → instant
Withdrawal 3: 150 USDC (15%) → queued (cumulative: 33% > 30%)
```

### What you can do during the delay

- **Cancel**: the queued withdrawal is reversed, funds return instantly.
- **Containment Mode**: freeze all activity for 1 hour to 30 days. Extension-only: once active, it can only grow, never shrink.
- **Withdraw to Safe**: route funds to your pre-registered recovery address before the attacker can execute.

---

## Supported tokens

Watcher V2 supports ERC-20 tokens. Each token has its own isolated state — balances, pending withdrawals, and window tracking are all per-token, per-user.

Deployed with WETH, USDC, and WBTC on Sepolia. New tokens can be added by the owner via `addToken`.

---

## Contract functions

```solidity
// Vault
deposit(address token, uint256 amount)
withdraw(address token, uint256 amount)
executeWithdraw(address token)
cancelWithdraw(address token)
 
// Recovery
emergencyLock(uint256 duration)
withdrawToSafe(address token, uint256 amount)
setSafeAddress(uint8 slot, address safe)
requestSafeAddressChange(uint8 slot, address newSafe)
confirmSafeAddressChange(uint8 slot)
cancelSafeAddressChange(uint8 slot)
 
// Threshold (configurable per user)
setLargeWithdrawPercent(uint256 percent)
 
// Owner
addToken(address token)
```

## Security design

- **No shared pools** — every user's state is fully isolated.
- **Balance deducted before transfer** — checks-effects-interactions throughout.
- **ReentrancyGuard** on all state-changing functions.
- **Containment Mode is extension-only** — a compromised key can activate it but cannot shorten it.
- **Safe address changes require 24h delay** — blocked during Containment Mode.
- **Threshold tightening is instant, loosening requires 24h**
- Full threat model and attack scenarios: [`SECURITY.md`](./SECURITY.md)

---

## Why Watcher Is Different

Unlike wallet frontends or notification services, Watcher's security guarantees are enforced by the smart contract itself.

| Traditional Wallets | Watcher |
| --------------------- | --------- |
| Execute immediately | Delay suspicious withdrawals |
| No warnings | On-chain behavioral enforcement |
| Recovery depends on user speed | Built-in Security Queue and Recovery Path |
| No reaction window | Programmable reaction window |

---

## Testing

Watcher includes a Foundry test suite covering normal flows, edge cases, and attack scenarios.

Example scenarios:

- Large withdrawal attack.
- Probe transaction attack.
- Slow-drain attack.
- Safe address hijack attempt.
- Containment Mode bypass attempt.

### Known Limitations

- Watcher protects assets deposited into the protocol, it does not monitor arbitrary wallet transactions outside the vault.
- `withdrawToSafe` is blocked during Containment Mode, the safe address path is unavailable during a full freeze.

---

## Project History

Watcher is the evolution of LockFi — I started this project early 2026 that won 1st place at Monad Hackathon São Paulo. V2 was rebuilt for ETHGlobal ETHOnline 2026: ERC-20 support, per-token isolation, configurable thresholds, and two safe address slots.

**Leticia Azevedo** (@letiweb3) — Smart Contract Developer.
