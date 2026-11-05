// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";
import {MockERC20} from "./Watcher.t.sol";

/**
 * @title Watcher Rule 3 (cumulative window) tests
 * @notice Covers getWindowState expiry handling, instant limit respecting Rule 3, and WAD
 * precision so fractional percentages are no longer rounded down.
 */
contract WatcherWindowTest is Test {
    Watcher vault;
    MockERC20 mockToken;

    address user = makeAddr("user");

    uint256 constant INITIAL_BALANCE = 10 ether;
    uint256 constant CAP = 0.3e18; // MAX_CUMULATIVE_WITHDRAW_WAD

    function setUp() public {
        mockToken = new MockERC20();
        address[] memory tokens = new address[](1);
        tokens[0] = address(mockToken);
        vault = new Watcher(tokens);
        _fund(user, INITIAL_BALANCE);

        vm.prank(user);
        vault.deposit(address(mockToken), INITIAL_BALANCE);
    }

    // Replaces vm.deal: mints tokens and pre-approves the vault so deposits work inside startPrank
    function _fund(address account, uint256 amount) internal {
        mockToken.mint(account, amount);
        vm.prank(account);
        mockToken.approve(address(vault), type(uint256).max);
    }

    function _withdraw(uint256 amount) internal {
        vm.prank(user);
        vault.withdraw(address(mockToken), amount);
    }

    /*//////////////////////////////////////////////////////////////
                            getWindowState
    //////////////////////////////////////////////////////////////*/

    function test_windowState_freshUser() public view {
        (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetsIn) =
            vault.getWindowState(user, address(mockToken));

        assertEq(used, 0);
        assertEq(remaining, CAP);
        assertEq(windowStart, 0);
        assertEq(resetsIn, 0);
    }

    function test_windowState_afterWithdraw() public {
        _withdraw(1 ether); // 10%

        (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetsIn) =
            vault.getWindowState(user, address(mockToken));

        assertEq(used, 0.1e18);
        assertEq(remaining, 0.2e18);
        assertEq(windowStart, block.timestamp);
        assertEq(resetsIn, vault.CUMULATIVE_WITHDRAW_WINDOW_DURATION() + 1);
    }

    function test_windowState_expiryIsApplied() public {
        _withdraw(1 ether);
        uint256 start = block.timestamp;

        // Still active at the exact window boundary
        vm.warp(start + vault.CUMULATIVE_WITHDRAW_WINDOW_DURATION());
        (uint256 used,,, uint256 resetsIn) = vault.getWindowState(user, address(mockToken));
        assertEq(used, 0.1e18);
        assertEq(resetsIn, 1);

        // Expired: reports a clean window although storage was not reset yet
        vm.warp(start + vault.CUMULATIVE_WITHDRAW_WINDOW_DURATION() + 1);
        uint256 remaining;
        uint256 windowStart;
        (used, remaining, windowStart, resetsIn) = vault.getWindowState(user, address(mockToken));
        assertEq(used, 0);
        assertEq(remaining, CAP);
        assertEq(windowStart, 0);
        assertEq(resetsIn, 0);
    }

    function test_windowState_exhausted() public {
        _withdraw(1 ether); // 10% of 10
        _withdraw(1.8 ether); // 20% of 9

        (uint256 used, uint256 remaining,,) = vault.getWindowState(user, address(mockToken));
        assertEq(used, CAP);
        assertEq(remaining, 0);
    }

    /*//////////////////////////////////////////////////////////////
                    INSTANT LIMIT RESPECTS RULE 3
    //////////////////////////////////////////////////////////////*/

    function test_instantLimit_cappedByWindow() public {
        _withdraw(1 ether); // 10%, balance now 9

        // Rule 1 alone would allow 5.4 ether, Rule 3 only 20% of 9
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 1.8 ether);
        (, uint256 limit,,,,,) = vault.getUserState(user, address(mockToken));
        assertEq(limit, 1.8 ether);
    }

    function test_instantLimit_isExactRule3Boundary() public {
        _withdraw(1 ether);
        uint256 limit = vault.getInstantWithdrawLimit(user, address(mockToken));

        uint256 snapshot = vm.snapshotState();

        _withdraw(limit + 1);
        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));

        vm.revertToState(snapshot);

        _withdraw(limit);
        assertFalse(vault.hasPendingWithdraw(user, address(mockToken)));
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 0);
    }

    function test_instantLimit_restoredAfterWindowExpires() public {
        _withdraw(1 ether);
        _withdraw(1.8 ether);
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 0);

        vm.warp(block.timestamp + vault.CUMULATIVE_WITHDRAW_WINDOW_DURATION() + 1);

        // Back to Rule 1 only: 60% of 7.2
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 4.32 ether);
    }

    /*//////////////////////////////////////////////////////////////
                            WAD PRECISION
    //////////////////////////////////////////////////////////////*/

    // 1.89 ether of 9 is exactly 21%: 10% + 21% = 31% > 30%
    // Whole percents counted it as 21 too, but 1.889 ether (20.99%) was floored to 20 and passed
    function test_fractionalPercent_isNotRoundedDown() public {
        _withdraw(1 ether);

        _withdraw(1.889 ether); // 20.99% of 9

        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));
    }

    function test_executedDelayedWithdraw_countsExactShare() public {
        _withdraw(8 ether); // 80%, delayed by Rule 1
        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));

        vm.warp(block.timestamp + vault.RISKY_WITHDRAWAL_DELAY());
        vm.prank(user);
        vault.executeWithdraw(address(mockToken));

        (uint256 used, uint256 remaining,,) = vault.getWindowState(user, address(mockToken));
        assertEq(used, 0.8e18);
        assertEq(remaining, 0);
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 0);
    }

    function testFuzz_instantLimit_neverDelayed(uint256 first, uint256 elapsed) public {
        // Non-probe first withdrawal (>= 5%) that passes Rule 1 so a window starts
        first = bound(first, 0.5 ether, 6 ether);
        elapsed = bound(elapsed, 0, 4 days);

        _withdraw(first);
        vm.warp(block.timestamp + elapsed);

        uint256 limit = vault.getInstantWithdrawLimit(user, address(mockToken));
        vm.assume(limit > 0);

        _withdraw(limit);
        assertFalse(vault.hasPendingWithdraw(user, address(mockToken)));
    }
}
