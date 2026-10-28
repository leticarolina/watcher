// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Watcher} from "../src/Watcher.sol";

/**
 * @title Watcher two-slot Trusted Recovery Address tests
 * @notice Covers adding a backup in slot 1, replacing each slot, duplicate rejection,
 * withdrawToSafe destination checks, and safe address changes during emergency lock.
 */
contract WatcherSafeSlotsTest is Test {
    Watcher vault;

    address user = makeAddr("user");
    address primary = makeAddr("primary");
    address backup = makeAddr("backup");
    address replacement = makeAddr("replacement");
    address stranger = makeAddr("stranger");

    uint256 constant INITIAL_BALANCE = 10 ether;

    function setUp() public {
        vault = new Watcher();
        vm.deal(user, INITIAL_BALANCE);

        vm.startPrank(user);
        vault.deposit{value: 1 ether}();
        vault.setSafeAddress(primary);
        vm.stopPrank();
    }

    function _changeSlot(uint8 slot, address newSafe) internal {
        vm.prank(user);
        vault.requestSafeAddressChange(slot, newSafe);

        vm.warp(block.timestamp + vault.SAFE_ADDRESS_CHANGE_DELAY());

        vm.prank(user);
        vault.confirmSafeAddressChange();
    }

    function test_addBackup_toSlot1() public {
        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit Watcher.SafeAddressChangeRequested(user, address(0), backup, 1, block.timestamp + 24 hours);
        vault.requestSafeAddressChange(1, backup);

        (address pendingSafe, uint8 slot, uint256 remaining) = vault.getPendingSafeChange(user);
        assertEq(pendingSafe, backup);
        assertEq(slot, 1);
        assertEq(remaining, 24 hours);

        vm.warp(block.timestamp + 24 hours);

        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Watcher.SafeAddressChangeConfirmed(user, backup, 1);
        vault.confirmSafeAddressChange();

        address[2] memory slots = vault.getSafeAddresses(user);
        assertEq(slots[0], primary);
        assertEq(slots[1], backup);

        // Backup is a valid withdrawToSafe destination
        vm.prank(user);
        vault.withdrawToSafe(backup, 0.1 ether);
        assertEq(backup.balance, 0.1 ether);
    }

    function test_replaceSlot0_keepsBackup() public {
        _changeSlot(1, backup);
        _changeSlot(0, replacement);

        address[2] memory slots = vault.getSafeAddresses(user);
        assertEq(slots[0], replacement);
        assertEq(slots[1], backup);

        // Old primary is no longer a valid destination
        vm.prank(user);
        vm.expectRevert(Watcher.SafeAddressNotRegistered.selector);
        vault.withdrawToSafe(primary, 0.1 ether);
    }

    function test_replaceSlot1_keepsPrimary() public {
        _changeSlot(1, backup);
        _changeSlot(1, replacement);

        address[2] memory slots = vault.getSafeAddresses(user);
        assertEq(slots[0], primary);
        assertEq(slots[1], replacement);

        vm.prank(user);
        vm.expectRevert(Watcher.SafeAddressNotRegistered.selector);
        vault.withdrawToSafe(backup, 0.1 ether);
    }

    function test_requestSafeAddressChange_rejectsDuplicate() public {
        // Slot 0 address cannot be added as backup
        vm.prank(user);
        vm.expectRevert(Watcher.SafeAddressAlreadySet.selector);
        vault.requestSafeAddressChange(1, primary);

        _changeSlot(1, backup);

        // Slot 1 address cannot be written into slot 0
        vm.prank(user);
        vm.expectRevert(Watcher.SafeAddressAlreadySet.selector);
        vault.requestSafeAddressChange(0, backup);
    }

    function test_requestSafeAddressChange_rejectsInvalidSlotAndAddress() public {
        vm.startPrank(user);

        vm.expectRevert(Watcher.InvalidSafeSlot.selector);
        vault.requestSafeAddressChange(2, backup);

        // No removal: address(0) is never a valid new address
        vm.expectRevert(Watcher.InvalidSafeAddress.selector);
        vault.requestSafeAddressChange(1, address(0));

        vm.expectRevert(Watcher.InvalidSafeAddress.selector);
        vault.requestSafeAddressChange(1, user);

        vm.stopPrank();
    }

    function test_requestSafeAddressChange_revertsIfSlot0Empty() public {
        address fresh = makeAddr("fresh");

        vm.prank(fresh);
        vm.expectRevert(Watcher.SafeAddressNotSet.selector);
        vault.requestSafeAddressChange(1, backup);
    }

    function test_withdrawToSafe_rejectsZeroAddress() public {
        vm.prank(user);
        vm.expectRevert(Watcher.InvalidSafeAddress.selector);
        vault.withdrawToSafe(address(0), 0.1 ether);
    }

    function test_withdrawToSafe_rejectsZeroAddress_whenNoSafeSet() public {
        // Empty slots hold address(0); it must never match as a destination
        address fresh = makeAddr("fresh");
        vm.deal(fresh, 1 ether);

        vm.startPrank(fresh);
        vault.deposit{value: 1 ether}();

        vm.expectRevert(Watcher.InvalidSafeAddress.selector);
        vault.withdrawToSafe(address(0), 0.1 ether);

        vm.stopPrank();
    }

    function test_withdrawToSafe_rejectsUnregisteredAddress() public {
        vm.prank(user);
        vm.expectRevert(Watcher.SafeAddressNotRegistered.selector);
        vault.withdrawToSafe(stranger, 0.1 ether);

        assertEq(stranger.balance, 0);
        assertEq(vault.balances(user), 1 ether);
    }

    function test_setSafeAddress_revertsOnceSlot0Set() public {
        vm.prank(user);
        vm.expectRevert(Watcher.SafeAddressAlreadySet.selector);
        vault.setSafeAddress(backup);

        assertEq(vault.getSafeAddresses(user)[0], primary);
    }

    function test_emergencyLock_blocksRequestAndConfirm_butNotCancel() public {
        vm.prank(user);
        vault.requestSafeAddressChange(1, backup);

        vm.prank(user);
        vault.emergencyLock(2 days);

        // New request blocked
        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.requestSafeAddressChange(0, replacement);

        // Confirm blocked even after the 24h change delay has passed
        vm.warp(block.timestamp + 24 hours);
        vm.prank(user);
        vm.expectRevert(Watcher.EmergencyLockOngoing.selector);
        vault.confirmSafeAddressChange();

        // Cancel still works
        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Watcher.SafeAddressChangeCancelled(user, backup);
        vault.cancelSafeAddressChange();

        (address pendingSafe, uint8 slot, uint256 remaining) = vault.getPendingSafeChange(user);
        assertEq(pendingSafe, address(0));
        assertEq(slot, 0);
        assertEq(remaining, 0);

        address[2] memory slots = vault.getSafeAddresses(user);
        assertEq(slots[0], primary);
        assertEq(slots[1], address(0));
    }
}
