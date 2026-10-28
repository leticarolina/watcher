// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";

/**
 * @title Watcher Rule 3 (cumulative window) tests
 * @notice Covers getWindowState expiry handling, instant limit respecting Rule 3, and WAD
 * precision so fractional percentages are no longer rounded down.
 */
contract WatcherWindowTest is Test {
    Watcher vault;

    address user = makeAddr("user");

    uint256 constant INITIAL_BALANCE = 10 ether;
    uint256 constant CAP = 0.3e18; // MAX_INSTANT_WITHDRAW_WAD

    function setUp() public {
        vault = new Watcher();
        vm.deal(user, INITIAL_BALANCE);

        vm.prank(user);
        vault.deposit{value: INITIAL_BALANCE}();
    }

    function _withdraw(uint256 amount) internal {
        vm.prank(user);
        vault.withdraw(amount);
    }

    /*//////////////////////////////////////////////////////////////
                            getWindowState
    //////////////////////////////////////////////////////////////*/

    function test_windowState_freshUser() public view {
        (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetsIn) = vault.getWindowState(user);

        assertEq(used, 0);
        assertEq(remaining, CAP);
        assertEq(windowStart, 0);
        assertEq(resetsIn, 0);
    }

    function test_windowState_afterWithdraw() public {
        _withdraw(1 ether); // 10%

        (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetsIn) = vault.getWindowState(user);

        assertEq(used, 0.1e18);
        assertEq(remaining, 0.2e18);
        assertEq(windowStart, block.timestamp);
        assertEq(resetsIn, vault.WINDOW_DURATION_FOR_MAX_WITHDRAW() + 1);
    }

    function test_windowState_expiryIsApplied() public {
        _withdraw(1 ether);
        uint256 start = block.timestamp;

        // Still active at the exact window boundary
        vm.warp(start + vault.WINDOW_DURATION_FOR_MAX_WITHDRAW());
        (uint256 used,,, uint256 resetsIn) = vault.getWindowState(user);
        assertEq(used, 0.1e18);
        assertEq(resetsIn, 1);

        // Expired: reports a clean window although storage was not reset yet
        vm.warp(start + vault.WINDOW_DURATION_FOR_MAX_WITHDRAW() + 1);
        uint256 remaining;
        uint256 windowStart;
        (used, remaining, windowStart, resetsIn) = vault.getWindowState(user);
        assertEq(used, 0);
        assertEq(remaining, CAP);
        assertEq(windowStart, 0);
        assertEq(resetsIn, 0);
    }

    function test_windowState_exhausted() public {
        _withdraw(1 ether); // 10% of 10
        _withdraw(1.8 ether); // 20% of 9

        (uint256 used, uint256 remaining,,) = vault.getWindowState(user);
        assertEq(used, CAP);
        assertEq(remaining, 0);
    }

    /*//////////////////////////////////////////////////////////////
                    INSTANT LIMIT RESPECTS RULE 3
    //////////////////////////////////////////////////////////////*/

    function test_instantLimit_cappedByWindow() public {
        _withdraw(1 ether); // 10%, balance now 9

        // Rule 1 alone would allow 5.4 ether, Rule 3 only 20% of 9
        assertEq(vault.getInstantWithdrawLimit(user), 1.8 ether);
        (, uint256 limit,,,,,) = vault.getUserState(user);
        assertEq(limit, 1.8 ether);
    }

    function test_instantLimit_isExactRule3Boundary() public {
        _withdraw(1 ether);
        uint256 limit = vault.getInstantWithdrawLimit(user);

        uint256 snapshot = vm.snapshotState();

        _withdraw(limit + 1);
        assertTrue(vault.hasPendingWithdraw(user));

        vm.revertToState(snapshot);

        _withdraw(limit);
        assertFalse(vault.hasPendingWithdraw(user));
        assertEq(vault.getInstantWithdrawLimit(user), 0);
    }

    function test_instantLimit_restoredAfterWindowExpires() public {
        _withdraw(1 ether);
        _withdraw(1.8 ether);
        assertEq(vault.getInstantWithdrawLimit(user), 0);

        vm.warp(block.timestamp + vault.WINDOW_DURATION_FOR_MAX_WITHDRAW() + 1);

        // Back to Rule 1 only: 60% of 7.2
        assertEq(vault.getInstantWithdrawLimit(user), 4.32 ether);
    }

    /*//////////////////////////////////////////////////////////////
                            WAD PRECISION
    //////////////////////////////////////////////////////////////*/

    // 1.89 ether of 9 is exactly 21%: 10% + 21% = 31% > 30%
    // Whole percents counted it as 21 too, but 1.889 ether (20.99%) was floored to 20 and passed
    function test_fractionalPercent_isNotRoundedDown() public {
        _withdraw(1 ether);

        _withdraw(1.889 ether); // 20.99% of 9

        assertTrue(vault.hasPendingWithdraw(user));
    }

    function test_executedDelayedWithdraw_countsExactShare() public {
        _withdraw(8 ether); // 80%, delayed by Rule 1
        assertTrue(vault.hasPendingWithdraw(user));

        vm.warp(block.timestamp + vault.DELAY());
        vm.prank(user);
        vault.executeWithdraw();

        (uint256 used, uint256 remaining,,) = vault.getWindowState(user);
        assertEq(used, 0.8e18);
        assertEq(remaining, 0);
        assertEq(vault.getInstantWithdrawLimit(user), 0);
    }

    function testFuzz_instantLimit_neverDelayed(uint256 first, uint256 elapsed) public {
        // Non-probe first withdrawal (>= 5%) that passes Rule 1 so a window starts
        first = bound(first, 0.5 ether, 6 ether);
        elapsed = bound(elapsed, 0, 4 days);

        _withdraw(first);
        vm.warp(block.timestamp + elapsed);

        uint256 limit = vault.getInstantWithdrawLimit(user);
        vm.assume(limit > 0);

        _withdraw(limit);
        assertFalse(vault.hasPendingWithdraw(user));
    }
}
