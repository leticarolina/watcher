// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";

/**
 * @title Watcher Rule 2 (probe detection) tests
 * @notice Covers sub-1% probes, probe expiry after PROBE_WINDOW, and probe persistence across cancel.
 */
contract WatcherProbeTest is Test {
    Watcher vault;

    address user = makeAddr("user");

    uint256 constant INITIAL_BALANCE = 10 ether;

    function setUp() public {
        vault = new Watcher();
        vm.deal(user, INITIAL_BALANCE);

        vm.prank(user);
        vault.deposit{value: INITIAL_BALANCE}();
    }

    // 0.001 ETH of 10 ETH is 0.01% — previously truncated to 0% and never detected
    function test_tinyProbe_isDetected() public {
        vm.prank(user);
        vault.withdraw(0.001 ether);

        assertFalse(vault.hasPendingWithdraw(user));
        assertEq(vault.lastProbeTime(user), block.timestamp);
        assertEq(vault.getInstantWithdrawLimit(user), 0);

        (, uint256 instantLimit, , , , , ) = vault.getUserState(user);
        assertEq(instantLimit, 0);

        // 1 ETH (~10%) would pass Rules 1 and 3, so only Rule 2 can flag it
        vm.prank(user);
        vault.withdraw(1 ether);

        assertTrue(vault.hasPendingWithdraw(user));
    }

    function test_probe_expiresAfterWindow() public {
        vm.prank(user);
        vault.withdraw(0.001 ether);

        uint256 probeTime = vault.lastProbeTime(user);

        // Still active at the exact window boundary
        vm.warp(probeTime + vault.PROBE_WINDOW());
        assertEq(vault.getInstantWithdrawLimit(user), 0);

        vm.warp(probeTime + vault.PROBE_WINDOW() + 1);
        assertEq(
            vault.getInstantWithdrawLimit(user),
            (vault.balances(user) * 60) / 100
        );

        vm.prank(user);
        vault.withdraw(1 ether);

        assertFalse(vault.hasPendingWithdraw(user));
        // Non-probe execution clears the probe
        assertEq(vault.lastProbeTime(user), 0);
    }

    function test_probe_flagged_cancel_stillFlagged() public {
        vm.prank(user);
        vault.withdraw(0.001 ether);
        uint256 probeTime = vault.lastProbeTime(user);

        vm.prank(user);
        vault.withdraw(1 ether);
        assertTrue(vault.hasPendingWithdraw(user));
        // Queueing does not write lastProbeTime
        assertEq(vault.lastProbeTime(user), probeTime);

        vm.prank(user);
        vault.cancelWithdraw();
        assertFalse(vault.hasPendingWithdraw(user));
        assertEq(vault.lastProbeTime(user), probeTime);

        vm.prank(user);
        vault.withdraw(1 ether);
        assertTrue(vault.hasPendingWithdraw(user));
    }

    function test_executedProbeViaQueue_setsProbeTime() public {
        // First probe arms Rule 2, so a second probe gets queued
        vm.prank(user);
        vault.withdraw(0.001 ether);

        vm.prank(user);
        vault.withdraw(0.002 ether);
        assertTrue(vault.hasPendingWithdraw(user));

        vm.warp(block.timestamp + vault.DELAY());
        vm.prank(user);
        vault.executeWithdraw();

        assertEq(vault.lastProbeTime(user), block.timestamp);
    }
}
