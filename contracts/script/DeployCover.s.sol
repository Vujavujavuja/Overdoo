// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DelayCover} from "../src/DelayCover.sol";
import {FlightOracle} from "../src/FlightOracle.sol";

contract DeployCover is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddr = vm.envAddress("FLIGHT_ORACLE");
        uint256 seed = vm.envUint("COVER_SEED_WEI");

        vm.startBroadcast(pk);
        DelayCover cover = new DelayCover(FlightOracle(oracleAddr), vm.addr(pk));
        // Fund reserves so the contract can actually honour what it sells.
        (bool ok, ) = address(cover).call{value: seed}("");
        require(ok, "seed failed");
        vm.stopBroadcast();

        console.log("DelayCover", address(cover));
        console.log("reserves  ", address(cover).balance);
    }
}
