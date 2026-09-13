// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";

/**
 * @title Watcher Integration Tests
 * @notice Integration tests simulate realistic end-to-end attack and user scenarios
 * across multiple contract interactions. Unlike unit tests which test individual
 * functions in isolation, these tests verify that the full system behaves correctly
 * when functions are composed together in real-world sequences.
 */
contract WatcherIntegrationTest is Test {
    Watcher vault;

    // Actors
    address user = makeAddr("user");
    address attacker = makeAddr("attacker");
    address safeWallet = makeAddr("safeWallet");
    address attackerWallet = makeAddr("attackerWallet");

    uint256 constant INITIAL_BALANCE = 10 ether;

    function setUp() public {
        vault = new Watcher();
        vm.deal(user, INITIAL_BALANCE);
        vm.deal(attacker, INITIAL_BALANCE);
    }

    /*
    ============================================================
        SCENARIO 1: FULL ATTACK — PROBE + LARGE DRAIN ATTEMPT

        Attack sequence:
        1. Attacker compromises user's key
        2. Attacker sends a small probe withdrawal to test access
        3. Attacker attempts large drain — flagged by Rule 2
        4. User detects the pending suspicious withdrawal
        5. User cancels the pending withdrawal
        6. User activates emergency lock
        7. User waits for lock, then withdraws everything to safe address

        Expected outcome: attacker gets nothing, user recovers all funds
    ============================================================
    */
    function test_integration_fullAttackScenario() public {
        // --- SETUP ---
        // User deposits and registers safe address while keys are still secure
        vm.startPrank(user);
        vault.deposit{value: 5 ether}();
        vault.setSafeAddress(safeWallet);
        vm.stopPrank();

        assertEq(vault.balances(user), 5 ether);
        assertEq(vault.safeAddress(user), safeWallet);

        // --- ATTACK BEGINS ---
        // Attacker now has user's key. Sends small probe first (4% of balance).
        vm.prank(user); // attacker is using user's compromised key
        vault.withdraw(0.2 ether); // 4% of 5 ETH

        // Probe executes instantly — Rule 2 arms
        assertFalse(vault.hasPendingWithdraw(user));
        assertEq(vault.lastWithdrawPercent(user), 4);

        // Attacker now attempts large drain — any amount triggers Rule 2
        vm.prank(user);
        vault.withdraw(3 ether); // flagged by Rule 2

        // Large drain is now pending, NOT executed
        assertTrue(vault.hasPendingWithdraw(user));
        (uint256 pendingAmount,,) = vault.getPendingWithdraw(user);
        assertEq(pendingAmount, 3 ether);

        // Funds are deducted from balance but sitting in pending — not sent yet
        assertEq(vault.balances(user), 1.8 ether); // 5 - 0.2 - 3

        // --- USER DETECTS AND RESPONDS ---
        // User notices the suspicious pending withdrawal and cancels it
        vm.prank(user);
        vault.cancelWithdraw();

        // Funds restored to vault
        assertFalse(vault.hasPendingWithdraw(user));
        assertEq(vault.balances(user), 4.8 ether); // 5 - 0.2 probe

        // User activates emergency lock to buy time
        vm.prank(user);
        vault.emergencyLock(24 hours);

        assertTrue(vault.isVaultLocked(user));

        // Attacker tries to withdraw again while locked — blocked
        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.withdraw(4 ether);

        // Attacker tries to change safe address while locked — blocked
        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.requestSafeAddressChange(attackerWallet);

        // --- USER RECOVERS FUNDS ---
        // Lock expires, user immediately withdraws to safe address
        vm.warp(vault.lockedUntil(user));
        assertFalse(vault.isVaultLocked(user));

        uint256 safeBalanceBefore = safeWallet.balance;

        vm.prank(user);
        vault.withdrawToSafe(4.8 ether);

        // All remaining funds sent to safe wallet — attacker got nothing beyond the probe
        assertEq(vault.balances(user), 0);
        assertEq(safeWallet.balance, safeBalanceBefore + 4.8 ether);

        // Attacker only got the 0.2 ETH probe — 96% of funds saved
    }

    /*
    ============================================================
        SCENARIO 2: SAFE ADDRESS HIJACK ATTEMPT

        Attack sequence:
        1. User has funds in vault with safe address registered
        2. Attacker compromises key and immediately requests safe address change
        3. User detects the pending safe address change
        4. User cancels the pending change
        5. User locks vault and withdraws to original safe address

        Expected outcome: safe address never changes, funds reach original safe wallet
    ============================================================
    */
    function test_integration_safeAddressHijackAttempt() public {
        // --- SETUP ---
        vm.startPrank(user);
        vault.deposit{value: 3 ether}();
        vault.setSafeAddress(safeWallet);
        vm.stopPrank();

        assertEq(vault.safeAddress(user), safeWallet);

        // --- ATTACK BEGINS ---
        // Attacker compromises key and immediately tries to reroute safe address
        vm.prank(user); // attacker using compromised key
        vault.requestSafeAddressChange(attackerWallet);

        // Change is pending — not yet active
        (address pendingSafe,) = vault.getPendingSafeChange(user);
        assertEq(pendingSafe, attackerWallet);
        assertEq(vault.safeAddress(user), safeWallet); // still original

        // Attacker waits... but user detects within the 24h window

        // --- USER DETECTS AND CANCELS ---
        vm.prank(user);
        vault.cancelSafeAddressChange();

        // Pending change cleared, safe address unchanged
        (address pendingSafeAfter,) = vault.getPendingSafeChange(user);
        assertEq(pendingSafeAfter, address(0));
        assertEq(vault.safeAddress(user), safeWallet);

        // User locks vault for safety
        vm.prank(user);
        vault.emergencyLock(24 hours);

        // Attacker tries to request safe address change again — blocked by lock
        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.requestSafeAddressChange(attackerWallet);

        // --- USER RECOVERS ---
        vm.warp(vault.lockedUntil(user));

        uint256 safeBalanceBefore = safeWallet.balance;
        uint256 attackerWalletBefore = attackerWallet.balance;

        vm.prank(user);
        vault.withdrawToSafe(3 ether);

        // Funds went to legitimate safe wallet, attacker wallet untouched
        assertEq(safeWallet.balance, safeBalanceBefore + 3 ether);
        assertEq(attackerWallet.balance, attackerWalletBefore);
        assertEq(vault.balances(user), 0);
    }

    /*
    ============================================================
        SCENARIO 3: LOCK BYPASS VIA SAFE ADDRESS CHANGE

        Attack sequence:
        1. User detects threat and activates emergency lock
        2. Attacker (with compromised key) tries to queue safe address change during lock
        3. Blocked — requestSafeAddressChange reverts during lock
        4. Attacker waits for lock to expire, tries again immediately
        5. User extends the lock before attacker can act
        6. User eventually recovers funds to safe address

        Expected outcome: safe address change never queued during lock,
        user successfully extends lock and recovers funds
    ============================================================
    */
    function test_integration_lockBypassAttempt() public {
        // --- SETUP ---
        vm.startPrank(user);
        vault.deposit{value: 4 ether}();
        vault.setSafeAddress(safeWallet);
        vm.stopPrank();

        // --- USER DETECTS THREAT AND LOCKS ---
        vm.prank(user);
        vault.emergencyLock(24 hours);

        assertTrue(vault.isVaultLocked(user));
        uint256 lockExpiry = vault.lockedUntil(user);

        // --- ATTACKER TRIES TO QUEUE SAFE ADDRESS CHANGE DURING LOCK ---
        vm.prank(user); // attacker using compromised key
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.requestSafeAddressChange(attackerWallet);

        // Attacker tries to withdraw during lock — blocked
        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.withdraw(4 ether);

        // Attacker tries to shorten lock — blocked
        vm.warp(block.timestamp + 1 hours);
        vm.prank(user);
        vm.expectRevert(Watcher.LockNotExtended.selector);
        vault.emergencyLock(1 hours); // would expire sooner than current lock

        // Safe address still unchanged, no pending change
        assertEq(vault.safeAddress(user), safeWallet);
        (address pendingSafe,) = vault.getPendingSafeChange(user);
        assertEq(pendingSafe, address(0));

        // --- USER EXTENDS LOCK FOR EXTRA SAFETY ---
        // User realizes attacker is persistent and extends lock
        vm.prank(user);
        vault.emergencyLock(48 hours); // push expiry further out

        assertGt(vault.lockedUntil(user), lockExpiry); // extended beyond original

        // --- ATTACKER TRIES AGAIN AT ORIGINAL EXPIRY — STILL LOCKED ---
        vm.warp(lockExpiry);
        assertTrue(vault.isVaultLocked(user)); // still locked due to extension

        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.requestSafeAddressChange(attackerWallet);

        // --- USER RECOVERS AT EXTENDED EXPIRY ---
        vm.warp(vault.lockedUntil(user));
        assertFalse(vault.isVaultLocked(user));

        uint256 safeBalanceBefore = safeWallet.balance;

        vm.prank(user);
        vault.withdrawToSafe(4 ether);

        assertEq(safeWallet.balance, safeBalanceBefore + 4 ether);
        assertEq(vault.balances(user), 0);
        assertEq(attackerWallet.balance, 0); // attacker got nothing
    }
}
