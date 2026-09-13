![Watcher](frontend/public/WATCHER.png)

# Watcher

Behavioral Security Protocol for Self-Custody Wallets.

Watcher detects suspicious withdrawal behavior **on-chain** and creates a reaction window before funds become irreversible.

> **Your wallet gets one more chance.**

---

## Live Demo

- **Website:** [Live site](https://watcher-funds.vercel.app/)
- **Video:** [Demo walkthrough](https://www.loom.com/share/04b42aa22ce34ca186886ed43bfe93e0)
- **Watcher on Sepolia:** [`0x4dB4243Fd93e328C5568B3521d27C2c927733CDb`](https://sepolia.etherscan.io/address/0x4dB4243Fd93e328C5568B3521d27C2c927733CDb)

- **Security Design:** [`SECURITY.md`](./SECURITY.md)
- **LockFi on Monad Testnet (V1):** [`0x0919Df3678039BCe59abdD19D7bf9e7D1b7eb5d8`](https://testnet.monadscan.com/address/0x0919Df3678039BCe59abdD19D7bf9e7D1b7eb5d8)

---

## The Problem

Self-custody gives users complete ownership — but also complete responsibility.

- Wallet compromise → funds drained in seconds.
- Human error → irreversible transactions.
- Slow-drain attacks → repeated withdrawals designed to avoid detection.

Today's wallets execute transactions immediately. Watcher adds time when behavior becomes suspicious.

---

## How Watcher Works

Watcher sits between your funds and the outside world. Every withdrawal is evaluated before it executes. Suspicious ones enter a time-delayed Security Queue — giving you time to react before anything irreversible happens.

**🟢 Small, normal amount** — executes instantly.  
**🟠 Large or suspicious amount** — enters Security Queue with a 12h delay.  
**🟠 Any withdrawal after a small probe** — flagged by pattern detection, 12h delay.  
**🟠 Cumulative drain over 72h** — flagged by rolling window tracking, 12h delay.

If something looks wrong, you have time to act:

1. **Cancel** the queued withdrawal — funds return to your vault immediately.
2. **Containment Mode** — freeze all outgoing activity for up to 30 days.
3. **Recover Funds** — route to your pre-registered Trusted Recovery Address.

---

## Security Engine

### Behavior Detection Rules

**Rule 1 — Large Withdrawal**  
Trigger: withdrawal exceeds 60% of vault balance.

```solidity
Balance: 10 ETH
Withdrawal: 7 ETH (70%) → Security Queue, 12h delay
```

**Rule 2 — Probe Transaction Detection**  
Trigger: previous withdrawal was less than 5% of balance.

```solidity
Withdrawal 1: 0.04 ETH (4%) → executes instantly
Withdrawal 2: any amount   → Security Queue, 12h delay
```

**Rule 3 — Rolling Window Analysis**  
Trigger: cumulative withdrawals within a rolling 72-hour window exceed 30% of the user's vault balance.

```solidity
Withdrawal 1: 10% → OK
Withdrawal 2: 10% → OK
Withdrawal 3: 11% → Security Queue (cumulative > 30%)
``` q

---

## Key Features

### Security Queue

- Flagged withdrawals enter a 12-hour cancellable queue.
- Only one pending withdrawal per user at a time.
- Cancel at any time — funds return instantly.

### Containment Mode (Emergency Lock)

- Freeze all vault activity for 1 hour to 30 days.
- Extension-only by design — an attacker can never shorten an active containment window after compromising a wallet.
- Auto-cancels any pending withdrawal on activation.
- Blocks all withdrawals, executions, and address changes while active.

### Trusted Recovery Address

- Register a trusted recovery wallet that can receive funds immediately during an emergency.
- Changes require a 24-hour delay — blocked during Containment Mode.
- `withdrawToSafe(amount)` sends any amount to your recovery address instantly.

### Ledger Hardware Authorization (Optional)

- Register your Ledger-derived address as a required co-signer for Authorize Withdrawal.
- On-chain enforcement — the contract itself verifies the hardware signature.
- If Ledger enforcement is enabled, flagged withdrawals require a valid signature from the registered Ledger-derived signer before execution.
- Changes require a 24-hour delay — blocked during Containment Mode.

---

## Smart Contract Functions

```solidity
// Core vault
deposit()                                          // Deposit native ETH into the vault
withdraw(uint256 amount)                           // Initiate withdrawal — instant or enters Security Queue
executeWithdraw(bytes calldata signature)           // Authorize withdrawal after 12h delay — requires Ledger signature if registered
cancelWithdraw()                                   // Cancel queued withdrawal — funds return instantly

// Recovery & Containment
emergencyLock(duration)                            // Freeze all activity for 1h to 30d
withdrawToSafe(amount)                             // Send funds to Trusted Recovery Address instantly
setSafeAddress(...)                                // Register Trusted Recovery Address
requestSafeAddressChange(...)                      // Request change — 24h delay, blocked during Containment Mode   

// Ledger Hardware Authorization
registerLedgerSigner(address signer)               // Register Ledger-derived address (first time, no delay)
requestLedgerSignerChange(address newSigner)       // Request change or removal — 24h delay, blocked during Containment Mode
confirmLedgerSignerChange()                        // Confirm after delay — address(0) removes enforcement
cancelLedgerSignerChange()                         // Cancel pending change — always allowed
```

---

## Security Architecture

- **Behavioral detection** — Detects suspicious withdrawal behavior before execution instead of relying on static permissions.
- **On-chain hardware enforcement** — Ledger signatures are verified inside the smart contract for flagged withdrawals when enabled.
- **Containment Mode** — Extension-only lock prevents shortening an active emergency lock after compromise.
- **Per-user state isolation** — no shared pools, no cross-user risk.
- **Checks-Effects-Interactions + ReentrancyGuard**

Full threat model, attack scenarios, and audit guidance: [`SECURITY.md`](./SECURITY.md)

---

## Why Watcher Is Different

Unlike wallet frontends or notification services, Watcher's security guarantees are enforced by the smart contract itself.

| Traditional Wallets | Watcher |
| --------------------- | --------- |
| Execute immediately | Delay suspicious withdrawals |
| Frontend warnings only | On-chain behavioral enforcement |
| Recovery depends on user speed | Built-in Security Queue and Recovery Path |
| Compromised key can execute | Optional Ledger signature required |
| No reaction window | 12-hour programmable reaction window |

---

## Testing

Watcher includes a Foundry test suite covering normal flows, edge cases, and attack scenarios.

- Branch coverage across every security rule.
- Integration tests for realistic attack simulations.
- Invariant tests validating solvency, balance accounting, and queue consistency.

Example scenarios:

- Large withdrawal attack.
- Probe transaction attack.
- Slow-drain attack.
- Safe address hijack attempt.
- Containment Mode bypass attempt.
- Ledger authorization enforcement.

---

## Known Limitations

- Native ETH only. ERC-20 support planned.
- Rule thresholds are hardcoded constants. Configurable thresholds are a future consideration.
- `lastWithdrawPercent` (Rule 2) persists indefinitely — a user who once made a small withdrawal will have their next withdrawal delayed regardless of elapsed time.
- Watcher currently protects assets deposited into the protocol. It does not monitor arbitrary EOA transactions outside the vault.

---

## Stack

- **Smart Contract:** Solidity 0.8.20, Foundry, OpenZeppelin
- **Frontend:** React, wagmi, viem, Next.js
- **Network:** Ethereum Sepolia

---

## Project History

Watcher is the evolution of LockFi, the first-place winner of Monad Hackathon São Paulo 2026.

The protocol was redesigned as Watcher for ETHGlobal ETHOnline 2026 with behavioral detection improvements, Containment Mode, Trusted Recovery, and optional Ledger authorization.

---

## Authorship

**Leticia Azevedo** (@letiweb3) — Smart Contract Developer & Security Design.
