// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ** CORE PROTOCOL, NO INTEGRATIONS **
// ** CORE PROTOCOL, NO INTEGRATIONS **
// ** CORE PROTOCOL, NO INTEGRATIONS **
/**
 * @title LockFi
 * @author Leticia Azevedo (@letiweb3)
 * @notice LockFi is a self-custody security vault that protects users from instant fund drainage
 * by introducing behavioral risk detection on withdrawals. Suspicious or large withdrawals are
 * delayed instead of executed immediately, giving users a reaction window to cancel, lock the
 * vault, or route funds to a pre-registered safe address before any funds leaves the contract.
 * @dev Withdrawals are evaluated against three behavioral rules: large withdrawal threshold (>60%),
 * test-probe pattern detection (<5% followed by any withdrawal), and cumulative 72-hour window
 * tracking (>30%). Each user's state is fully isolated. Emergency lock accepts a user-defined
 * duration (1h to 30 days) and can only be extended, never shortened. Safe address changes
 * require a 24-hour delay and are blocked during emergency lock.
 * Deployed on Monad Testnet. 1st Place — Monad Hackathon 2026.
 */
contract LockFi is ReentrancyGuard {
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

    uint256 public constant DELAY = 12 hours;
    uint256 public constant MIN_LOCK_DURATION = 1 hours;
    uint256 public constant MAX_LOCK_DURATION = 30 days;
    uint256 public constant SAFE_ADDRESS_CHANGE_DELAY = 24 hours;
    uint256 public constant WINDOW_DURATION_FOR_MAX_WITHDRAW = 72 hours;
    uint256 public constant MAX_INSTANT_WITHDRAW_PERCENT = 30;

    mapping(address => uint256) public balances; //Tracks withdrawable funds
    mapping(address => WithdrawalRequest) public pendingWithdraw; // Pending withdrawals per user
    mapping(address => uint256) public lastWithdrawPercent; // Tracks last withdrawal %.
    mapping(address => uint256 endTimeout) public lockedUntil; // Tracks until when withdrawal is locked for that user
    mapping(address => address) public safeAddress; //safe address for each user, used as recovery in case of compromise.
    mapping(address => address) public pendingSafeAddress; //pending safe address change, requires delay before execution.
    mapping(address => uint256) public safeChangeUnlockTime; // Tracks when pending safe address change can be executed.
    mapping(address => uint256) public withdrawnInWindow; // Tracks cumulative withdrawn % in current window for each user
    mapping(address => uint256) public windowStartTime; // Tracks start time of current window for cumulative withdrawal %

    //Pending withdrawal structure, each user can only have ONE pending withdrawal.
    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockTime; // When execution allowed
        uint256 requestTime; // Timestamp created
    }

    //EVENTS
    event Deposited(address indexed user, uint256 amount);
    event WithdrawalRequested(address indexed user, uint256 amount, uint256 unlockTime, uint256 requestTime);
    event WithdrawalExecuted(address indexed user, uint256 amount);
    event WithdrawalCancelled(address indexed user, uint256 amount);
    event EmergencyLockActivated(address indexed user, uint256 lockedUntil);
    event SafeAddressSet(address indexed user, address safe);
    event SafeAddressChangeRequested(address indexed previousSafe, address indexed newSafe, uint256 unlockTime);
    event SafeAddressChangeConfirmed(address indexed user, address newSafe);
    event SafeAddressChangeCancelled(address indexed user); //should show cancelled address too
    event WithdrawToSafe(address indexed user, address safe, uint256 amount);

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
        uint256 withdrawPercent = (amount * 100) / userBalance; // Calculate withdrawal percentage for lastWithdrawPercent tracking
        lastWithdrawPercent[msg.sender] = withdrawPercent; // Update last withdrawal %
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
        _updateWithdrawWindow(msg.sender, withdrawPercent);
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
        if (block.timestamp < lockedUntil[msg.sender]) {
            revert EmergencyLockOngoing();
        }

        delete pendingWithdraw[msg.sender];

        uint256 balanceBeforeRequest = balances[msg.sender] + executeAmount;
        uint256 percent = (executeAmount * 100) / balanceBeforeRequest;
        _updateWithdrawWindow(msg.sender, percent);
        _sendEth(msg.sender, executeAmount);

        emit WithdrawalExecuted(msg.sender, executeAmount);
    }

    /// @notice Cancel a pending withdrawal and restore funds to the vault balance.
    /// @dev intentionally does NOT reset lastWithdrawPercent. Resetting would allow an attacker
    /// to erase their probe history by cancelling a flagged withdrawal and repeating the sequence.
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
    /// and withdrawToSafe while active.
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
    /// Rule 1: amount exceeds 60% of current balance — defends against instant full-balance drain.
    /// Rule 2: lastWithdrawPercent < 5% — defends against test-probe staged attack pattern.
    /// Rule 3: cumulative withdrawals in the last 72 hours exceed 30% — defends against slow drain.
    /// @param user The address being evaluated.
    /// @param amount The withdrawal amount being requested.
    /// @param balance The user's current vault balance before deduction.
    /// @return bool True if the withdrawal should be delayed, false if it can execute instantly.
    function _isRisky(address user, uint256 amount, uint256 balance) internal view returns (bool) {
        // RULE 1: amount > 60% of balance
        bool largeWithdrawal = amount > (balance * 60) / 100;

        // RULE 2: last withdrawal < 5%
        uint256 lastPercent = lastWithdrawPercent[user];

        bool hasPreviousWithdrawal = lastPercent > 0;
        bool isLastWithdrawSmall = lastPercent < 5;
        bool suspiciousPattern = hasPreviousWithdrawal && isLastWithdrawSmall;

        // RULE 3: cumulative withdrawals in last 72h > 30% of balance
        uint256 currentPercent = (amount * 100) / balance;
        uint256 accumulated = withdrawnInWindow[user];
        uint256 startTime = windowStartTime[user];
        bool cumulativeExceeded = false; // Default to false if no withdrawals in window or window expired

        if (startTime != 0) {
            bool windowActive = block.timestamp <= startTime + WINDOW_DURATION_FOR_MAX_WITHDRAW;

            if (windowActive) {
                cumulativeExceeded = accumulated + currentPercent > MAX_INSTANT_WITHDRAW_PERCENT;
            }
        }

        return largeWithdrawal || suspiciousPattern || cumulativeExceeded;
    }

    /// @notice Sends ETH to a recipient address using a low-level call.
    /// @dev Balance state is always updated before this function is called.
    /// @param to The recipient address.
    /// @param amount The amount of ETH to send in wei.
    function _sendEth(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");

        if (!success) revert TransferFailed();
    }

    /// @notice Tracks the cumulative withdrawal percentage within the current 72-hour window.
    /// @dev Three cases: first use (initialize window), window expired (reset window and start fresh),
    /// window active (accumulate). Percent values are calculated against the user's balance at the
    /// time of each withdrawal, deposits during an active window do not reset accumulation but do
    /// dilute future withdrawal percentages since they are calculated against the new larger balance.
    /// @param user The address whose window is being updated.
    /// @param percent The withdrawal percentage to record, calculated as (amount * 100) / balance.
    function _updateWithdrawWindow(address user, uint256 percent) internal {
        uint256 start = windowStartTime[user];

        // Initialize window if first use
        if (start == 0) {
            windowStartTime[user] = block.timestamp;
            withdrawnInWindow[user] = percent;
            return;
        }

        // Reset window if 72 hours have passed since start
        if (block.timestamp > start + WINDOW_DURATION_FOR_MAX_WITHDRAW) {
            windowStartTime[user] = block.timestamp;

            withdrawnInWindow[user] = percent;

            return;
        }

        // Otherwise accumulate percent in current window
        withdrawnInWindow[user] += percent;
    }

    /*
    ============================================================
                    SAFE ADDRESS MANAGEMENT
    ============================================================
    */

    /// @notice Register a trusted recovery address for the first time.
    /// @dev No delay required for initial setup — there is no existing safe address to protect.
    /// Once set, use requestSafeAddressChange to change it. The safe address is the destination for withdrawToSafe.
    /// @param _safe The trusted recovery address to register.
    function setSafeAddress(address _safe) external {
        if (_safe == address(0)) {
            revert InvalidSafeAddress();
        }

        if (safeAddress[msg.sender] != address(0)) {
            revert SafeAddressAlreadySet();
        }
        if (_safe == msg.sender) {
            revert InvalidSafeAddress();
        }

        safeAddress[msg.sender] = _safe;

        emit SafeAddressSet(msg.sender, _safe);
    }

    /// @notice Request a change to the registered safe address. Takes effect after 24 hours.
    /// @dev Blocked during emergency lock. The 24-hour delay prevents an attacker with a
    /// compromised key from immediately rerouting the safe address and draining via withdrawToSafe.
    /// Only one pending change allowed at a time. Cannot be requested while a withdrawal is pending.
    /// @param _newSafe The new trusted recovery address to request.
    function requestSafeAddressChange(address _newSafe) external {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        if (_newSafe == address(0)) {
            revert InvalidSafeAddress();
        }

        if (safeAddress[msg.sender] == address(0)) {
            revert SafeAddressNotSet();
        }

        if (safeAddress[msg.sender] == _newSafe) {
            revert SafeAddressAlreadySet();
        }

        if (_newSafe == msg.sender) {
            revert InvalidSafeAddress();
        }

        if (pendingSafeAddress[msg.sender] != address(0)) {
            revert PendingSafeChangeExists();
        }

        if (pendingWithdraw[msg.sender].amount != 0) {
            revert PendingWithdrawalExists();
        }

        uint256 unlockTime = block.timestamp + SAFE_ADDRESS_CHANGE_DELAY;

        pendingSafeAddress[msg.sender] = _newSafe;
        safeChangeUnlockTime[msg.sender] = unlockTime;

        emit SafeAddressChangeRequested(safeAddress[msg.sender], _newSafe, unlockTime);
    }

    /// @notice Confirm a pending safe address change after the delay has expired.
    /// @dev Blocked during emergency lock. An attacker cannot queue a change during lock,
    /// wait for the delay, and confirm it, both request and confirm are blocked while locked.
    function confirmSafeAddressChange() external {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        address pending = pendingSafeAddress[msg.sender];

        if (pending == address(0)) {
            revert NoPendingSafeChange();
        }

        if (block.timestamp < safeChangeUnlockTime[msg.sender]) {
            revert SafeChangeDelayNotOver();
        }

        safeAddress[msg.sender] = pending;

        delete pendingSafeAddress[msg.sender];
        delete safeChangeUnlockTime[msg.sender];

        emit SafeAddressChangeConfirmed(msg.sender, pending);
    }

    /// @notice Cancel a pending safe address change. Restores the previous safe address.
    /// @dev Intentionally NOT blocked during emergency lock. Cancelling is always a safe action
    /// and the user may need to cancel a malicious pending change while the vault is locked.
    function cancelSafeAddressChange() external {
        if (pendingSafeAddress[msg.sender] == address(0)) {
            revert NoPendingSafeChange();
        }

        delete pendingSafeAddress[msg.sender];
        delete safeChangeUnlockTime[msg.sender];

        emit SafeAddressChangeCancelled(msg.sender);
    }

    /// @notice Send a specified amount from the vault balance to the registered safe address.
    /// @dev Blocked during emergency lock. The lock is an absolute freeze — nothing leaves
    /// the vault while locked, including withdrawToSafe. This ensures the passive protection
    /// use case (locking for an extended period) cannot be bypassed via the safe address path.
    /// Accepts a partial or full amount. Updates the withdrawal window with the percentage
    /// sent relative to the balance at the time of the call. Cannot be called while a
    /// pending withdrawal exists.
    /// @param amount The amount of native token to send to the safe address.
    function withdrawToSafe(uint256 amount) external nonReentrant {
        if (lockedUntil[msg.sender] > block.timestamp) {
            revert EmergencyLockOngoing();
        }

        if (amount == 0) revert AmountZero();

        address safe = safeAddress[msg.sender];
        if (safe == address(0)) {
            revert SafeAddressNotSet();
        }

        if (pendingWithdraw[msg.sender].amount != 0) {
            revert PendingWithdrawalExists();
        }

        uint256 userBalance = balances[msg.sender];
        if (amount > userBalance) revert InsufficientBalance(userBalance);
        balances[msg.sender] -= amount;

        // if full balance, set window to 100
        // if partial, calculate percent normally
        uint256 percent = (amount * 100) / userBalance;
        windowStartTime[msg.sender] = block.timestamp;
        withdrawnInWindow[msg.sender] = percent;

        _sendEth(safe, amount);
        emit WithdrawToSafe(msg.sender, safe, amount);
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
        if (pendingWithdraw[user].amount > 0) return 0;

        // If last withdrawal was a small probe, next withdrawal will be flagged regardless
        if (lastWithdrawPercent[user] > 0 && lastWithdrawPercent[user] < 5) {
            return 0;
        }

        return (balances[user] * 60) / 100; // Rule 1 threshold
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
        if (req.amount > 0) {
            instantLimit = 0;
        } else if (lastWithdrawPercent[user] > 0 && lastWithdrawPercent[user] < 5) {
            instantLimit = 0; // Rule 2 — next withdrawal will be flagged regardless
        } else {
            instantLimit = (balance * 60) / 100; // Rule 1 threshold
        }

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

    /// @notice Returns the pending safe address change and remaining delay, or zero values if none exists.
    function getPendingSafeChange(address user) external view returns (address pendingSafe, uint256 remainingTime) {
        pendingSafe = pendingSafeAddress[user];

        if (pendingSafe == address(0)) {
            return (address(0), 0);
        }

        uint256 unlockTime = safeChangeUnlockTime[user];

        if (block.timestamp >= unlockTime) {
            return (pendingSafe, 0);
        }

        remainingTime = unlockTime - block.timestamp;
    }

    /// @notice Returns the total ETH balance held by the contract across all users.
    function totalBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
