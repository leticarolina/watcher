# Watcher — Security Design Document

**Author:** Leticia Azevedo  
**Contract:** `Watcher.sol`
**Version:** V2.1
**Last Updated:** November 2026
**Deployed:** [0x5777D32B8Daf4624776CBBc1C7A0dD403Cd5cD8a](https://sepolia.etherscan.io/address/0x5777D32B8Daf4624776CBBc1C7A0dD403Cd5cD8a)

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

### 2. User Error / Fat-Finger

A user accidentally initiates a large withdrawal to the wrong address. The Security Queue provides a cancellation path before funds leave the contract.

### 3. Staged Attack (Test-Probe Pattern)

A common attacker behavior: first send a small test transaction to verify wallet permissions, then follow with a larger drain. Rule 2 detects this sequential pattern — any withdrawal following a small probe is flagged regardless of its size.

### 4. Slow Drain Attack

An attacker with partial access extracts funds gradually in smaller increments to avoid triggering Rule 1. Rule 3 tracks cumulative withdrawals over a 72-hour rolling window to detect and flag this behavior.

### 5. Trusted Recovery Address Hijacking

An attacker with a compromised key attempts to change the user's recovery address to their own, then drain via `withdrawToSafe`. The 24-hour delay on recovery address changes prevents this, the legitimate user has time to detect and cancel before it takes effect.

### 6. Lock Bypass via Recovery Address Change

An attacker queues a recovery address change during an active Containment Mode, waits for the delay, confirms the reroute, then drains via `withdrawToSafe` when the lock expires. Both `requestSafeAddressChange` and `confirmSafeAddressChange` are blocked during Containment Mode, closing this attack path entirely.

### 7. Lock Duration Reduction

An attacker finds the vault under Containment Mode and attempts to reduce the lock duration by calling `emergencyLock` with a shorter value. The contract enforces extension-only behavior, variable `lockedUntil` can only move forward in time, never backward.

### 8. Threshold Manipulation Attack

An attacker with a compromised key calls `requestThresholdChange` to raise the Rule 1 threshold from 60% to 100%, eliminating the large-withdrawal protection. Raises require a 24-hour delay (`THRESHOLD_CHANGE_DELAY`) before they take effect. The user has time to cancel. Raises are blocked during Containment Mode entirely. Tightening (lowering the threshold) is instant and cannot be blocked.

### 9. Queue-and-Wait Attack

An attacker queues a withdrawal, the user triggers Containment Mode, the attacker waits for both the pending delay and lock to expire, then executes. This path is closed: `emergencyLock` automatically cancels all pending withdrawals across every token, restoring the amount to the user's balance. The withdrawal must be re-queued after the lock expires, which re-triggers behavioral evaluation.

---

## ERC-20 Architecture

V2.1 supports arbitrary ERC-20 tokens. All state is keyed by `(user, token)`:

```solidity
mapping(address => mapping(address => uint256)) public balances;
mapping(address => mapping(address => WithdrawalRequest)) public pendingWithdraw;
mapping(address => mapping(address => uint256)) public lastProbeTime;
mapping(address => mapping(address => uint256)) withdrawnInWindow;
mapping(address => mapping(address => uint256)) windowStartTime;
```

**Why this matters for rule math:** Each token's behavioral state is fully isolated. A probe in WETH does not activate Rule 2 for USDC. Cumulative withdrawals in one token's window do not count toward another token's Rule 3 window. This prevents cross-token contamination while preserving the integrity of each token's behavioral history.

**Token allowlist:** Tokens are added at construction time and can be extended via `addToken(address)` (owner-only). Once added, tokens cannot be removed. The internal `tokenList` array is used by `emergencyLock` to iterate and cancel pending withdrawals across all tokens in one transaction.

---

## Risk Detection Rules

### Rule 1 — Large Withdrawal Threshold

**Trigger:** Withdrawal amount exceeds the user's configured threshold (default 60%) of their current balance.  
**Defends against:** Instant full-balance drain after wallet compromise.  
**Implementation:** `amount * 100 > balance * _largeWithdrawPercent(user)` — cross-multiplied to avoid division rounding.

The threshold is configurable per user between `MIN_LARGE_WITHDRAW_PERCENT` (10%) and `MAX_LARGE_WITHDRAW_PERCENT` (100%). Tightening applies instantly. Loosening queues behind a 24-hour delay. See [Configurable Threshold](#configurable-threshold) for the full rationale.

### Rule 2 — Probe Transaction Detection

**Trigger:** A small withdrawal (< 5% of balance at execution time) was executed within the last `PROBE_DETECTION_WINDOW` (72 hours).  
**Defends against:** Staged attack behavior where an attacker verifies wallet permissions with a small transaction before executing a larger drain.  
**Implementation:** `_isProbeActive` checks `lastProbeTime[user][token]` against `block.timestamp`. Probe state is per-token. The 72-hour window means a legitimate user who makes a small withdrawal will only have their next withdrawal delayed for 72 hours, not indefinitely.

**Probe recording:** `_recordProbe` writes `block.timestamp` to `lastProbeTime[user][token]` when `amount * 10_000 < balance * 500` (i.e., amount < 5% of balance). It writes `0` otherwise, clearing any prior probe. This runs only when funds actually leave, cancelling a pending withdrawal does not clear or set probe state, so an attacker cannot erase their probe history by cancelling.

### Rule 3 — Rolling Window Analysis

**Trigger:** Cumulative withdrawals within the last 72 hours exceed `MAX_CUMULATIVE_WITHDRAW_PERCENT` (30%) of the user's balance.  
**Defends against:** Slow drain attacks where an attacker extracts funds gradually to avoid triggering Rule 1.  
**Implementation:** Shares are accumulated in `withdrawnInWindow[user][token]`. The window is initialized on first use, resets after `CUMULATIVE_WITHDRAW_WINDOW_DURATION`, and accumulates otherwise. Each share is calculated against the user's balance at the time of that specific withdrawal.

**Deposit behavior:** Deposits during an active window do not reset accumulation, but they dilute future withdrawal shares because each share is calculated against the balance at withdrawal time, a larger balance means a smaller share for the same nominal amount.

---

## Configurable Threshold

Users can adjust their Rule 1 threshold via `requestThresholdChange(uint256 newPercent)`.

**Asymmetric behavior:**

| Direction | Behavior |
| ----------- | ---------- |
| Lower pErcent | Applied instantly. Any pending raise is cancelled. Allowed during Containment Mode. |
| Raise percent | Queued behind `THRESHOLD_CHANGE_DELAY` (24 hours). Blocked during Containment Mode. Only one pending raise allowed at a time. |

**Rationale:** Tightening can only add protection, an attacker cannot exploit a stricter threshold, so there is no reason to delay it. Loosening reduces protection, an attacker with a compromised key could raise the threshold to 100% and drain in one unqueued transaction. The 24-hour delay ensures the legitimate user can cancel before the raise takes effect.

The default threshold (`DEFAULT_LARGE_WITHDRAW_PERCENT` = 60) applies when the user has never changed it. The effective threshold is always read via `_largeWithdrawPercent(user)`, which falls back to the default for zero values.

---

## Safe Address Management

Each user has two independent recovery slots (`safeAddresses[user][0]` and `safeAddresses[user][1]`).

**Setup:** `setSafeAddress(address)` registers the first address into slot 0 with no delay. First-time setup has no attack surface, there is no existing safe address to protect.

**Changes:** `requestSafeAddressChange(uint8 slot, address newSafe)` queues a change behind `SAFE_ADDRESS_CHANGE_DELAY` (24 hours). Both request and confirm are blocked during Containment Mode. Cancel is permitted.

**Slots can never be cleared.** `address(0)` is never valid as a new safe address. This prevents an attacker from removing recovery options.

**`withdrawToSafe`** sends any amount from the vault to either registered safe address. It is blocked during Containment Mode (absolute freeze so nothing leaves while locked) and requires no pending withdrawal exists.

---

## Emergency Lock (Containment Mode)

`emergencyLock(uint256 duration)` activates a time-based freeze.

- Duration bounded: `MIN_LOCK_DURATION` (1 hour) to `MAX_LOCK_DURATION` (30 days)
- Extension-only: `lockedUntil` can only move forward — any call that would result in an earlier unlock reverts with `LockNotExtended`
- **Auto-cancels all pending withdrawals** across every token in `tokenList` on activation, restoring amounts to balances
- Blocks: `withdraw`, `executeWithdraw`, `withdrawToSafe`, `requestSafeAddressChange`, `confirmSafeAddressChange`, threshold raises, `confirmThresholdChange`
- Permits: `cancelWithdraw`, `cancelSafeAddressChange`, `cancelThresholdChange`, threshold tightening
The two distinct use cases this serves: short lock (1–24 hours) for active threat response while assessing the situation; long lock (days to weeks) for passive protection while offline or traveling.

---

## Intentional Design Decisions

### Balance deducted immediately on risky withdrawal request

When a withdrawal enters the Security Queue, the amount is deducted from `balances[msg.sender][token]` immediately. This prevents double-spend against funds already committed to a pending request.

### One pending withdrawal per user per token

A strict limit of one pending withdrawal per `(user, token)` pair prevents spamming the queue or creating ambiguous balance state.

### `cancelWithdraw` does not touch `lastProbeTime`

Probe state is written only when funds actually leave the vault. An attacker cannot erase their probe history by cancelling a flagged withdrawal.

### Two separate functions for safe address setup vs. change

`setSafeAddress` (first-time, no delay) and `requestSafeAddressChange` (subsequent changes, 24-hour delay) are distinct. Changing an existing address is high-risk and requires the delay.

### `withdrawToSafe` blocked during Containment Mode

Containment Mode is an absolute freeze. Allowing `withdrawToSafe` to bypass it would undermine the passive protection use case and create an attack path if the recovery address had been silently changed before the lock was triggered.

### emergencyLock can only extend, never shorten

`lockedUntil` can only move forward in time. Any call where `block.timestamp + duration < lockedUntil` reverts with `LockNotExtended`. Without this, an attacker with a compromised key could reduce an active lock to regain access sooner.

---

## Constants

| Constant | Value | Purpose |
| ---------- | ------- | --------- |
| `RISKY_WITHDRAWAL_DELAY` | 12 hours | Security Queue delay |
| `MIN_LOCK_DURATION` | 1 hour | Prevents trivially short Containment Mode activations |
| `MAX_LOCK_DURATION` | 30 days | Prevents accidental semi-permanent lockout |
| `SAFE_ADDRESS_CHANGE_DELAY` | 24 hours | Blocks same-window recovery address rerouting |
| `THRESHOLD_CHANGE_DELAY` | 24 hours | Blocks instant threshold manipulation by a compromised key |
| `PROBE_DETECTION_WINDOW` | 72 hours | Rule 2: window during which a prior probe flags the next withdrawal |
| `CUMULATIVE_WITHDRAW_WINDOW_DURATION` | 72 hours | Rule 3: rolling window for cumulative withdrawal tracking |
| `MAX_CUMULATIVE_WITHDRAW_PERCENT` | 30% | Rule 3: cumulative threshold before the Security Queue triggers |
| `DEFAULT_LARGE_WITHDRAW_PERCENT` | 60% | Rule 1 default threshold |
| `MIN_LARGE_WITHDRAW_PERCENT` | 10% | Lower bound for user-configured Rule 1 threshold |
| `MAX_LARGE_WITHDRAW_PERCENT` | 100% | Upper bound as 100% disables Rule 1 |

---

## Known Limitations

- **Vault-scoped protection only.** Watcher protects assets deposited into the protocol. It does not monitor arbitrary EOA transactions or assets held elsewhere.
- **No oracle integration.** Risk detection is purely behavioral. External price volatility and cross-protocol context are not factored in.
- **Rule 2 window is 72 hours, not indefinite.** A user who made a small withdrawal will have their next withdrawal flagged, but only for 72 hours. After `PROBE_DETECTION_WINDOW` expires, the probe flag clears automatically.
- **Tokens cannot be removed once added.** The owner can add tokens via `addToken` but there is no removal function. A misconfigured token address is permanent.
- **`emergencyLock` iterates `tokenList`.** Auto-cancellation on lock activation loops through all allowed tokens. Gas cost scales linearly with the number of tokens in the allowlist.

---

## Disclaimer

This document describes design intent, not a formal security audit. Watcher has not been independently audited.
