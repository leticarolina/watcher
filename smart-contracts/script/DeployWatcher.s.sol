// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {Watcher} from "../src/Watcher.sol";

contract DeployWatcher is Script {
    // Sepolia
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant USDC = 0xf08A50178dfcDe18524640EA6618a1f965821715;
    address constant WBTC = 0x92f3B59a79bFf5dc60c0d59eA13a44D082B2bdFC;

    function run() external {
        address[] memory initialTokens = new address[](3);
        initialTokens[0] = WETH;
        initialTokens[1] = USDC;
        initialTokens[2] = WBTC;

        vm.startBroadcast();
        Watcher vault = new Watcher(initialTokens); // Deploy contract
        vm.stopBroadcast();

        // Log deployed address
        console.log("Deployed at:", address(vault));
    }
}
