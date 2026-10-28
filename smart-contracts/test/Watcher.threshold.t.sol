// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";

/**
 * @title Watcher configurable Rule 1 threshold tests
 * @notice Covers default behavior, instant tightening, delayed loosening, confirm/cancel flows,
 * emergency lock interaction, bounds, and instant limit views.
 */
contract WatcherThresholdTest is Test {
    Watcher vault;

    address user = makeAddr("user");

    uint256 constant INITIAL_BALANCE = 100 ether;

    function setUp() public {
        vault = new Watcher();
        vm.deal(user, INITIAL_BALANCE);

        vm.prank(user);
        vault.deposit{value: 10 ether}();
    }

    function _raiseTo(uint256 percent) internal {
        vm.prank(user);
        vault.requestThresholdChange(percent);

        vm.warp(block.timestamp + vault.THRESHOLD_CHANGE_DELAY());

        vm.prank(user);
        vault.confirmThresholdChange();
    }

    function _assertState(
        uint256 current,
        uint256 pending,
        uint256 remaining
    ) internal view {
        (uint256 c, uint256 p, uint256 r) = vault.getThresholdState(user);
        assertEq(c, current, "currentPercent");
        assertEq(p, pending, "pendingPercent");
        assertEq(r, remaining, "remainingTime");
    }

    /*//////////////////////////////////////////////////////////////
                            DEFAULT
    //////////////////////////////////////////////////////////////*/

    function test_default_stateIs60() public view {
        _assertState(60, 0, 0);
    }

    function test_default_boundaryAt60Percent() public {
        vm.prank(user);
        vault.withdraw(6 ether); // exactly 60% — not > 60%
        assertFalse(vault.hasPendingWithdraw(user));
    }

    function test_default_justAbove60PercentIsFlagged() public {
        vm.prank(user);
        vault.withdraw(6 ether + 1); // 1 wei over 60%
        assertTrue(vault.hasPendingWithdraw(user));
    }

    // Fresh user: no probe, no window, so only Rule 1 applies. The new cross-multiplied check
    // must match the old `amount > (balance * 60) / 100` for every input.
    function testFuzz_default_matchesOldRule1(
        uint256 balance,
        uint256 amount
    ) public {
        balance = bound(balance, 1, 1_000_000 ether);
        amount = bound(amount, 1, balance);

        address fresh = makeAddr("fresh");
        vm.deal(fresh, balance);

        vm.startPrank(fresh);
        vault.deposit{value: balance}();
        vault.withdraw(amount);
        vm.stopPrank();

        bool oldRule1 = amount > (balance * 60) / 100;
        assertEq(vault.hasPendingWithdraw(fresh), oldRule1);
    }

    /*//////////////////////////////////////////////////////////////
                        TIGHTENING (INSTANT)
    //////////////////////////////////////////////////////////////*/

    function test_lower_appliesInstantly() public {
        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Watcher.ThresholdChangeApplied(user, 40);
        vault.requestThresholdChange(40);

        _assertState(40, 0, 0);

        vm.prank(user);
        vault.withdraw(5 ether); // 50% > 40%
        assertTrue(vault.hasPendingWithdraw(user));
    }

    function test_lower_allowedDuringEmergencyLock() public {
        vm.startPrank(user);
        vault.emergencyLock(24 hours);
        vault.requestThresholdChange(30);
        vm.stopPrank();

        _assertState(30, 0, 0);
    }

    function test_lower_clearsPendingRaise() public {
        vm.prank(user);
        vault.requestThresholdChange(80);
        _assertState(60, 80, 24 hours);

        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Watcher.ThresholdChangeCancelled(user, 80);
        vm.expectEmit(true, false, false, true);
        emit Watcher.ThresholdChangeApplied(user, 40);
        vault.requestThresholdChange(40);

        _assertState(40, 0, 0);

        vm.prank(user);
        vm.expectRevert(Watcher.NoPendingThresholdChange.selector);
        vault.confirmThresholdChange();
    }

    /*//////////////////////////////////////////////////////////////
                        LOOSENING (DELAYED)
    //////////////////////////////////////////////////////////////*/

    function test_raise_isDelayed() public {
        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Watcher.ThresholdChangeRequested(
            user,
            80,
            block.timestamp + 24 hours
        );
        vault.requestThresholdChange(80);

        _assertState(60, 80, 24 hours);

        // Still on 60% until confirmed
        vm.prank(user);
        vault.withdraw(7 ether);
        assertTrue(vault.hasPendingWithdraw(user));
    }

    function test_raise_blockedDuringEmergencyLock() public {
        vm.startPrank(user);
        vault.emergencyLock(24 hours);

        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.requestThresholdChange(80);
        vm.stopPrank();

        _assertState(60, 0, 0);
    }

    function test_raise_revertsIfPendingExists() public {
        vm.startPrank(user);
        vault.requestThresholdChange(80);

        vm.expectRevert(Watcher.PendingThresholdChangeExists.selector);
        vault.requestThresholdChange(90);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                            CONFIRM
    //////////////////////////////////////////////////////////////*/

    function test_confirm_revertsBeforeDelay() public {
        vm.prank(user);
        vault.requestThresholdChange(80);

        vm.warp(block.timestamp + 24 hours - 1);

        vm.prank(user);
        vm.expectRevert(Watcher.ThresholdChangeDelayNotOver.selector);
        vault.confirmThresholdChange();

        _assertState(60, 80, 1);
    }

    function test_confirm_succeedsAtDelay() public {
        vm.prank(user);
        vault.requestThresholdChange(80);

        vm.warp(block.timestamp + 24 hours);

        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Watcher.ThresholdChangeApplied(user, 80);
        vault.confirmThresholdChange();

        _assertState(80, 0, 0);
    }

    function test_confirm_succeedsAfterDelay() public {
        vm.prank(user);
        vault.requestThresholdChange(80);

        vm.warp(block.timestamp + 10 days);

        vm.prank(user);
        vault.confirmThresholdChange();

        _assertState(80, 0, 0);

        vm.prank(user);
        vault.withdraw(7 ether); // 70% <= 80%
        assertFalse(vault.hasPendingWithdraw(user));
    }

    function test_confirm_blockedDuringEmergencyLock() public {
        vm.startPrank(user);
        vault.requestThresholdChange(80);
        vault.emergencyLock(2 days);

        vm.warp(block.timestamp + 24 hours);

        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.confirmThresholdChange();
        vm.stopPrank();

        _assertState(60, 80, 0);
    }

    function test_confirm_revertsIfNoPending() public {
        vm.prank(user);
        vm.expectRevert(Watcher.NoPendingThresholdChange.selector);
        vault.confirmThresholdChange();
    }

    /*//////////////////////////////////////////////////////////////
                            CANCEL
    //////////////////////////////////////////////////////////////*/

    function test_cancel_clearsPending() public {
        vm.startPrank(user);
        vault.requestThresholdChange(80);

        vm.expectEmit(true, false, false, true);
        emit Watcher.ThresholdChangeCancelled(user, 80);
        vault.cancelThresholdChange();
        vm.stopPrank();

        _assertState(60, 0, 0);
    }

    function test_cancel_allowedDuringEmergencyLock() public {
        vm.startPrank(user);
        vault.requestThresholdChange(80);
        vault.emergencyLock(24 hours);

        vault.cancelThresholdChange();
        vm.stopPrank();

        _assertState(60, 0, 0);
    }

    function test_cancel_revertsIfNoPending() public {
        vm.prank(user);
        vm.expectRevert(Watcher.NoPendingThresholdChange.selector);
        vault.cancelThresholdChange();
    }

    /*//////////////////////////////////////////////////////////////
                        BOUNDS / UNCHANGED
    //////////////////////////////////////////////////////////////*/

    function test_request_revertsOutOfBounds() public {
        vm.startPrank(user);

        vm.expectRevert(Watcher.ThresholdOutOfBounds.selector);
        vault.requestThresholdChange(0);

        vm.expectRevert(Watcher.ThresholdOutOfBounds.selector);
        vault.requestThresholdChange(9);

        vm.expectRevert(Watcher.ThresholdOutOfBounds.selector);
        vault.requestThresholdChange(101);

        vm.stopPrank();
    }

    function test_request_revertsIfEqualToCurrent() public {
        vm.startPrank(user);

        vm.expectRevert(Watcher.ThresholdUnchanged.selector);
        vault.requestThresholdChange(60); // default

        vault.requestThresholdChange(40);

        vm.expectRevert(Watcher.ThresholdUnchanged.selector);
        vault.requestThresholdChange(40);

        vm.stopPrank();
    }

    function test_request_acceptsBounds() public {
        vm.prank(user);
        vault.requestThresholdChange(10);
        _assertState(10, 0, 0);

        _raiseTo(100);
        _assertState(100, 0, 0);
    }

    /*//////////////////////////////////////////////////////////////
                        RULE 1 AT 100% / VIEWS
    //////////////////////////////////////////////////////////////*/

    function test_at100Percent_fullBalanceWithdrawPassesRule1() public {
        _raiseTo(100);

        vm.prank(user);
        vault.withdraw(10 ether);

        assertFalse(vault.hasPendingWithdraw(user));
        assertEq(vault.balances(user), 0);
        assertEq(user.balance, INITIAL_BALANCE);
    }

    function test_instantLimit_reflectsThreshold() public {
        assertEq(vault.getInstantWithdrawLimit(user), 6 ether);
        (, uint256 limit, , , , , ) = vault.getUserState(user);
        assertEq(limit, 6 ether);

        vm.prank(user);
        vault.requestThresholdChange(25);

        assertEq(vault.getInstantWithdrawLimit(user), 2.5 ether);
        (, limit, , , , , ) = vault.getUserState(user);
        assertEq(limit, 2.5 ether);

        _raiseTo(100);

        assertEq(vault.getInstantWithdrawLimit(user), 10 ether);
        (, limit, , , , , ) = vault.getUserState(user);
        assertEq(limit, 10 ether);
    }

    function test_instantLimit_isExactRule1Boundary() public {
        vm.prank(user);
        vault.requestThresholdChange(35);

        uint256 limit = vault.getInstantWithdrawLimit(user);

        vm.prank(user);
        vault.withdraw(limit);
        assertFalse(vault.hasPendingWithdraw(user));
    }
}
