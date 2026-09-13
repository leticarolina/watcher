# Watcher — Security Design Document

**Author:** Leticia Azevedo  
**Contract:** `Watcher.sol`
**Version:** V2 — ETHGlobal ETHOnline 2026
**Last Updated:** September 2026
**Deployed:** [Sepolia — 0xB0c7a97cEE61d3Da05e2cF4Fb704e44d2bdFc230](https://sepolia.etherscan.io/address/0xB0c7a97cEE61d3Da05e2cF4Fb704e44d2bdFc230)

---

## Overview

Watcher is an on-chain behavioral security protocol for self-custody wallets. It introduces a programmable reaction window between suspicious wallet behavior and irreversible fund movement — without relying on custodians, centralized monitoring, or frontend-only protections.

Every withdrawal is evaluated against a set of behavioral rules before executing. Suspicious ones enter a time-delayed Security Queue, giving the legitimate user time to cancel, trigger Containment Mode, or route funds to a Trusted Recovery Address before anything irreversible happens.

The core design philosophy: **instant fund drainage should not be the default behavior for large or suspicious withdrawals.**

---

## Threat Model

Watcher is designed to defend against the following attack scenarios:

### 1. Compromised Private Key

An attacker gains access to the user's private key and attempts to drain the vault immediately. Without Watcher, funds are gone in seconds. With Watcher, a large withdrawal is flagged and enters the Security Queue, giving the legitimate user time to detect the unauthorized activity and cancel or trigger Containment Mode.

If the user has registered a Ledger signer, the attacker cannot execute the queued withdrawal even after the 12-hour delay — they would need the physical Ledger device to produce a valid signature.

### 2. User Error / Fat-Finger

A user accidentally initiates a large withdrawal to the wrong address. The Security Queue provides a cancellation path before funds leave the contract.

### 3. Staged Attack (Test-Probe Pattern)

A common attacker behavior: first send a small test transaction to verify wallet permissions, then follow with a larger drain. Rule 2 detects this sequential pattern — any withdrawal following a small probe is flagged regardless of its size.

### 4. Slow Drain Attack

An attacker with partial access extracts funds gradually in smaller increments to avoid triggering Rule 1. Rule 3 tracks cumulative withdrawals over a 72-hour rolling window to detect and flag this behavior.

### 5. Trusted Recovery Address Hijacking

An attacker with a compromised key attempts to change the user's recovery address to their own, then drain via `withdrawToSafe`. The 24-hour delay on recovery address changes prevents this — the legitimate user has time to detect and cancel before it takes effect.

### 6. Lock Bypass via Recovery Address Change

An attacker queues a recovery address change during an active Containment Mode, waits for the delay, confirms the reroute, then drains via `withdrawToSafe` when the lock expires. Both `requestSafeAddressChange` and `confirmSafeAddressChange` are blocked during Containment Mode, closing this attack path entirely.

### 7. Lock Duration Reduction

An attacker finds the vault under Containment Mode and attempts to reduce the lock duration by calling `emergencyLock` with a shorter value. The contract enforces extension-only behavior — `lockedUntil` can only move forward in time, never backward.

### 8. Ledger Signer Removal Attack

An attacker with a compromised key attempts to remove the Ledger signer requirement by calling `requestLedgerSignerChange(address(0))`, wait 24 hours, confirm the removal, then execute the queued withdrawal without hardware authorization. Both `requestLedgerSignerChange` and `confirmLedgerSignerChange` are blocked during Containment Mode. The user can also cancel a pending Ledger signer change at any time, even during Containment Mode.

---

## Risk Detection Rules

### Rule 1 — Large Withdrawal Threshold

**Trigger:** Withdrawal amount exceeds 60% of the user's current balance.
**Defends against:** Instant full-balance drain after wallet compromise.
**Rationale:** Legitimate users rarely need to withdraw the majority of a vault balance in a single transaction. This threshold was chosen to be permissive enough for normal use while catching the most common drain pattern.

### Rule 2 — Probe Transaction Detection

**Trigger:** The previous withdrawal was less than 5% of balance at the time it was made.
**Defends against:** Staged attack behavior where an attacker first verifies wallet access with a small transaction before executing a larger drain.
**Rationale:** A small probe withdrawal is a strong behavioral signal of staged attack intent. Any withdrawal following a probe, regardless of size, is treated as suspicious.

### Rule 3 — Rolling Window Analysis

**Trigger:** Cumulative withdrawals within the last 72 hours exceed 30% of the user's balance.
**Defends against:** Slow drain attacks where an attacker extracts funds gradually to avoid triggering Rule 1.
**Rationale:** A rolling time window catches accumulated suspicious behavior that no single transaction would flag individually.

**Window behavior:** Initializes on first withdrawal, resets after 72 hours. Deposits during an active window do not reset accumulation — the percent of each withdrawal is calculated against the balance at the time of that specific withdrawal.

---

## V3 Additions — ETHGlobal ETHOnline 2026

### Ledger Hardware Authorization

Users can optionally register a Ledger-derived address as a required co-signer for `executeWithdraw`. When registered, the contract verifies an ECDSA signature over `keccak256(abi.encodePacked(msg.sender, executeAmount, block.chainid))` before releasing funds. The signature must recover to the registered Ledger address.

This is on-chain enforcement — the contract itself verifies the hardware signature, not the frontend. A compromised key alone cannot execute a queued withdrawal if Ledger authorization is registered.

Ledger signer changes follow the same 24-hour delay pattern as recovery address changes. Both request and confirm are blocked during Containment Mode. Cancel is always permitted.

### emergencyLock Auto-Cancels Pending Withdrawals

When Containment Mode is activated, any pending withdrawal is automatically cancelled and the amount is restored to the user's vault balance. This closes the attack window where an attacker queues a withdrawal then waits for the user to lock — previously the withdrawal would remain in the queue and could be executed after the lock expires.

### Partial withdrawToSafe

`withdrawToSafe` now accepts an `amount` parameter instead of always draining the full balance. Users can route any portion of their vault balance to the Trusted Recovery Address, leaving the remainder in the vault.

---

## Intentional Design Decisions

### emergencyLock accepts a user-defined duration

Rather than a hardcoded duration, `emergencyLock` accepts a `duration` parameter bounded between 1 hour and 30 days. This serves two distinct use cases — active threat response (short lock while assessing) and passive protection (long lock while offline) — that a fixed duration cannot satisfy simultaneously.

### emergencyLock can only extend, never shorten

`lockedUntil` can only move forward in time. Any call where `block.timestamp + duration < lockedUntil` reverts with `LockNotExtended`. Without this, an attacker with a compromised key could reduce an active lock to regain access sooner.

### Two separate functions for recovery address setup vs. change

`setSafeAddress` (first-time, no delay) and `requestSafeAddressChange` (subsequent changes, 24-hour delay) are separate functions. First-time setup has no attack surface to defend. Changing an existing recovery address is high-risk and requires the delay.

### Recovery address changes blocked during Containment Mode

Without this block, an attacker could queue a recovery address change during a lock, wait for the change delay, confirm, then drain immediately after the lock expires. Blocking both request and confirm during Containment Mode closes this window. Cancel remains always permitted — cancelling is always a safe action.

### withdrawToSafe blocked during Containment Mode

Containment Mode must be an absolute freeze. Allowing `withdrawToSafe` to bypass it would undermine the passive protection use case and create an attack path if the recovery address had been silently changed before the lock was triggered.

### Ledger signer removal follows the same delay pattern

Removing Ledger authorization is as sensitive as adding it. Instant removal would allow an attacker with a compromised key to strip the hardware requirement and then execute a queued withdrawal. The 24-hour delay on removal gives the legitimate user time to detect and cancel.

### Balance deducted immediately on risky withdrawal request

When a withdrawal enters the Security Queue, the amount is deducted from `balances[msg.sender]` immediately. This prevents double-spend against funds already committed to a pending request.

### One pending withdrawal per user

A strict limit of one pending withdrawal per user prevents spamming the queue to exhaust the delay mechanism or create ambiguous balance state.

---

## Constants

| Constant | Value | Rationale |
| --- | --- | --- |
| `DELAY` | 12 hours | Long enough to act on an alert, short enough not to punish legitimate users |
| `MIN_LOCK_DURATION` | 1 hour | Prevents trivially short locks |
| `MAX_LOCK_DURATION` | 30 days | Prevents accidental semi-permanent lockout |
| `SAFE_ADDRESS_CHANGE_DELAY` | 24 hours | Blocks same-window rerouting attack |
| `WINDOW_DURATION_FOR_MAX_WITHDRAW` | 72 hours | Wide enough to catch slow drain without flagging normal usage |
| `MAX_INSTANT_WITHDRAW_PERCENT` | 30% | Cumulative threshold before Security Queue triggers |

---

## Known Limitations

- **Native ETH only.** ERC-20 support planned.
- **Rule thresholds are hardcoded.** Configurable thresholds within safe bounds are a future consideration.
- **No oracle integration.** Risk detection is purely behavioral. Does not account for external price volatility or cross-protocol context.
- **Single recovery address.** Multi-address recovery is a potential future feature.
- **`lastWithdrawPercent` persists indefinitely.** A legitimate user who once made a small withdrawal will have their next withdrawal flagged regardless of elapsed time. The cancel mechanism mitigates this.
- **Frontend-only Ledger detection for non-registered users.** Users without a Ledger signer registered experience frontend-level routing only. On-chain enforcement requires prior registration.

---

## Disclaimer

This document describes design intent, not a formal security audit. Watcher has not been independently audited.
