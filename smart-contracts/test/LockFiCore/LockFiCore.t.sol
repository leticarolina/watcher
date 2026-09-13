// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {LockFi} from "../../src/LockFiCore.sol";

/**
 * @title LockFi Test Suite
 * @author Leticia Azevedo
 * @notice Unit tests for LockFi.sol covering all contract functions, risk detection rules,
 * edge cases, and behavioral invariants. Tests are organized by feature area.
 * @dev Test coverage includes: deposit/withdraw lifecycle, risk detection rules (Rule 1, 2, 3),
 * pending withdrawal queue (execute/cancel), emergency lock mechanics, safe address management,
 * withdrawToSafe flow, multi-user state isolation, and getter correctness.
 * Uses Foundry (forge-std). Actor addresses: leti (primary), shai, eve (secondary/safe targets).
 */
contract LockFiTest is Test {
    LockFi vault;

    address leti = address(1);
    address shai = address(2);
    address eve = address(3);

    uint256 constant INITIAL_BALANCE = 10 ether;

    function setUp() public {
        vault = new LockFi();

        // Fund test users
        vm.deal(leti, INITIAL_BALANCE);
        vm.deal(shai, INITIAL_BALANCE);
        vm.deal(eve, INITIAL_BALANCE);
    }

    modifier deposited(address user, uint256 amount) {
        vm.prank(user);
        vault.deposit{value: amount}();
        _;
    }

    function test_deposit() public {
        uint256 amount = 1 ether;

        vm.prank(leti);
        vault.deposit{value: amount}();

        uint256 balance = vault.balances(leti);

        assertEq(balance, amount);
    }

    function test_deposit_zeroAmount() public {
        vm.prank(leti);
        vm.expectRevert(LockFi.AmountZero.selector);
        vault.deposit();

        uint256 balance = vault.balances(leti);

        assertEq(balance, 0);
    }

    /*
    ============================================================
                SMALL WITHDRAW → INSTANT
    ============================================================
    */

    function test_withdraw_InstantRelease() public deposited(leti, 1 ether) {
        uint256 firstWithdraw = 0.1 ether; // 10%
        uint256 secondWithdraw = 0.1 ether; // 10%

        uint256 beforeBalance = leti.balance;

        vm.startPrank(leti);
        vault.withdraw(firstWithdraw);
        // small withdrawals should not trigger pending
        vault.withdraw(secondWithdraw);
        vm.stopPrank();

        bool hasPending = vault.hasPendingWithdraw(leti);
        assertFalse(hasPending);
        // ETH received
        assertEq(leti.balance, beforeBalance + secondWithdraw + firstWithdraw);
    }

    function test_withdraw_largeAmountPending() public deposited(leti, 1 ether) {
        uint256 withdrawAmount = 0.8 ether; // 80%
        uint256 currentBalance = vault.balances(leti);

        vm.prank(leti);
        vault.withdraw(withdrawAmount);

        assertEq(vault.balances(leti), currentBalance - withdrawAmount);

        bool hasPending = vault.hasPendingWithdraw(leti);
        assertTrue(hasPending);
        (uint256 amount, uint256 unlockTime, uint256 requestTime) = vault.getPendingWithdraw(leti);
        assertTrue(hasPending);
        assertEq(amount, withdrawAmount);
        assertGt(unlockTime, requestTime);
    }

    function test_withdraw_zeroAmountReverts() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(LockFi.AmountZero.selector);

        vault.withdraw(0);
    }

    function test_withdraw_insufficientBalanceReverts() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(abi.encodeWithSelector(LockFi.InsufficientBalance.selector, 1 ether));
        vault.withdraw(2 ether);
    }

    function test_withdraw_whenPendingExistsReverts() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.8 ether);

        vm.expectRevert(LockFi.PendingWithdrawExists.selector);

        vault.withdraw(0.1 ether);

        vm.stopPrank();
    }

    /*
    ============================================================
                CANCEL WITHDRAW
    ============================================================
    */

    function test_cancelWithdraw_restoresBalance() public deposited(leti, 1 ether) {
        uint256 withdrawAmount = 0.8 ether;

        vm.startPrank(leti);
        vault.withdraw(withdrawAmount);
        assertEq(vault.balances(leti), 1 ether - withdrawAmount);
        vault.cancelWithdraw();
        vm.stopPrank();

        uint256 balance = vault.balances(leti);

        assertEq(balance, 1 ether);

        bool hasPending = vault.hasPendingWithdraw(leti);

        assertFalse(hasPending);
    }

    function test_cancelWithdraw_withoutPendingReverts() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(LockFi.NoPendingWithdraw.selector);

        vault.cancelWithdraw();
    }

    function test_cancelWithdraw_whileLocked() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        vault.withdraw(0.8 ether);

        vault.emergencyLock(1 hours); // now auto-cancels the pending withdrawal

        bool hasPending = vault.hasPendingWithdraw(leti);

        assertFalse(hasPending);

        // Nothing left to cancel manually — emergencyLock already did it
        vm.expectRevert(LockFi.NoPendingWithdraw.selector);
        vault.cancelWithdraw();

        vm.stopPrank();
    }

    /*
    ============================================================
                EXECUTE AFTER DELAY
    ============================================================
    */

    function test_executeWithdraw_AfterDelay() public deposited(leti, 1 ether) {
        uint256 withdrawAmount = 0.8 ether;

        vm.startPrank(leti);
        vault.withdraw(withdrawAmount);
        // Warp forward 1 hour
        vm.warp(block.timestamp + 12 hours);

        uint256 beforeBalance = leti.balance;

        vault.executeWithdraw();

        vm.stopPrank();

        assertEq(leti.balance, beforeBalance + withdrawAmount);
    }

    function test_executeWithdraw_reverts_beforeDelay() public deposited(leti, 1 ether) {
        uint256 withdrawAmount = 0.8 ether;

        vm.startPrank(leti);

        vault.withdraw(withdrawAmount);

        vm.expectRevert(LockFi.TimeoutNotOver.selector);

        vault.executeWithdraw();

        vm.stopPrank();
    }

    function test_executeWithdraw_withoutPendingReverts() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(LockFi.NoPendingWithdraw.selector);

        vault.executeWithdraw();
    }

    function test_executeWithdraw_reducesContractBalance() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        vault.withdraw(0.8 ether);

        vm.warp(block.timestamp + 13 hours);

        uint256 before = vault.totalBalance();

        vault.executeWithdraw();

        uint256 afterBalance = vault.totalBalance();

        vm.stopPrank();

        assertEq(before - afterBalance, 0.8 ether);
    }

    // Execute pending withdrawal, then immediately try to withdraw again
    // withdrawnInWindow should now include the executed amount
    function test_executeWithdraw_thenWithdrawAgain_windowAccumulates() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.8 ether);
        vm.warp(block.timestamp + 12 hours);

        // Execute — withdrawnInWindow should now have 80% accumulated
        vault.executeWithdraw();

        // Try to withdraw again, any amount tips window over 30%
        vault.withdraw(0.1 ether);

        vm.stopPrank();

        // Rule 3 triggers — pending created
        bool hasPending = vault.hasPendingWithdraw(leti);
        assertTrue(hasPending);
    }

    /*
    ============================================================
                EMERGENCY LOCK BLOCKS WITHDRAW
    ============================================================
    */

    function test_emergencyLock_BlocksWithdraw() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.emergencyLock(24 hours);

        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);

        vault.withdraw(0.1 ether);

        vm.warp(block.timestamp + 23 hours); //move forward but still within lock duration
        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);
        vault.withdraw(0.1 ether);

        vm.warp(block.timestamp + 2 hours); //move forward past lock duration
        vault.withdraw(0.1 ether); // should work now

        vm.stopPrank();

        assertEq(vault.balances(leti), 1 ether - 0.1 ether);
    }

    function test_emergencyLock_resetsTimer() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.emergencyLock(24 hours);

        uint256 firstLock = vault.lockedUntil(leti);

        vm.warp(block.timestamp + 1 hours);

        vault.emergencyLock(30 hours); // must be longer than remaining time, which is 23 hours

        uint256 secondLock = vault.lockedUntil(leti);

        vm.stopPrank();
        assertGt(secondLock, firstLock);
    }

    function test_emergencyLock_DoesNotDecreaseTimer() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.emergencyLock(24 hours);

        uint256 firstLock = vault.lockedUntil(leti);

        vm.warp(block.timestamp + 4 hours);

        vm.expectRevert(LockFi.LockNotExtended.selector);
        vault.emergencyLock(2 hours); // must be longer than remaining time, which is 23 hours

        vm.stopPrank();

        assertEq(vault.lockedUntil(leti), firstLock);
    }

    // Lock expires exactly at block.timestamp — should be unlocked
    function test_emergencyLock_expiresAtExactTimestamp() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.emergencyLock(24 hours);

        // Warp to exactly the unlock time
        vm.warp(vault.lockedUntil(leti));

        assertFalse(vault.isVaultLocked(leti));

        // Withdraw should work
        vault.withdraw(0.1 ether);

        vm.stopPrank();

        assertFalse(vault.hasPendingWithdraw(leti));
    }

    // Extend lock while NOT currently locked (lockedUntil is 0 or past)
    // unlockTime = block.timestamp + duration > 0 → should always pass LockNotExtended
    function test_emergencyLock_whenNotCurrentlyLocked_alwaysPasses() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        // lockedUntil is 0 — any duration passes LockNotExtended
        // because block.timestamp + duration > 0 always
        vault.emergencyLock(1 hours);
        assertTrue(vault.isVaultLocked(leti));

        // Let lock expire
        vm.warp(vault.lockedUntil(leti));
        assertFalse(vault.isVaultLocked(leti));

        // Lock again after expiry — lockedUntil is in the past, should pass
        vault.emergencyLock(1 hours);
        assertTrue(vault.isVaultLocked(leti));

        vm.stopPrank();
    }

    // Min duration boundary — exactly 1 hour should succeed
    function test_emergencyLock_minDurationBoundary() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.emergencyLock(1 hours);
        assertTrue(vault.isVaultLocked(leti));

        vm.stopPrank();

        // One second below minimum should revert
        vm.startPrank(shai);
        vault.deposit{value: 1 ether}();

        vm.expectRevert(LockFi.DurationTooShort.selector);
        vault.emergencyLock(1 hours - 10 seconds);

        vm.stopPrank();
    }

    // Max duration boundary
    function test_emergencyLock_maxDurationBoundary() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        // Exactly MAX_LOCK_DURATION should succeed
        vault.emergencyLock(30 days);
        assertTrue(vault.isVaultLocked(leti));

        vm.stopPrank();

        // One second above maximum should revert
        vm.startPrank(shai);
        vault.deposit{value: 1 ether}();

        vm.expectRevert(LockFi.DurationTooLong.selector);
        vault.emergencyLock(30 days + 1 seconds);

        vm.stopPrank();
    }

    // One user's emergency lock doesn't affect another user
    function test_emergencyLock_isolatedPerUser() public deposited(leti, 1 ether) deposited(shai, 1 ether) {
        vm.prank(leti);
        vault.emergencyLock(24 hours);

        assertTrue(vault.isVaultLocked(leti));
        assertFalse(vault.isVaultLocked(shai)); // shai unaffected

        // Shai can still withdraw normally
        uint256 shaiBefore = shai.balance;
        vm.prank(shai);
        vault.withdraw(0.1 ether);

        assertEq(shai.balance, shaiBefore + 0.1 ether);
        assertFalse(vault.hasPendingWithdraw(shai));

        // Leti is still blocked
        vm.prank(leti);
        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);
        vault.withdraw(0.1 ether);
    }

    function test_cancelWithdraw_StillWorksWhileLocked() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        vault.withdraw(0.8 ether);

        vault.emergencyLock(24 hours); // now auto-cancels the pending withdrawal

        bool hasPending = vault.hasPendingWithdraw(leti);

        assertFalse(hasPending);

        // Nothing left to cancel manually — emergencyLock already did it
        vm.expectRevert(LockFi.NoPendingWithdraw.selector);
        vault.cancelWithdraw();

        vm.stopPrank();
    }

    function test_withdraw_afterLockExpires() public deposited(leti, 1 ether) {
        uint256 eveBeforeBalance = eve.balance;
        vm.startPrank(leti);
        vault.setSafeAddress(eve);
        vault.emergencyLock(24 hours);

        // Warp 24 hours
        vm.warp(block.timestamp + 24 hours);

        vault.withdraw(0.1 ether);
        vault.withdrawToSafe(0.9 ether); // full remaining balance, should work without pending

        vm.stopPrank();

        uint256 eveAfterBlance = eve.balance;
        bool hasPending = vault.hasPendingWithdraw(leti);
        assertFalse(hasPending);
        assertEq(vault.balances(leti), 0 ether);
        assertEq(eveAfterBlance, eveBeforeBalance + 0.9 ether);
    }

    function test_emergencyLock_doesNotWithdrawToSafe() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.emergencyLock(24 hours);

        uint256 safeBalanceBefore = shai.balance;

        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);
        vault.withdrawToSafe(1 ether);
        vm.stopPrank();

        uint256 safeBalanceAfter = shai.balance;

        assertEq(safeBalanceAfter, safeBalanceBefore);
    }

    /*
    ============================================================
            SUSPICIOUS PATTERN TEST
            (<5% → >40%)
    ============================================================
    */

    function test_suspiciousPattern_triggersPending() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        // Small withdraw (<5%)
        vault.withdraw(0.04 ether);

        // any withdraw
        vault.withdraw(0.5 ether);

        vm.stopPrank();

        bool hasPending = vault.hasPendingWithdraw(leti);

        assertTrue(hasPending);
    }

    // lastWithdrawPercent resets properly after window expires
    // User does small withdraw, waits 72h, does large withdraw — should NOT trigger Rule 2
    function test_suspiciousPattern_triggers_afterWindowReset() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.04 ether); // Small withdraw (<5%)

        vm.warp(block.timestamp + 73 hours); // Warp forward 72 hours to reset window

        vault.withdraw(0.45 ether);

        vm.stopPrank();

        bool hasPending = vault.hasPendingWithdraw(leti);
        assertTrue(hasPending);
    }

    // Exactly 5% should NOT trigger isLastWithdrawSmall (rule is lastPercent < 5)
    function test_suspiciousPattern_boundary_5percent() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.05 ether); // exactly 5% — NOT < 5, so Rule 2 won't flag next withdraw

        vault.withdraw(0.45 ether); // rule 3 triggers because >40%, but Rule 2 does NOT trigger because lastPercent is not < 5

        vm.stopPrank();

        // Rule 2 should NOT trigger because lastPercent == 5, not < 5
        assertTrue(vault.hasPendingWithdraw(leti));
    }

    /*
    ============================================================
            CUMMULATIVE WINDOW RULE 3
    ============================================================
    */
    function test_cumulativeWithdraw_triggersDelay() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.1 ether);
        vault.withdraw(0.1 ether);
        vault.withdraw(0.1 ether);

        vm.expectRevert(LockFi.PendingWithdrawExists.selector);
        vault.withdraw(0.1 ether);

        vm.stopPrank();
    }

    function test_cumulativeWithdraw_windowResetsAfterDuration() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.3 ether);

        vm.warp(block.timestamp + 72 hours);

        vault.withdraw(0.3 ether);

        vm.stopPrank();
    }

    // User withdraws 20%, then deposits more ETH, then withdraws again
    // The window tracks percent of balance at time of each withdrawal
    // Does a deposit "dilute" the accumulated percent or not?
    function test_cumulativeWithdraw_depositDuringWindow_doesNotResetAccumulation() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        // 20% of 1 ETH → accumulated = 20, balance = 0.8 ETH
        vault.withdraw(0.2 ether);

        // deposit mid-window → balance = 1.8 ETH, accumulated stays at 20
        vault.deposit{value: 1 ether}();

        // 0.2 / 1.8 = ~11% → accumulated = 31 > 30 → Rule 3 triggers
        vault.withdraw(0.2 ether);

        vm.stopPrank();

        bool hasPending = vault.hasPendingWithdraw(leti);
        assertTrue(hasPending);
    }

    // Withdraw exactly 30% — should NOT trigger (rule uses > 30, not >= 30)
    function test_cumulativeWithdraw_exactBoundary_singleWithdraw() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.3 ether); // exactly 30% of 1 ETH → accumulated = 30
        // 30 > 30 is false → should NOT trigger

        bool hasPending = vault.hasPendingWithdraw(leti);
        assertFalse(hasPending);

        vault.withdraw(0.1 ether); // tiny % but accumulated + this > 30

        bool hasPendingAfter = vault.hasPendingWithdraw(leti);
        assertTrue(hasPendingAfter);

        vm.stopPrank();
    }

    // One user's cumulative window doesn't bleed into another
    function test_cumulativeWindow_isolatedPerUser() public {
        vm.prank(leti);
        vault.deposit{value: 1 ether}();

        vm.prank(shai);
        vault.deposit{value: 1 ether}();

        vm.startPrank(leti);
        // Leti burns through her window — 3 x 10% = accumulated > 30%
        vault.withdraw(0.1 ether);
        vault.withdraw(0.1 ether);
        vault.withdraw(0.1 ether); // this one triggers pending for leti
        vm.stopPrank();

        // Shai's window should be completely unaffected
        vm.startPrank(shai);
        vault.withdraw(0.1 ether);
        vault.withdraw(0.15 ether);
        vm.stopPrank();

        assertTrue(vault.hasPendingWithdraw(leti));
        assertFalse(vault.hasPendingWithdraw(shai));
    }

    function test_cancelWithdraw_doesNotIncreaseWindow() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.withdraw(0.8 ether);

        vault.cancelWithdraw();

        vault.withdraw(0.3 ether);

        vm.stopPrank();
    }

    /*
    ============================================================
                SAFE ADDRESS TESTS
    ============================================================
    */

    function test_setSafeAddress_reverts_ifZeroOrAlreadySet() public deposited(leti, 1 ether) {
        vm.prank(leti);
        vm.expectRevert(LockFi.InvalidSafeAddress.selector);
        vault.setSafeAddress(address(0));

        vm.prank(leti);
        vault.setSafeAddress(shai);

        vm.prank(leti);
        vm.expectRevert(LockFi.SafeAddressAlreadySet.selector);
        vault.setSafeAddress(eve);
    }

    function test_setSafeAddresse_reverts_ifInvalidAddress() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vm.expectRevert(LockFi.InvalidSafeAddress.selector);
        vault.setSafeAddress(leti); // same as sender
        vm.stopPrank();
    }

    function test_setSafeAddress_success() public deposited(leti, 1 ether) {
        vm.prank(leti);
        vm.expectEmit(true, false, false, true);
        emit LockFi.SafeAddressSet(leti, shai);
        vault.setSafeAddress(shai);

        address safe = vault.safeAddress(leti);
        assertEq(safe, shai);
    }

    function test_requestSafeAddressChange_reverts_whileEmergencyLocked() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.emergencyLock(24 hours);

        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);
        vault.requestSafeAddressChange(eve);

        vm.stopPrank();

        // Safe address unchanged
        assertEq(vault.safeAddress(leti), shai);
        assertEq(vault.pendingSafeAddress(leti), address(0));
    }

    function test_requestSafeAddressChange_reverts_ifNotSetOrPendingExists() public deposited(leti, 1 ether) {
        vm.startPrank(leti);
        vm.expectRevert(LockFi.SafeAddressNotSet.selector);
        vault.requestSafeAddressChange(shai);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve);

        vm.expectRevert(LockFi.PendingSafeChangeExists.selector);
        vault.requestSafeAddressChange(address(0x04));

        vm.stopPrank();
    }

    function test_requestSafeAddressChange_reverts_ifInvalidAddressOrHasPending() public deposited(leti, 1 ether) {
        vm.startPrank(leti);
        vault.setSafeAddress(shai);

        vm.expectRevert(LockFi.InvalidSafeAddress.selector);
        vault.requestSafeAddressChange(leti); // same as sender

        vm.expectRevert(LockFi.SafeAddressAlreadySet.selector);
        vault.requestSafeAddressChange(shai); // same as current safe

        vault.requestSafeAddressChange(eve); // valid change
        vm.expectRevert(LockFi.PendingSafeChangeExists.selector);
        vault.requestSafeAddressChange(address(0x04)); // another change while pending

        vm.stopPrank();
    }

    function test_requestSafeAddressChange_reverts_ifPendingWithdrawExists() public deposited(leti, 1 ether) {
        vm.startPrank(leti);
        vault.setSafeAddress(shai);

        vault.withdraw(0.8 ether); // >60% → pending

        vm.expectRevert(LockFi.PendingWithdrawalExists.selector);
        vault.requestSafeAddressChange(eve);

        vm.stopPrank();
    }

    function test_requestSafeAddressChange_success() public deposited(leti, 1 ether) {
        vm.startPrank(leti);
        vault.setSafeAddress(shai);

        vm.expectEmit(true, true, false, true);
        emit LockFi.SafeAddressChangeRequested(shai, eve, block.timestamp + 24 hours);
        vault.requestSafeAddressChange(eve);

        (address pendingSafe, uint256 unlockTime) = vault.getPendingSafeChange(address(leti));

        assertEq(pendingSafe, eve);
        assertEq(unlockTime, 24 hours);

        vm.stopPrank();
    }

    function test_confirmSafeAddressChange_reverts_ifNoPending() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(LockFi.NoPendingSafeChange.selector);
        vault.confirmSafeAddressChange();
    }

    function test_confirmSafeAddressChange_reverts_ifDelayNotOver() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve);

        vm.expectRevert(LockFi.SafeChangeDelayNotOver.selector);
        vault.confirmSafeAddressChange();

        vm.stopPrank();
    }

    function test_confirmSafeAddressChange_whileEmergencyLocked() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve); // request before locking

        vault.emergencyLock(2 days); // lock for 2 days

        // Warp past the safe change delay but still within the lock duration
        vm.warp(block.timestamp + 24 hours);

        // confirm is blocked during emergency lock
        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);
        vault.confirmSafeAddressChange();

        vm.stopPrank();

        // Safe address unchanged — still shai
        assertEq(vault.safeAddress(leti), shai);
        assertEq(vault.pendingSafeAddress(leti), eve); // pending still exists
    }

    function test_confirmSafeAddressChange_success() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve);

        vm.warp(block.timestamp + 24 hours);

        vm.expectEmit(true, true, false, true);
        emit LockFi.SafeAddressChangeConfirmed(leti, eve);
        vault.confirmSafeAddressChange();

        address newSafe = vault.safeAddress(leti);
        assertEq(newSafe, eve);

        (address pendingSafe, uint256 unlockTime) = vault.getPendingSafeChange(leti);

        assertEq(pendingSafe, address(0));
        assertEq(unlockTime, 0);

        vm.stopPrank();
    }

    function test_cancelSafeAddressChange_reverts_ifNoPending() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(LockFi.NoPendingSafeChange.selector);
        vault.cancelSafeAddressChange();
    }

    function test_cancelSafeAddressChange_success() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve);

        vm.expectEmit(true, false, false, true);
        emit LockFi.SafeAddressChangeCancelled(leti);
        vault.cancelSafeAddressChange();

        (address pendingSafe, uint256 unlockTime) = vault.getPendingSafeChange(leti);

        assertEq(pendingSafe, address(0));
        assertEq(unlockTime, 0);

        address currentSafe = vault.safeAddress(leti);
        assertEq(currentSafe, shai);

        vm.stopPrank();
    }

    function test_withdrawToSafe_reverts_ifEmergencyLockIsActive() public deposited(leti, 1 ether) {
        vm.startPrank(leti);
        vault.setSafeAddress(shai);
        vault.emergencyLock(24 hours);

        vm.expectRevert(LockFi.EmergencyLockOngoing.selector);
        vault.withdrawToSafe(1 ether);
    }

    function test_withdrawToSafe_reverts_ifSafeNotSet() public deposited(leti, 1 ether) {
        vm.prank(leti);

        vm.expectRevert(LockFi.SafeAddressNotSet.selector);
        vault.withdrawToSafe(1 ether);
    }

    function test_withdrawToSafe_reverts_ifPendingWithdrawExists() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        vault.withdraw(0.8 ether); // >60% → pending

        vm.expectRevert(LockFi.PendingWithdrawalExists.selector);
        vault.withdrawToSafe(0.1 ether); // remaining balance is 0.2 ether

        vm.stopPrank();
    }

    function test_withdrawToSafe_reverts_ifAmountZero() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        vm.expectRevert(LockFi.AmountZero.selector);
        vault.withdrawToSafe(0);

        vm.stopPrank();
    }

    function test_withdrawToSafe_reverts_ifBalanceZero() public {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        vm.expectRevert(abi.encodeWithSelector(LockFi.InsufficientBalance.selector, 0));
        vault.withdrawToSafe(1 ether);

        vm.stopPrank();
    }

    function test_withdrawToSafe_reverts_ifAmountExceedsBalance() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        vm.expectRevert(abi.encodeWithSelector(LockFi.InsufficientBalance.selector, 1 ether));
        vault.withdrawToSafe(2 ether);

        vm.stopPrank();
    }

    function test_withdrawToSafe_success_andClearsUserBalance() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        uint256 safeBalanceBefore = shai.balance;

        vm.expectEmit(true, true, false, true);
        emit LockFi.WithdrawToSafe(leti, shai, 1 ether);
        vault.withdrawToSafe(1 ether);

        uint256 safeBalanceAfter = shai.balance;

        assertEq(safeBalanceAfter, safeBalanceBefore + 1 ether);

        uint256 remaining = vault.balances(leti);
        assertEq(remaining, 0);

        vm.stopPrank();
    }

    function test_withdrawToSafe_partialAmount_leavesRemainderAndUpdatesWindow() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        uint256 safeBalanceBefore = shai.balance;

        vm.expectEmit(true, true, false, true);
        emit LockFi.WithdrawToSafe(leti, shai, 0.4 ether);
        vault.withdrawToSafe(0.4 ether); // 40% of balance, partial

        vm.stopPrank();

        assertEq(shai.balance, safeBalanceBefore + 0.4 ether);
        assertEq(vault.balances(leti), 0.6 ether); // remainder stays in vault
        assertEq(vault.withdrawnInWindow(leti), 40); // window tracks the % sent
    }

    function test_withdrawToSafe_withUpdatedSafeAddress() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);

        vault.requestSafeAddressChange(eve);

        vm.warp(block.timestamp + 24 hours);

        vault.confirmSafeAddressChange();

        assertEq(vault.safeAddress(leti), eve);

        uint256 eveBalanceBefore = eve.balance;

        // withdrawToSafe should go to eve
        vault.withdrawToSafe(1 ether);

        vm.stopPrank();

        assertEq(eve.balance, eveBalanceBefore + 1 ether);
        assertEq(shai.balance, INITIAL_BALANCE); // untouched
        assertEq(vault.balances(leti), 0);
    }

    /*
    ============================================================
            BEHAVIOUR TEST
    ============================================================
    */

    function test_multipleUsersDeposit_accountingIsolation() public {
        vm.prank(leti);
        vault.deposit{value: 1 ether}();

        vm.prank(shai);
        vault.deposit{value: 1 ether}();

        vm.prank(leti);
        vault.withdraw(0.8 ether);

        bool letiPending = vault.hasPendingWithdraw(leti);

        bool shaiPending = vault.hasPendingWithdraw(shai);

        assertTrue(letiPending);
        assertFalse(shaiPending);

        uint256 shaiBalanceBefore = shai.balance;
        vm.prank(shai);
        vault.withdraw(0.1 ether);

        assertEq(shai.balance, shaiBalanceBefore + 0.1 ether);
    }

    function test_multiUser_accountingIntegrity() public {
        vm.prank(leti);
        vault.deposit{value: 1 ether}();

        vm.prank(shai);
        vault.deposit{value: 2 ether}();

        vm.prank(leti);
        vault.withdraw(0.8 ether);

        (uint256 pendingAmount,,) = vault.getPendingWithdraw(leti);

        uint256 total = vault.totalBalance();

        uint256 letiBal = vault.balances(leti);

        uint256 shaiBal = vault.balances(shai);

        assertEq(total, letiBal + shaiBal + pendingAmount);
    }

    function test_repeatedPendingCycle() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        for (uint256 i = 0; i < 3; i++) {
            vault.withdraw(0.8 ether);

            vault.cancelWithdraw();
        }

        vm.stopPrank();

        uint256 balance = vault.balances(leti);

        assertEq(balance, 1 ether);
    }

    function test_exactBoundary60Percent() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        // exactly 60%
        vault.withdraw(0.6 ether);

        vm.stopPrank();

        bool hasPending = vault.hasPendingWithdraw(leti);

        // > 60 triggers, not == 60
        assertFalse(hasPending);
    }

    function test_receiveFunctionDeposit() public {
        vm.prank(leti);

        (bool success,) = address(vault).call{value: 1 ether}("");

        assertTrue(success);

        uint256 balance = vault.balances(leti);

        assertEq(balance, 1 ether);
    }

    // Cancel pending, deposit more, withdraw again — full cycle
    function test_fullCycle_cancelDepositWithdraw() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        // Trigger pending
        vault.withdraw(0.8 ether);
        assertEq(vault.balances(leti), 0.2 ether);
        assertTrue(vault.hasPendingWithdraw(leti));

        // Cancel — balance restored
        vault.cancelWithdraw();
        assertEq(vault.balances(leti), 1 ether);
        assertFalse(vault.hasPendingWithdraw(leti));

        // Deposit more
        vault.deposit{value: 1 ether}();
        assertEq(vault.balances(leti), 2 ether);

        // Withdraw small amount — should be instant
        vault.withdraw(0.1 ether);
        assertFalse(vault.hasPendingWithdraw(leti));

        uint256 finalBalance = vault.balances(leti);
        assertEq(finalBalance, 1.9 ether);

        vm.stopPrank();
    }

    /*
    ============================================================
            GETTERS TEST
    ============================================================
    */

    function test_getUserVaultBalance() public {
        vm.prank(leti);

        vault.deposit{value: 1 ether}();

        uint256 balance = vault.getUserVaultBalance(leti);

        assertEq(balance, 1 ether);
    }

    function test_hasPendingWithdraw() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        bool hasPending = vault.hasPendingWithdraw(leti);
        assertFalse(hasPending);
        vault.withdraw(0.8 ether);

        vm.stopPrank();

        bool hasPendingAfter = vault.hasPendingWithdraw(leti);

        assertTrue(hasPendingAfter);
    }

    function test_getInstantWithdrawLimit() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        uint256 available = vault.getInstantWithdrawLimit(leti);
        assertEq(available, 0.6 ether);

        vault.withdraw(0.8 ether);

        uint256 afterPending = vault.getInstantWithdrawLimit(leti);

        assertEq(afterPending, 0);

        vm.stopPrank();
    }

    function test_getPendingWithdraw() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        vault.withdraw(0.8 ether);

        (uint256 amount, uint256 unlockTime, uint256 requestTime) = vault.getPendingWithdraw(leti);

        assertEq(amount, 0.8 ether);
        assertGt(unlockTime, requestTime);

        vm.stopPrank();
    }

    function test_IsVaultLocked() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();
        vault.emergencyLock(24 hours);

        bool locked = vault.isVaultLocked(leti);
        assertTrue(locked);

        vm.warp(block.timestamp + 24 hours);
        bool unlocked = vault.isVaultLocked(leti);
        assertFalse(unlocked);

        vm.stopPrank();
    }

    function test_getRemainingLockTime() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        vault.emergencyLock(24 hours);

        uint256 remaining = vault.getRemainingLockTime(leti);

        assertGt(remaining, 0);
        assertEq(remaining, 24 hours);

        vm.warp(block.timestamp + 1 hours);
        uint256 afterWarp = vault.getRemainingLockTime(leti);
        assertEq(afterWarp, 23 hours);

        vm.stopPrank();
    }

    function test_getRemainingPendingTime() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();

        vault.withdraw(0.8 ether);

        uint256 remaining = vault.getRemainingPendingTime(leti);

        assertGt(remaining, 0);
        assertEq(remaining, 12 hours);

        vm.stopPrank();
    }

    function test_getUserState() public {
        vm.startPrank(leti);

        vault.deposit{value: 1 ether}();
        vault.withdraw(0.8 ether);

        (
            uint256 balance,
            uint256 instantLimit,
            bool hasPending,
            uint256 pendingAmount,
            uint256 remainingPendingTime,
            bool locked,
        ) = vault.getUserState(leti);

        assertEq(balance, 0.2 ether);
        assertEq(instantLimit, 0 ether);
        assertTrue(hasPending);
        assertEq(pendingAmount, 0.8 ether);
        assertEq(remainingPendingTime, 12 hours);
        assertFalse(locked);

        vm.stopPrank();
    }

    function test_getPendingSafeChange_returnsZero_ifNone() public deposited(leti, 1 ether) {
        (address pendingSafe, uint256 unlockTime) = vault.getPendingSafeChange(leti);

        assertEq(pendingSafe, address(0));
        assertEq(unlockTime, 0);
    }

    function test_getPendingSafeChange_returnsPendingData() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve);

        (address pendingSafe, uint256 unlockTime) = vault.getPendingSafeChange(leti);

        assertEq(pendingSafe, eve);
        assertEq(unlockTime, 24 hours);

        vm.stopPrank();
    }

    function test_getPendingSafeChange_returnsZero_afterCancel() public deposited(leti, 1 ether) {
        vm.startPrank(leti);

        vault.setSafeAddress(shai);
        vault.requestSafeAddressChange(eve);

        vault.cancelSafeAddressChange();

        (address pendingSafe, uint256 unlockTime) = vault.getPendingSafeChange(leti);

        assertEq(pendingSafe, address(0));
        assertEq(unlockTime, 0);

        vm.stopPrank();
    }
}
