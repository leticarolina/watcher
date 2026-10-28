// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Watcher
 * @author Leticia Azevedo (@letiweb3)
 * @notice Watcher is a self-custody security vault that protects users from instant fund drainage
 * by introducing behavioral risk detection on withdrawals. Suspicious or large withdrawals are
 * delayed instead of executed immediately, giving users a reaction window to cancel, lock the
 * vault, or route funds to a pre-registered safe address before any funds leaves the contract.
 * @dev Withdrawals are evaluated against three behavioral rules: large withdrawal threshold (>60% by
 * default, configurable per user between 10% and 100%; loosening takes 24 hours, tightening is instant),
 * test-probe pattern detection (<5% followed by any withdrawal within 72 hours), and cumulative 72-hour window
 * tracking (>30%, tracked in WAD so rounding never under-counts). Each user's state is fully isolated. Emergency lock accepts a user-defined
 * duration (1h to 30 days) and can only be extended, never shortened. Safe address changes
 * require a 24-hour delay and are blocked during emergency lock.
 */

contract Watcher is ReentrancyGuard {
    error AmountZero();
    error InsufficientBalance(uint256 balance);
    error PendingWithdrawExists();
    error TimeoutNotOver();
    error NoPendingWithdraw();
    error EmergencyLockOngoing();
    error SafeAddressNotSet();
    error InvalidSafeAddress();
    error SafeAddressAlreadySet();
    error PendingSafeChangeExists();
    error NoPendingSafeChange();
    error SafeChangeDelayNotOver();
    error PendingWithdrawalExists();
    error TransferFailed();
    error DurationTooShort();
    error DurationTooLong();
    error LockNotExtended();
    error InvalidSafeSlot();
    error SafeAddressNotRegistered();
    error ThresholdOutOfBounds();
    error ThresholdUnchanged();
    error PendingThresholdChangeExists();
    error NoPendingThresholdChange();
    error ThresholdChangeDelayNotOver();

    uint256 public constant DELAY = 12 hours;
    uint256 public constant MIN_LOCK_DURATION = 1 hours;
    uint256 public constant MAX_LOCK_DURATION = 30 days;
    uint256 public constant SAFE_ADDRESS_CHANGE_DELAY = 24 hours;
    uint256 public constant WINDOW_DURATION_FOR_MAX_WITHDRAW = 72 hours;
    uint256 public constant MAX_INSTANT_WITHDRAW_PERCENT = 30;
    uint256 public constant WAD = 1e18; // Fixed-point unit for window shares, 1e18 = 100% of balance
    uint256 public constant MAX_INSTANT_WITHDRAW_WAD = (MAX_INSTANT_WITHDRAW_PERCENT * WAD) / 100;
    uint256 public constant PROBE_WINDOW = 72 hours;
    uint256 public constant DEFAULT_LARGE_WITHDRAW_PERCENT = 60;
    uint256 public constant MIN_LARGE_WITHDRAW_PERCENT = 10;
    uint256 public constant MAX_LARGE_WITHDRAW_PERCENT = 100;
    uint256 public constant THRESHOLD_CHANGE_DELAY = 24 hours;

    mapping(address => uint256) public balances; //Tracks withdrawable funds
    mapping(address => WithdrawalRequest) public pendingWithdraw; // Pending withdrawals per user
    mapping(address => uint256) public lastProbeTime; // Timestamp of last executed probe withdrawal (<5%), 0 = no probe
    mapping(address => uint256 endTimeout) public lockedUntil; // Tracks until when withdrawal is locked for that user
    mapping(address => address[2]) public safeAddresses; // Two trusted recovery slots per user: 0 = primary, 1 = backup.
    mapping(address => PendingSafeChange) public pendingSafeChange; // Pending safe address change, requires delay before execution.
    mapping(address => uint256) withdrawnInWindow; // Cumulative withdrawn share in current window (WAD, 1e18 = 100%), read via getWindowState
    mapping(address => uint256) windowStartTime; // Start time of current window, 0 = never used, read via getWindowState
    mapping(address => uint256) largeWithdrawPercent; // Rule 1 threshold per user, 0 = use DEFAULT_LARGE_WITHDRAW_PERCENT
    mapping(address => PendingThresholdChange) public pendingThresholdChange; // Pending Rule 1 threshold raise, requires delay before execution.

    //Pending withdrawal structure, each user can only have ONE pending withdrawal.
    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockTime; // When execution allowed
        uint256 requestTime; // Timestamp created
    }

    //Pending safe address change, each user can only have ONE pending change.
    struct PendingSafeChange {
        address newSafe; // Address to write into the slot, address(0) = no pending change
        uint8 slot; // Target slot (0 or 1)
        uint64 unlockTime; // When confirmation is allowed
    }

    //Pending Rule 1 threshold raise, each user can only have ONE pending change.
    struct PendingThresholdChange {
        uint8 newPercent; // Requested threshold, 0 = no pending change
        uint64 unlockTime; // When confirmation is allowed
    }

    //EVENTS
    event Deposited(address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed user, uint256 amount, uint256 unlockTime, uint256 requestTime);
    event WithdrawalExecuted(address indexed user, uint256 amount);
    event WithdrawalCancelled(address indexed user, uint256 amount);
    event EmergencyLockActivated(address indexed user, uint256 lockedUntil);
    event SafeAddressSet(address indexed user, address safe);
    event SafeAddressChangeRequested(
        address indexed user, address indexed previousSafe, address indexed newSafe, uint8 slot, uint256 unlockTime
    );
    event SafeAddressChangeConfirmed(address indexed user, address newSafe, uint8 slot);
    event SafeAddressChangeCancelled(address indexed user, address cancelledSafe);
    event WithdrawToSafe(address indexed user, address safe, uint256 amount);
    event ThresholdChangeRequested(address indexed user, uint256 newPercent, uint256 unlockTime);
    event ThresholdChangeApplied(address indexed user, uint256 newPercent);
    event ThresholdChangeCancelled(address indexed user, uint256 cancelledPercent);

    /// @notice Deposit native token into the vault.
    /// @dev Balance is tracked internally. Emits Deposited event.
    function deposit() external payable {
        if (msg.value == 0) {
            revert AmountZero();
        }

        balances[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        balances[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Attempt a withdrawal. Executes instantly if safe, enters pending queue if risky.
    /// @dev Risk is evaluated by _isRisky before any state changes. Balance is deducted immediately
    /// regardless of outcome to prevent double-spend.
    /// @param amount The amount of native token to withdraw.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert AmountZero();
        }

        // Check if vault is currently locked for the user (due to emergency lock)
        if (block.timestamp < lockedUntil[msg.sender]) {
            revert EmergencyLockOngoing();
        }

        uint256 userBalance = balances[msg.sender];

        // Ensure user has enough funds
        if (userBalance < amount) {
            revert InsufficientBalance(userBalance);
        }

        // Only ONE pending withdrawal allowed
        if (pendingWithdraw[msg.sender].amount != 0) {
            revert PendingWithdrawExists();
        }

        bool risky = _isRisky(msg.sender, amount, userBalance); //Determine whether withdrawal is risky
        balances[msg.sender] -= amount; // Deduct balance immediately

        //if risky - create a pending request
        if (risky) {
            uint256 unlockTime = block.timestamp + DELAY;

            pendingWithdraw[msg.sender] =
                WithdrawalRequest({amount: amount, unlockTime: unlockTime, requestTime: block.timestamp});

            emit WithdrawalRequested(msg.sender, amount, unlockTime, block.timestamp);

            return;
        }

        // Send funds immediately if not risky and update withdrawal window tracking
        _updateWithdrawWindow(msg.sender, amount, userBalance);
        _recordProbe(msg.sender, amount, userBalance);
        _sendEth(msg.sender, amount);

        emit WithdrawalExecuted(msg.sender, amount);
    }

    /// @notice Execute a pending withdrawal after the delay has expired.
    /// @dev Blocked during emergency lock even if the pending request was created before the lock.
    /// This prevents an attacker who queued a withdrawal from executing it after the user locks.
    function executeWithdraw() external nonReentrant {
        WithdrawalRequest storage req = pendingWithdraw[msg.sender];
        uint256 executeAmount = req.amount;

        if (executeAmount == 0) {
            revert NoPendingWithdraw();
        }
        if (block.timestamp < req.unlockTime) {
            revert TimeoutNotOver();
        }
        // Defense-in-depth: unreachable, emergencyLock cancels pending withdrawals
        if (block.timestamp < lockedUntil[msg.sender]) {
            revert EmergencyLockOngoing();
        }

        delete pendingWithdraw[msg.sender];

        uint256 balanceBeforeRequest = balances[msg.sender] + executeAmount;
        _updateWithdrawWindow(msg.sender, executeAmount, balanceBeforeRequest);
        _recordProbe(msg.sender, executeAmount, balanceBeforeRequest);
        _sendEth(msg.sender, executeAmount);

        emit WithdrawalExecuted(msg.sender, executeAmount);
    }

    /// @notice Cancel a pending withdrawal and restore funds to the vault balance.
    /// @dev intentionally does NOT touch lastProbeTime. It is only written when funds actually leave
    /// the vault, so an attacker cannot erase their probe history by cancelling a flagged withdrawal.
    /// Cancellation is permitted during emergency lock.
    function cancelWithdraw() external {
        WithdrawalRequest storage req = pendingWithdraw[msg.sender];
        uint256 amount = req.amount;

        if (amount == 0) {
            revert NoPendingWithdraw();
        }

        balances[msg.sender] += amount;

        delete pendingWithdraw[msg.sender];

        emit WithdrawalCancelled(msg.sender, amount);
    }

    /// @notice Activate emergency lock for a user-defined duration.
    /// @dev Lock can only be extended, never shortened. Any call where block.timestamp + duration
    /// would result in an earlier unlock than the current lockedUntil reverts with LockNotExtended.
    /// Automatically cancels any pending withdrawal on activation and restores the amount to the
    /// user's vault balance. This prevents an attacker who queued a withdrawal from executing it
    /// after the user locks — the funds are returned to the vault and the request is erased.
    /// Blocks withdraw, executeWithdraw, requestSafeAddressChange, confirmSafeAddressChange,
    /// withdrawToSafe, threshold raises and confirmThresholdChange while active.
    /// @param duration Lock duration in seconds. Must be between MIN_LOCK_DURATION and MAX_LOCK_DURATION.
    function emergencyLock(uint256 duration) external {
        if (duration < MIN_LOCK_DURATION) revert DurationTooShort();
        if (duration > MAX_LOCK_DURATION) revert DurationTooLong();

        uint256 unlockTime = block.timestamp + duration;
        if (unlockTime < lockedUntil[msg.sender]) revert LockNotExtended();
        lockedUntil[msg.sender] = unlockTime;

        // Auto-cancel any pending withdrawal on lock
        uint256 pending = pendingWithdraw[msg.sender].amount;
        if (pending != 0) {
            balances[msg.sender] += pending;
            delete pendingWithdraw[msg.sender];
            emit WithdrawalCancelled(msg.sender, pending);
        }

        emit EmergencyLockActivated(msg.sender, unlockTime);
    }

    /*
    ============================================================
                    INTERNAL FUNCTIONS
    ============================================================
    */

    /// @notice Evaluates whether a withdrawal should be delayed based on behavioral risk rules.
    /// @dev Three independent rules are evaluated, any single match flags the withdrawal as risky.
    /// Rule 1: amount exceeds the user's large-withdrawal threshold (default 60%) of current balance —
    /// defends against instant full-balance drain.
    /// Rule 2: a probe (<5% of balance) was executed within the last PROBE_WINDOW — defends against
    /// test-probe staged attack pattern.
    /// Rule 3: cumulative withdrawals in the last 72 hours exceed 30% — defends against slow drain.
    /// @param user The address being evaluated.
    /// @param amount The withdrawal amount being requested.
    /// @param balance The user's current vault balance before deduction.
    /// @return bool True if the withdrawal should be delayed, false if it can execute instantly.
    function _isRisky(address user, uint256 amount, uint256 balance) internal view returns (bool) {
        // RULE 1: amount > threshold % of balance (cross-multiplied, no rounding)
        bool largeWithdrawal = amount * 100 > balance * _largeWithdrawPercent(user);

        // RULE 2: probe (< 5%) executed within the last PROBE_WINDOW
        bool suspiciousPattern = _isProbeActive(user);

        // RULE 3: cumulative withdrawals in last 72h > 30% of balance
        // (used + amount / balance > cap, cross-multiplied so the current amount is not rounded)
        (bool windowActive, uint256 used) = _windowUsage(user);
        bool cumulativeExceeded = windowActive && used * balance + amount * WAD > MAX_INSTANT_WITHDRAW_WAD * balance;

        return largeWithdrawal || suspiciousPattern || cumulativeExceeded;
    }

    /// @notice Returns the user's Rule 1 threshold, falling back to DEFAULT_LARGE_WITHDRAW_PERCENT if unset.
    function _largeWithdrawPercent(address user) internal view returns (uint256) {
        uint256 percent = largeWithdrawPercent[user];
        return percent == 0 ? DEFAULT_LARGE_WITHDRAW_PERCENT : percent;
    }

    /// @notice Returns true if the user's last executed withdrawal was a probe within PROBE_WINDOW.
    function _isProbeActive(address user) internal view returns (bool) {
        uint256 probeTime = lastProbeTime[user];
        return probeTime != 0 && block.timestamp <= probeTime + PROBE_WINDOW;
    }

    /// @notice Returns whether the user's Rule 3 window is active and the share used in it.
    /// @dev An expired or never-started window reports (false, 0) even though storage still holds
    /// the old values; storage is only reset by the next executed withdrawal.
    /// @return active True if a window started within the last WINDOW_DURATION_FOR_MAX_WITHDRAW.
    /// @return used Cumulative withdrawn share in the window (WAD), 0 if not active.
    function _windowUsage(address user) internal view returns (bool active, uint256 used) {
        uint256 start = windowStartTime[user];
        active = start != 0 && block.timestamp <= start + WINDOW_DURATION_FOR_MAX_WITHDRAW;
        if (active) used = withdrawnInWindow[user];
    }

    /// @notice Returns the largest amount the user can withdraw right now without being delayed.
    /// @dev Mirrors _isRisky: 0 if a withdrawal is pending or a probe is active (Rule 2), otherwise
    /// the smaller of the Rule 1 threshold and the share left in an active Rule 3 window.
    function _instantLimit(address user) internal view returns (uint256) {
        if (pendingWithdraw[user].amount > 0) return 0;
        if (_isProbeActive(user)) return 0; // Rule 2 — next withdrawal will be flagged regardless

        uint256 balance = balances[user];
        uint256 limit = (balance * _largeWithdrawPercent(user)) / 100; // Rule 1 threshold

        (bool windowActive, uint256 used) = _windowUsage(user);
        if (windowActive) {
            uint256 windowLimit =
                used >= MAX_INSTANT_WITHDRAW_WAD ? 0 : ((MAX_INSTANT_WITHDRAW_WAD - used) * balance) / WAD; // Rule 3 remaining
            if (windowLimit < limit) limit = windowLimit;
        }

        return limit;
    }

    /// @notice Records whether an executed withdrawal was a probe (< 5% of balance).
    /// @dev Called only when funds actually leave the vault, never at queue time, so cancelling a
    /// pending withdrawal cannot erase a probe. Comparison avoids division so tiny amounts are not
    /// rounded down to 0%.
    /// @param user The address whose probe state is being updated.
    /// @param amount The executed withdrawal amount.
    /// @param balance The user's vault balance before the withdrawal was deducted.
    function _recordProbe(address user, uint256 amount, uint256 balance) internal {
        lastProbeTime[user] = amount * 10_000 < balance * 500 ? block.timestamp : 0;
    }

    /// @notice Sends ETH to a recipient address using a low-level call.
    /// @dev Balance state is always updated before this function is called.
    /// @param to The recipient address.
    /// @param amount The amount of ETH to send in wei.
    function _sendEth(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");

        if (!success) revert TransferFailed();
    }

    /// @notice Tracks the cumulative withdrawn share within the current 72-hour window.
    /// @dev Three cases: first use (initialize window), window expired (reset window and start fresh),
    /// window active (accumulate). Shares are calculated against the user's balance at the
    /// time of each withdrawal, deposits during an active window do not reset accumulation but do
    /// dilute future withdrawal shares since they are calculated against the new larger balance.
    /// Shares are stored in WAD and rounded up, so rounding can never let a withdrawal under-count.
    /// @param user The address whose window is being updated.
    /// @param amount The executed withdrawal amount.
    /// @param balance The user's vault balance before the withdrawal was deducted.
    function _updateWithdrawWindow(address user, uint256 amount, uint256 balance) internal {
        uint256 share = (amount * WAD + balance - 1) / balance; // ceil(amount / balance) in WAD
        uint256 start = windowStartTime[user];

        // Initialize window if first use
        if (start == 0) {
            windowStartTime[user] = block.timestamp;
            withdrawnInWindow[user] = share;
            return;
        }

        // Reset window if 72 hours have passed since start
        if (block.timestamp > start + WINDOW_DURATION_FOR_MAX_WITHDRAW) {
            windowStartTime[user] = block.timestamp;

            withdrawnInWindow[user] = share;

            return;
        }

        // Otherwise accumulate share in current window
        withdrawnInWindow[user] += share;
    }

    /*
    ============================================================
                    SAFE ADDRESS MANAGEMENT
    ============================================================
    */

    /// @notice Register the first trusted recovery address (slot 0).
    /// @dev No delay required for initial setup — there is no existing safe address to protect.
    /// Only allowed while both slots are empty. Once set, use requestSafeAddressChange to add a
    /// backup in slot 1 or replace either slot. Registered addresses are the only valid
    /// destinations for withdrawToSafe.
    /// @param _safe The trusted recovery address to register.
    function setSafeAddress(address _safe) external {
        if (_safe == address(0)) {
            revert InvalidSafeAddress();
        }

        address[2] storage slots = safeAddresses[msg.sender];
        if (slots[0] != address(0) || slots[1] != address(0)) {
            revert SafeAddressAlreadySet();
        }
        if (_safe == msg.sender) {
            revert InvalidSafeAddress();
        }

        slots[0] = _safe;

        emit SafeAddressSet(msg.sender, _safe);
    }

    /// @notice Request to write a safe address into a slot. Takes effect after 24 hours.
    /// @dev Writing to an empty slot 1 adds a backup; writing to a filled slot replaces it.
    /// Blocked during emergency lock. The 24-hour delay prevents an attacker with a compromised
    /// key from immediately rerouting a safe address and draining via withdrawToSafe.
    /// Only one pending change allowed at a time. Cannot be requested while a withdrawal is pending.
    /// Slots can never be cleared: address(0) is never a valid new address.
    /// @param slot The slot to write (0 = primary, 1 = backup). Slot 0 must already be set.
    /// @param _newSafe The new trusted recovery address. Must not already be in either slot.
    function requestSafeAddressChange(uint8 slot, address _newSafe) external {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        if (slot > 1) {
            revert InvalidSafeSlot();
        }

        if (_newSafe == address(0)) {
            revert InvalidSafeAddress();
        }

        address[2] storage slots = safeAddresses[msg.sender];

        if (slots[0] == address(0)) {
            revert SafeAddressNotSet();
        }

        if (slots[0] == _newSafe || slots[1] == _newSafe) {
            revert SafeAddressAlreadySet();
        }

        if (_newSafe == msg.sender) {
            revert InvalidSafeAddress();
        }

        if (pendingSafeChange[msg.sender].newSafe != address(0)) {
            revert PendingSafeChangeExists();
        }

        if (pendingWithdraw[msg.sender].amount != 0) {
            revert PendingWithdrawalExists();
        }

        uint64 unlockTime = uint64(block.timestamp + SAFE_ADDRESS_CHANGE_DELAY);

        pendingSafeChange[msg.sender] = PendingSafeChange({newSafe: _newSafe, slot: slot, unlockTime: unlockTime});

        emit SafeAddressChangeRequested(msg.sender, slots[slot], _newSafe, slot, unlockTime);
    }

    /// @notice Confirm a pending safe address change after the delay has expired.
    /// @dev Blocked during emergency lock. An attacker cannot queue a change during lock,
    /// wait for the delay, and confirm it, both request and confirm are blocked while locked.
    /// Writes the pending address into its requested slot.
    function confirmSafeAddressChange() external {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        PendingSafeChange memory pending = pendingSafeChange[msg.sender];

        if (pending.newSafe == address(0)) {
            revert NoPendingSafeChange();
        }

        if (block.timestamp < pending.unlockTime) {
            revert SafeChangeDelayNotOver();
        }

        safeAddresses[msg.sender][pending.slot] = pending.newSafe;

        delete pendingSafeChange[msg.sender];

        emit SafeAddressChangeConfirmed(msg.sender, pending.newSafe, pending.slot);
    }

    /// @notice Cancel a pending safe address change. Both slots keep their current addresses.
    /// @dev Intentionally NOT blocked during emergency lock. Cancelling is always a safe action
    /// and the user may need to cancel a malicious pending change while the vault is locked.
    function cancelSafeAddressChange() external {
        address cancelled = pendingSafeChange[msg.sender].newSafe;

        if (cancelled == address(0)) {
            revert NoPendingSafeChange();
        }

        delete pendingSafeChange[msg.sender];

        emit SafeAddressChangeCancelled(msg.sender, cancelled);
    }

    /// @notice Send a specified amount from the vault balance to one of the registered safe addresses.
    /// @dev Blocked during emergency lock. The lock is an absolute freeze — nothing leaves
    /// the vault while locked, including withdrawToSafe. This ensures the passive protection
    /// use case (locking for an extended period) cannot be bypassed via the safe address path.
    /// Accepts a partial or full amount. Cannot be called while a
    /// pending withdrawal exists.
    /// @param safe The destination. Must be non-zero and equal to one of the user's two safe slots.
    /// @param amount The amount of native token to send to the safe address.
    function withdrawToSafe(address safe, uint256 amount) external nonReentrant {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        if (amount == 0) revert AmountZero();

        if (safe == address(0)) {
            revert InvalidSafeAddress();
        }

        address[2] storage slots = safeAddresses[msg.sender];
        if (safe != slots[0] && safe != slots[1]) {
            revert SafeAddressNotRegistered();
        }

        if (pendingWithdraw[msg.sender].amount != 0) {
            revert PendingWithdrawalExists();
        }

        uint256 userBalance = balances[msg.sender];
        if (amount > userBalance) revert InsufficientBalance(userBalance);
        balances[msg.sender] -= amount;

        _sendEth(safe, amount);
        emit WithdrawToSafe(msg.sender, safe, amount);
    }

    /*
    ============================================================
                WITHDRAW THRESHOLD MANAGEMENT
    ============================================================
    */

    /// @notice Request a change to the Rule 1 large-withdrawal threshold.
    /// @dev Stricter (lower) values apply instantly, clear any pending raise and are allowed during
    /// emergency lock, since tightening can only add protection. Looser (higher) values require a
    /// 24-hour delay so an attacker with a compromised key cannot instantly raise the threshold and
    /// drain in one withdrawal. Raises are blocked during emergency lock and while another change is
    /// pending.
    /// @param newPercent The new threshold. Must be between MIN_LARGE_WITHDRAW_PERCENT and
    /// MAX_LARGE_WITHDRAW_PERCENT and differ from the current threshold.
    function requestThresholdChange(uint256 newPercent) external {
        if (newPercent < MIN_LARGE_WITHDRAW_PERCENT || newPercent > MAX_LARGE_WITHDRAW_PERCENT) {
            revert ThresholdOutOfBounds();
        }

        uint256 current = _largeWithdrawPercent(msg.sender);
        if (newPercent == current) {
            revert ThresholdUnchanged();
        }

        // Stricter: apply instantly and drop any pending raise
        if (newPercent < current) {
            uint256 pendingPercent = pendingThresholdChange[msg.sender].newPercent;
            if (pendingPercent != 0) {
                delete pendingThresholdChange[msg.sender];
                emit ThresholdChangeCancelled(msg.sender, pendingPercent);
            }

            largeWithdrawPercent[msg.sender] = newPercent;

            emit ThresholdChangeApplied(msg.sender, newPercent);
            return;
        }

        // Looser: queue behind THRESHOLD_CHANGE_DELAY
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        if (pendingThresholdChange[msg.sender].newPercent != 0) {
            revert PendingThresholdChangeExists();
        }

        uint64 unlockTime = uint64(block.timestamp + THRESHOLD_CHANGE_DELAY);

        pendingThresholdChange[msg.sender] =
            PendingThresholdChange({newPercent: uint8(newPercent), unlockTime: unlockTime});

        emit ThresholdChangeRequested(msg.sender, newPercent, unlockTime);
    }

    /// @notice Confirm a pending threshold raise after the delay has expired.
    /// @dev Blocked during emergency lock, mirroring confirmSafeAddressChange.
    function confirmThresholdChange() external {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        PendingThresholdChange memory pending = pendingThresholdChange[msg.sender];

        if (pending.newPercent == 0) {
            revert NoPendingThresholdChange();
        }

        if (block.timestamp < pending.unlockTime) {
            revert ThresholdChangeDelayNotOver();
        }

        largeWithdrawPercent[msg.sender] = pending.newPercent;

        delete pendingThresholdChange[msg.sender];

        emit ThresholdChangeApplied(msg.sender, pending.newPercent);
    }

    /// @notice Cancel a pending threshold raise. The current threshold is unchanged.
    /// @dev Intentionally NOT blocked during emergency lock. Cancelling is always a safe action.
    function cancelThresholdChange() external {
        uint256 cancelled = pendingThresholdChange[msg.sender].newPercent;

        if (cancelled == 0) {
            revert NoPendingThresholdChange();
        }

        delete pendingThresholdChange[msg.sender];

        emit ThresholdChangeCancelled(msg.sender, cancelled);
    }

    /*
    ============================================================
                    VIEW HELPERS
    ============================================================
    */
    /// @notice Returns the vault balance for a given user.
    function getUserVaultBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /// @notice Returns true if the user has an active pending withdrawal.
    function hasPendingWithdraw(address user) external view returns (bool) {
        return pendingWithdraw[user].amount > 0;
    }

    /// @notice Returns the maximum amount the user can withdraw instantly without triggering a delay.
    function getInstantWithdrawLimit(address user) external view returns (uint256) {
        return _instantLimit(user);
    }

    /// @notice Returns the user's Rule 3 cumulative window state with expiry applied.
    /// @dev Shares are WAD-scaled (1e18 = 100% of balance). An expired or never-started window
    /// returns (0, MAX_INSTANT_WITHDRAW_WAD, 0, 0): the next executed withdrawal starts a new window.
    /// @return used Share withdrawn in the active window.
    /// @return remaining Share still allowed before Rule 3 flags a withdrawal (0 if exhausted).
    /// @return windowStart Timestamp the active window started, 0 if none.
    /// @return resetsIn Seconds until the active window expires and stops counting, 0 if none.
    function getWindowState(address user)
        external
        view
        returns (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetsIn)
    {
        bool active;
        (active, used) = _windowUsage(user);
        remaining = used >= MAX_INSTANT_WITHDRAW_WAD ? 0 : MAX_INSTANT_WITHDRAW_WAD - used;

        if (active) {
            windowStart = windowStartTime[user];
            // Window is active while block.timestamp <= start + duration
            resetsIn = windowStart + WINDOW_DURATION_FOR_MAX_WITHDRAW + 1 - block.timestamp;
        }
    }

    /// @notice Returns the amount, unlock time, and request time of the user's pending withdrawal.
    function getPendingWithdraw(address user)
        external
        view
        returns (uint256 amount, uint256 unlockTime, uint256 requestTime)
    {
        WithdrawalRequest memory req = pendingWithdraw[user];

        return (req.amount, req.unlockTime, req.requestTime);
    }

    /// @notice Returns true if the user's vault is currently under emergency lock.
    function isVaultLocked(address user) external view returns (bool) {
        return block.timestamp < lockedUntil[user];
    }

    /// @notice Returns the remaining lock time in seconds, or zero if the vault is not locked.
    function getRemainingLockTime(address user) external view returns (uint256) {
        uint256 lockTime = lockedUntil[user];

        if (block.timestamp >= lockTime) {
            return 0;
        }

        return lockTime - block.timestamp;
    }

    /// @notice Returns the remaining delay in seconds before the pending withdrawal can be executed, or zero if ready.
    function getRemainingPendingTime(address user) external view returns (uint256) {
        WithdrawalRequest memory req = pendingWithdraw[user];

        if (req.amount == 0) {
            return 0;
        }

        if (block.timestamp >= req.unlockTime) {
            return 0;
        }

        return req.unlockTime - block.timestamp;
    }

    /// @notice Returns a full snapshot of the user's vault state in a single call.
    function getUserState(address user)
        external
        view
        returns (
            uint256 balance,
            uint256 instantLimit,
            bool hasPending,
            uint256 pendingAmount,
            uint256 remainingPendingTime,
            bool isLocked,
            uint256 remainingLockTime
        )
    {
        balance = balances[user];
        WithdrawalRequest memory req = pendingWithdraw[user];
        instantLimit = _instantLimit(user);

        hasPending = req.amount > 0;

        pendingAmount = req.amount;

        if (req.amount > 0 && block.timestamp < req.unlockTime) {
            remainingPendingTime = req.unlockTime - block.timestamp;
        }

        isLocked = block.timestamp < lockedUntil[user];

        if (isLocked) {
            remainingLockTime = lockedUntil[user] - block.timestamp;
        }
    }

    /// @notice Returns both safe address slots (0 = primary, 1 = backup). Empty slots are address(0).
    function getSafeAddresses(address user) external view returns (address[2] memory) {
        return safeAddresses[user];
    }

    /// @notice Returns the pending safe address change, its target slot and remaining delay,
    /// or zero values if none exists.
    function getPendingSafeChange(address user)
        external
        view
        returns (address newSafe, uint8 slot, uint256 remainingTime)
    {
        PendingSafeChange memory pending = pendingSafeChange[user];

        if (pending.newSafe == address(0)) {
            return (address(0), 0, 0);
        }

        if (block.timestamp >= pending.unlockTime) {
            return (pending.newSafe, pending.slot, 0);
        }

        return (pending.newSafe, pending.slot, pending.unlockTime - block.timestamp);
    }

    /// @notice Returns the user's Rule 1 threshold, any pending raise and its remaining delay.
    /// @return currentPercent The threshold currently applied (default if never changed).
    /// @return pendingPercent The pending raise, or 0 if none.
    /// @return remainingTime Seconds until the pending raise can be confirmed, or 0 if ready or none.
    function getThresholdState(address user)
        external
        view
        returns (uint256 currentPercent, uint256 pendingPercent, uint256 remainingTime)
    {
        currentPercent = _largeWithdrawPercent(user);

        PendingThresholdChange memory pending = pendingThresholdChange[user];
        pendingPercent = pending.newPercent;

        if (pendingPercent != 0 && block.timestamp < pending.unlockTime) {
            remainingTime = pending.unlockTime - block.timestamp;
        }
    }

    /// @notice Returns the total ETH balance held by the contract across all users.
    function totalBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
