// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";
import {MockERC20} from "./Watcher.t.sol";

/**
 * @title Watcher Rule 2 (probe detection) tests
 * @notice Covers sub-1% probes, probe expiry after PROBE_DETECTION_WINDOW, and probe persistence across cancel.
 */
contract WatcherProbeTest is Test {
    Watcher vault;
    MockERC20 mockToken;

    address user = makeAddr("user");

    uint256 constant INITIAL_BALANCE = 10 ether;

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

    // 0.001 ETH of 10 ETH is 0.01% — previously truncated to 0% and never detected
    function test_tinyProbe_isDetected() public {
        vm.prank(user);
        vault.withdraw(address(mockToken), 0.001 ether);

        assertFalse(vault.hasPendingWithdraw(user, address(mockToken)));
        assertEq(vault.lastProbeTime(user, address(mockToken)), block.timestamp);
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 0);

        (, uint256 instantLimit,,,,,) = vault.getUserState(user, address(mockToken));
        assertEq(instantLimit, 0);

        // 1 ETH (~10%) would pass Rules 1 and 3, so only Rule 2 can flag it
        vm.prank(user);
        vault.withdraw(address(mockToken), 1 ether);

        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));
    }

    function test_probe_expiresAfterWindow() public {
        vm.prank(user);
        vault.withdraw(address(mockToken), 0.001 ether);

        uint256 probeTime = vault.lastProbeTime(user, address(mockToken));

        // Still active at the exact window boundary
        vm.warp(probeTime + vault.PROBE_DETECTION_WINDOW());
        assertEq(vault.getInstantWithdrawLimit(user, address(mockToken)), 0);

        vm.warp(probeTime + vault.PROBE_DETECTION_WINDOW() + 1);
        assertEq(
            vault.getInstantWithdrawLimit(user, address(mockToken)),
            (vault.balances(user, address(mockToken)) * 60) / 100
        );

        vm.prank(user);
        vault.withdraw(address(mockToken), 1 ether);

        assertFalse(vault.hasPendingWithdraw(user, address(mockToken)));
        // Non-probe execution clears the probe
        assertEq(vault.lastProbeTime(user, address(mockToken)), 0);
    }

    function test_probe_flagged_cancel_stillFlagged() public {
        vm.prank(user);
        vault.withdraw(address(mockToken), 0.001 ether);
        uint256 probeTime = vault.lastProbeTime(user, address(mockToken));

        vm.prank(user);
        vault.withdraw(address(mockToken), 1 ether);
        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));
        // Queueing does not write lastProbeTime
        assertEq(vault.lastProbeTime(user, address(mockToken)), probeTime);

        vm.prank(user);
        vault.cancelWithdraw(address(mockToken));
        assertFalse(vault.hasPendingWithdraw(user, address(mockToken)));
        assertEq(vault.lastProbeTime(user, address(mockToken)), probeTime);

        vm.prank(user);
        vault.withdraw(address(mockToken), 1 ether);
        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));
    }

    function test_executedProbeViaQueue_setsProbeTime() public {
        // First probe arms Rule 2, so a second probe gets queued
        vm.prank(user);
        vault.withdraw(address(mockToken), 0.001 ether);

        vm.prank(user);
        vault.withdraw(address(mockToken), 0.002 ether);
        assertTrue(vault.hasPendingWithdraw(user, address(mockToken)));

        vm.warp(block.timestamp + vault.RISKY_WITHDRAWAL_DELAY());
        vm.prank(user);
        vault.executeWithdraw(address(mockToken));

        assertEq(vault.lastProbeTime(user, address(mockToken)), block.timestamp);
    }
}
