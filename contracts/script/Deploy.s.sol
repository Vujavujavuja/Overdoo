// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TipJar} from "../src/TipJar.sol";

contract Deploy is Script {
    function run() external returns (TipJar jar) {
        vm.startBroadcast();
        jar = new TipJar();
        vm.stopBroadcast();

        console.log("TipJar deployed to:", address(jar));
        console.log("Owner (receives all tips):", jar.owner());
        console.log("Explorer: https://testnet.monadvision.com/address/%s", address(jar));
    }
}
