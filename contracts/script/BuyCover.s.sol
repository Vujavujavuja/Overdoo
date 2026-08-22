// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DelayCover} from "../src/DelayCover.sol";

/// @notice Verification helper: buy a policy without a browser wallet.
contract BuyCover is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        DelayCover cover = DelayCover(payable(vm.envAddress("DELAY_COVER")));
        bytes32 flightKey = vm.envBytes32("FKEY");
        uint256 coverWei = vm.envUint("COVER_WEI");
        uint256 premiumWei = vm.envUint("PREMIUM_WEI");

        vm.startBroadcast(pk);
        uint256 id = cover.buy{value: premiumWei}(flightKey, coverWei);
        vm.stopBroadcast();

        console.log("policyId", id);
        console.log("holder  ", vm.addr(pk));
    }
}
