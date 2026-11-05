// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Watcher
 * @author Leticia Azevedo (@letiweb3)
 * @notice Watcher is a self-custody security protocol that protects instant fund drainage
 * by introducing behavioral risk detection on withdrawals. Suspicious or large withdrawals are
 * delayed instead of executed immediately, giving users a reaction window to cancel, lock or
 * route funds to a pre-registered safe address before any funds leaves.
 * @dev Withdrawals are evaluated against three behavioral rules, any single match delays the withdrawal:
 * RULE 1 (large withdrawal): amount exceeds the user’s configurable threshold (10–100%, default 60%);
 * tightening applies instantly, loosening requires a 24-hour delay.
 * RULE 2 (probe detection): a small withdrawal (<5% of balance) was executed within the last 72 hours,
 * flagging a test-probe staged attack pattern.
 * RULE 3 (cumulative window): total withdrawals in the last 72 hours exceed 30% of balance,
 * defending against slow drain across multiple transactions.
 * Each user’s state is isolated. Emergency lock accepts a user-defined duration (1h to 30 days),
 * can only be extended never shortened, and blocks all outflows while active.
 * Safe address changes require a 24-hour delay and are blocked during emergency lock.
 */

contract Watcher is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

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
    error TokenNotAllowed();
    error TokenAlreadyAllowed();
    error UseWETH();

    // Rule 1 — large withdrawal threshold
    uint256 public constant RISKY_WITHDRAWAL_DELAY = 12 hours;
    uint256 public constant DEFAULT_LARGE_WITHDRAW_PERCENT = 60;
    uint256 public constant MIN_LARGE_WITHDRAW_PERCENT = 10;
    uint256 public constant MAX_LARGE_WITHDRAW_PERCENT = 100;
    uint256 public constant THRESHOLD_CHANGE_DELAY = 24 hours;

    // Rule 2 — probe detection
    uint256 public constant PROBE_DETECTION_WINDOW = 72 hours;

    // Rule 3 — cumulative window
    uint256 public constant CUMULATIVE_WITHDRAW_WINDOW_DURATION = 72 hours;
    uint256 public constant MAX_CUMULATIVE_WITHDRAW_PERCENT = 30;
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_CUMULATIVE_WITHDRAW_WAD = (MAX_CUMULATIVE_WITHDRAW_PERCENT * WAD) / 100;

    uint256 public constant MIN_LOCK_DURATION = 1 hours;
    uint256 public constant MAX_LOCK_DURATION = 30 days;
    uint256 public constant SAFE_ADDRESS_CHANGE_DELAY = 24 hours;

    mapping(address => mapping(address => uint256)) public balances; // user => token => withdrawable funds
    mapping(address => mapping(address => WithdrawalRequest)) public pendingWithdraw; // Pending withdrawals per user per token
    mapping(address => mapping(address => uint256)) public lastProbeTime; // Per token: timestamp of last executed probe withdrawal (<5%), 0 = no probe
    mapping(address => uint256 endTimeout) public lockedUntil; // Tracks until when withdrawal is locked for that user
    mapping(address => address[2]) public safeAddresses; // Two trusted recovery slots per user: 0 = primary, 1 = backup.
    mapping(address => PendingSafeChange) public pendingSafeChange; // Pending safe address change, requires delay before execution.
    mapping(address => mapping(address => uint256)) withdrawnInWindow; // Per token: cumulative withdrawn share in current window (WAD, 1e18 = 100%), read via getWindowState
    mapping(address => mapping(address => uint256)) windowStartTime; // Per token: start time of current window, 0 = never used, read via getWindowState
    mapping(address => uint256) largeWithdrawPercent; // Rule 1 threshold per user, 0 = use DEFAULT_LARGE_WITHDRAW_PERCENT
    mapping(address => PendingThresholdChange) public pendingThresholdChange; // Pending Rule 1 threshold raise, requires delay before execution.
    mapping(address => bool) public allowedTokens; // ERC-20 tokens accepted by the vault
    address[] internal tokenList; // All allowed tokens, iterated to clear per-token pending withdrawals

    //Pending withdrawal structure, each user can only have ONE pending withdrawal.
    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockTime;
        uint256 requestTime;
    }

    //Pending safe address change, each user can only have ONE pending change.
    struct PendingSafeChange {
        address newSafe; // Address to write into the slot, address(0) = no pending change
        uint8 slot; // Target slot (0 or 1)
        uint64 unlockTime;
    }

    //Pending Rule 1 threshold raise, each user can only have ONE pending change.
    struct PendingThresholdChange {
        uint8 newPercent; // Requested threshold, 0 = no pending change
        uint64 unlockTime;
    }

    //EVENTS
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event WithdrawalRequested(
        address indexed user, address indexed token, uint256 amount, uint256 unlockTime, uint256 requestTime
    );
    event WithdrawalExecuted(address indexed user, address indexed token, uint256 amount);
    event WithdrawalCancelled(address indexed user, address indexed token, uint256 amount);
    event EmergencyLockActivated(address indexed user, uint256 lockedUntil);
    event SafeAddressSet(address indexed user, address safe);
    event SafeAddressChangeRequested(
        address indexed user, address indexed previousSafe, address indexed newSafe, uint8 slot, uint256 unlockTime
    );
    event SafeAddressChangeConfirmed(address indexed user, address newSafe, uint8 slot);
    event SafeAddressChangeCancelled(address indexed user, address cancelledSafe);
    event WithdrawToSafe(address indexed user, address indexed token, address safe, uint256 amount);
    event ThresholdChangeRequested(address indexed user, uint256 newPercent, uint256 unlockTime);
    event ThresholdChangeApplied(address indexed user, uint256 newPercent);
    event ThresholdChangeCancelled(address indexed user, uint256 cancelledPercent);

    /// @param initialTokens ERC-20 tokens accepted from deployment.
    constructor(address[] memory initialTokens) Ownable(msg.sender) {
        for (uint256 i = 0; i < initialTokens.length; i++) {
            allowedTokens[initialTokens[i]] = true;
            tokenList.push(initialTokens[i]);
        }
    }

    /// @notice Allow a new ERC-20 token in the vault. Tokens cannot be removed once added.
    function addToken(address token) external onlyOwner {
        if (token == address(0)) revert TokenNotAllowed();
        if (allowedTokens[token]) revert TokenAlreadyAllowed();
        allowedTokens[token] = true;
        tokenList.push(token);
    }

    /// @notice Deposit an allowed ERC-20 token into the vault.
    /// @dev Balance is tracked internally per token. Emits Deposited event.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (amount == 0) revert AmountZero();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    receive() external payable {
        revert UseWETH();
    }

    fallback() external payable {
        revert UseWETH();
    }

    /// @notice Attempt a withdrawal. Executes instantly if safe, enters pending queue if risky.
    /// @dev Risk is evaluated by _isRisky before any state changes. Balance is deducted immediately
    /// regardless of outcome to prevent double-spend.
    /// @param token The token to withdraw.
    /// @param amount The amount of token to withdraw.
    function withdraw(address token, uint256 amount) external nonReentrant {
        if (!allowedTokens[token]) revert TokenNotAllowed();

        if (amount == 0) {
            revert AmountZero();
        }

        // Check if vault is currently locked for the user (due to emergency lock)
        if (block.timestamp < lockedUntil[msg.sender]) {
            revert EmergencyLockOngoing();
        }

        uint256 userBalance = balances[msg.sender][token];

        // Ensure user has enough funds
        if (userBalance < amount) {
            revert InsufficientBalance(userBalance);
        }

        // Only ONE pending withdrawal allowed
        if (pendingWithdraw[msg.sender][token].amount != 0) {
            revert PendingWithdrawExists();
        }

        bool risky = _isRisky(msg.sender, token, amount, userBalance); //Determine whether withdrawal is risky
        balances[msg.sender][token] -= amount; // Deduct balance immediately

        //if risky - create a pending request
        if (risky) {
            uint256 unlockTime = block.timestamp + RISKY_WITHDRAWAL_DELAY;

            pendingWithdraw[msg.sender][token] =
                WithdrawalRequest({amount: amount, unlockTime: unlockTime, requestTime: block.timestamp});

            emit WithdrawalRequested(msg.sender, token, amount, unlockTime, block.timestamp);

            return;
        }

        // Send funds immediately if not risky and update withdrawal window tracking
        _updateWithdrawWindow(msg.sender, token, amount, userBalance);
        _recordProbe(msg.sender, token, amount, userBalance);
        _sendToken(token, msg.sender, amount);

        emit WithdrawalExecuted(msg.sender, token, amount);
    }

    /// @notice Execute a pending withdrawal after the delay has expired.
    /// @dev Blocked during emergency lock even if the pending request was created before the lock.
    /// This prevents an attacker who queued a withdrawal from executing it after the user locks.
    /// @param token The token of the pending withdrawal.
    function executeWithdraw(address token) external nonReentrant {
        WithdrawalRequest storage req = pendingWithdraw[msg.sender][token];
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

        delete pendingWithdraw[msg.sender][token];

        uint256 balanceBeforeRequest = balances[msg.sender][token] + executeAmount;
        _updateWithdrawWindow(msg.sender, token, executeAmount, balanceBeforeRequest);
        _recordProbe(msg.sender, token, executeAmount, balanceBeforeRequest);
        _sendToken(token, msg.sender, executeAmount);

        emit WithdrawalExecuted(msg.sender, token, executeAmount);
    }

    /// @notice Cancel a pending withdrawal and restore funds to the vault balance.
    /// @dev intentionally does NOT touch lastProbeTime. It is only written when funds actually leave
    /// the vault, so an attacker cannot erase their probe history by cancelling a flagged withdrawal.
    /// Cancellation is permitted during emergency lock.
    /// @param token The token of the pending withdrawal.
    function cancelWithdraw(address token) external {
        WithdrawalRequest storage req = pendingWithdraw[msg.sender][token];
        uint256 amount = req.amount;

        if (amount == 0) {
            revert NoPendingWithdraw();
        }

        balances[msg.sender][token] += amount;

        delete pendingWithdraw[msg.sender][token];

        emit WithdrawalCancelled(msg.sender, token, amount);
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

        // Auto-cancel any pending withdrawal on lock, across every allowed token
        for (uint256 i = 0; i < tokenList.length; i++) {
            address token = tokenList[i];
            uint256 pending = pendingWithdraw[msg.sender][token].amount;
            if (pending != 0) {
                balances[msg.sender][token] += pending;
                delete pendingWithdraw[msg.sender][token];
                emit WithdrawalCancelled(msg.sender, token, pending);
            }
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
    /// Rule 2: a probe (<5% of balance) was executed within the last PROBE_DETECTION_WINDOW — defends against
    /// test-probe staged attack pattern.
    /// Rule 3: cumulative withdrawals in the last 72 hours exceed 30% — defends against slow drain.
    /// @param user The address being evaluated.
    /// @param token The token being withdrawn.
    /// @param amount The withdrawal amount being requested.
    /// @param balance The user's current vault balance of token before deduction.
    /// @return bool True if the withdrawal should be delayed, false if it can execute instantly.
    function _isRisky(address user, address token, uint256 amount, uint256 balance) internal view returns (bool) {
        // RULE 1: amount > threshold % of balance (cross-multiplied, no rounding)
        bool largeWithdrawal = amount * 100 > balance * _largeWithdrawPercent(user);

        // RULE 2: probe (< 5%) executed within the last PROBE_DETECTION_WINDOW
        bool suspiciousPattern = _isProbeActive(user, token);

        // RULE 3: flag if (already used in the 72h window + this withdrawal's share) > 30%.
        // Written as multiplication instead of division so nothing gets rounded.
        (bool windowActive, uint256 used) = _windowUsage(user, token);
        bool cumulativeExceeded = windowActive && used * balance + amount * WAD > MAX_CUMULATIVE_WITHDRAW_WAD * balance;

        return largeWithdrawal || suspiciousPattern || cumulativeExceeded;
    }

    /// @notice Returns the user's Rule 1 threshold, falling back to DEFAULT_LARGE_WITHDRAW_PERCENT if unset.
    function _largeWithdrawPercent(address user) internal view returns (uint256) {
        uint256 percent = largeWithdrawPercent[user];
        return percent == 0 ? DEFAULT_LARGE_WITHDRAW_PERCENT : percent;
    }

    /// @notice Returns true if the user's last executed withdrawal was a probe within PROBE_DETECTION_WINDOW.
    function _isProbeActive(address user, address token) internal view returns (bool) {
        uint256 probeTime = lastProbeTime[user][token];
        return probeTime != 0 && block.timestamp <= probeTime + PROBE_DETECTION_WINDOW;
    }

    /// @notice Returns whether the user's Rule 3 window is active and the share used in it.
    /// @dev An expired or never-started window reports (false, 0) even though storage still holds
    /// the old values; storage is only reset by the next executed withdrawal.
    /// @return active True if a window started within the last CUMULATIVE_WITHDRAW_WINDOW_DURATION.
    /// @return used Cumulative withdrawn share in the window (WAD), 0 if not active.
    function _windowUsage(address user, address token) internal view returns (bool active, uint256 used) {
        uint256 start = windowStartTime[user][token];
        active = start != 0 && block.timestamp <= start + CUMULATIVE_WITHDRAW_WINDOW_DURATION;
        if (active) used = withdrawnInWindow[user][token];
    }

    /// @notice Returns the largest amount the user can withdraw right now without being delayed.
    /// @dev Mirrors _isRisky: 0 if a withdrawal is pending or a probe is active (Rule 2), otherwise
    /// the smaller of the Rule 1 threshold and the share left in an active Rule 3 window.
    function _instantLimit(address user, address token) internal view returns (uint256) {
        if (pendingWithdraw[user][token].amount > 0) return 0;
        if (_isProbeActive(user, token)) return 0; // Rule 2 — next withdrawal will be flagged regardless

        uint256 balance = balances[user][token];
        uint256 limit = (balance * _largeWithdrawPercent(user)) / 100; // Rule 1 threshold

        (bool windowActive, uint256 used) = _windowUsage(user, token);
        if (windowActive) {
            uint256 windowLimit =
                used >= MAX_CUMULATIVE_WITHDRAW_WAD ? 0 : ((MAX_CUMULATIVE_WITHDRAW_WAD - used) * balance) / WAD; // Rule 3 remaining
            if (windowLimit < limit) limit = windowLimit;
        }

        return limit;
    }

    /// @notice Records whether an executed withdrawal was a probe (< 5% of balance).
    /// @dev Called only when funds actually leave the vault, never at queue time, so cancelling a
    /// pending withdrawal cannot erase a probe. Comparison avoids division so tiny amounts are not
    /// rounded down to 0%.
    /// @param user The address whose probe state is being updated.
    /// @param token The token withdrawn.
    /// @param amount The executed withdrawal amount.
    /// @param balance The user's vault balance before the withdrawal was deducted.
    function _recordProbe(address user, address token, uint256 amount, uint256 balance) internal {
        lastProbeTime[user][token] = amount * 10_000 < balance * 500 ? block.timestamp : 0;
    }

    /// @notice Sends ERC-20 tokens to a recipient address using SafeERC20.
    /// @dev Balance state is always updated before this function is called.
    /// @param token The token to send.
    /// @param to The recipient address.
    /// @param amount The amount of token to send.
    function _sendToken(address token, address to, uint256 amount) internal {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Tracks the cumulative withdrawn share within the current 72-hour window.
    /// @dev Three cases: first use (initialize window), window expired (reset window and start fresh),
    /// window active (accumulate). Shares are calculated against the user's balance at the
    /// time of each withdrawal, deposits during an active window do not reset accumulation but do
    /// dilute future withdrawal shares since they are calculated against the new larger balance.
    /// Shares are stored in WAD and rounded up, so rounding can never let a withdrawal under-count.
    /// @param user The address whose window is being updated.
    /// @param token The token withdrawn.
    /// @param amount The executed withdrawal amount.
    /// @param balance The user's vault balance before the withdrawal was deducted.
    function _updateWithdrawWindow(address user, address token, uint256 amount, uint256 balance) internal {
        uint256 share = (amount * WAD + balance - 1) / balance; // ceil(amount / balance) in WAD
        uint256 start = windowStartTime[user][token];

        // Initialize window if first use
        if (start == 0) {
            windowStartTime[user][token] = block.timestamp;
            withdrawnInWindow[user][token] = share;
            return;
        }

        // Reset window if 72 hours have passed since start
        if (block.timestamp > start + CUMULATIVE_WITHDRAW_WINDOW_DURATION) {
            windowStartTime[user][token] = block.timestamp;

            withdrawnInWindow[user][token] = share;

            return;
        }

        // Otherwise accumulate share in current window
        withdrawnInWindow[user][token] += share;
    }

    /// @notice Returns true if the user has a pending withdrawal in any allowed token.
    function _hasAnyPendingWithdraw(address user) internal view returns (bool) {
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (pendingWithdraw[user][tokenList[i]].amount != 0) return true;
        }
        return false;
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

        if (_hasAnyPendingWithdraw(msg.sender)) {
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
    /// @param token The token to send.
    /// @param safe The destination. Must be non-zero and equal to one of the user's two safe slots.
    /// @param amount The amount of token to send to the safe address.
    function withdrawToSafe(address token, address safe, uint256 amount) external nonReentrant {
        if (!allowedTokens[token]) revert TokenNotAllowed();

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

        if (pendingWithdraw[msg.sender][token].amount != 0) {
            revert PendingWithdrawalExists();
        }

        uint256 userBalance = balances[msg.sender][token];
        if (amount > userBalance) revert InsufficientBalance(userBalance);
        balances[msg.sender][token] -= amount;

        _sendToken(token, safe, amount);
        emit WithdrawToSafe(msg.sender, token, safe, amount);
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
    function getUserVaultBalance(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }

    /// @notice Returns true if the user has an active pending withdrawal.
    function hasPendingWithdraw(address user, address token) external view returns (bool) {
        return pendingWithdraw[user][token].amount > 0;
    }

    /// @notice Returns the maximum amount the user can withdraw instantly without triggering a delay.
    function getInstantWithdrawLimit(address user, address token) external view returns (uint256) {
        return _instantLimit(user, token);
    }

    /// @notice Returns the user's Rule 3 cumulative window state with expiry applied.
    /// @dev Shares are WAD-scaled (1e18 = 100% of balance). An expired or never-started window
    /// returns (0, MAX_CUMULATIVE_WITHDRAW_WAD, 0, 0): the next executed withdrawal starts a new window.
    /// @return used Share withdrawn in the active window.
    /// @return remaining Share still allowed before Rule 3 flags a withdrawal (0 if exhausted).
    /// @return windowStart Timestamp the active window started, 0 if none.
    /// @return resetsIn Seconds until the active window expires and stops counting, 0 if none.
    function getWindowState(address user, address token)
        external
        view
        returns (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetsIn)
    {
        bool active;
        (active, used) = _windowUsage(user, token);
        remaining = used >= MAX_CUMULATIVE_WITHDRAW_WAD ? 0 : MAX_CUMULATIVE_WITHDRAW_WAD - used;

        if (active) {
            windowStart = windowStartTime[user][token];
            // Window is active while block.timestamp <= start + duration
            resetsIn = windowStart + CUMULATIVE_WITHDRAW_WINDOW_DURATION + 1 - block.timestamp;
        }
    }

    /// @notice Returns the amount, unlock time, and request time of the user's pending withdrawal.
    function getPendingWithdraw(address user, address token)
        external
        view
        returns (uint256 amount, uint256 unlockTime, uint256 requestTime)
    {
        WithdrawalRequest memory req = pendingWithdraw[user][token];

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
    function getRemainingPendingTime(address user, address token) external view returns (uint256) {
        WithdrawalRequest memory req = pendingWithdraw[user][token];

        if (req.amount == 0) {
            return 0;
        }

        if (block.timestamp >= req.unlockTime) {
            return 0;
        }

        return req.unlockTime - block.timestamp;
    }

    /// @notice Returns a full snapshot of the user's vault state in a single call.
    function getUserState(address user, address token)
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
        balance = balances[user][token];
        WithdrawalRequest memory req = pendingWithdraw[user][token];
        instantLimit = _instantLimit(user, token);

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
}
