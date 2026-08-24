// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlightOracle} from "../src/FlightOracle.sol";

/// @notice Demo-only: only AeroDataBox reliably reports actual arrival times on
///         the free tiers available, so a 2-of-2 threshold can never be met.
///         Dropping to 1 makes the end-to-end payout demonstrable. The UI states
///         plainly that the flight is confirmed by a single source.
contract SetThreshold is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        FlightOracle oracle = FlightOracle(vm.envAddress("FLIGHT_ORACLE"));
        uint8 t = uint8(vm.envUint("THRESHOLD"));

        vm.startBroadcast(pk);
        oracle.setThreshold(t);
        vm.stopBroadcast();
        
        console.log("threshold now", oracle.threshold());
    }
}
