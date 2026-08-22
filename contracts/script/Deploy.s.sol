// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FlightOracle} from "../src/FlightOracle.sol";
import {CapitalPool} from "../src/CapitalPool.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {Settlement} from "../src/Settlement.sol";

/// @notice Deploys the full Aeroclaim stack and wires the roles between them.
contract Deploy is Script {
    function run() external {
        address attestorA = vm.envAddress("ATTESTOR_A_ADDRESS");
        address attestorB = vm.envAddress("ATTESTOR_B_ADDRESS");

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        FlightOracle oracle = new FlightOracle(deployer);
        CapitalPool pool = new CapitalPool(deployer);
        ClaimRegistry registry = new ClaimRegistry(deployer);
        Settlement settlement = new Settlement(pool, registry, oracle, deployer);

        // Settlement is the only contract allowed to move capital or open claims.
        pool.setSettlement(address(settlement));
        registry.setRoles(address(settlement), deployer);
        settlement.setOps(deployer);

        // Two independent attestors, both required.
        oracle.setAttestor(attestorA, true);
        oracle.setAttestor(attestorB, true);
        oracle.setThreshold(2);

        vm.stopBroadcast();

        _writeDeployments(
            [address(oracle), address(pool), address(registry), address(settlement)],
            deployer,
            attestorA,
            attestorB
        );

        console.log("FlightOracle  ", address(oracle));
        console.log("CapitalPool   ", address(pool));
        console.log("ClaimRegistry ", address(registry));
        console.log("Settlement    ", address(settlement));
    }

    /// @dev Split out of run() because inlining every concat blows the EVM stack.
    function _writeDeployments(
        address[4] memory a,
        address ops,
        address attestorA,
        address attestorB
    ) internal {
        string memory head = string.concat(
            '{\n  "chainId": 10143,\n',
            '  "FlightOracle": "', vm.toString(a[0]), '",\n',
            '  "CapitalPool": "', vm.toString(a[1]), '",\n'
        );
        string memory tail = string.concat(
            '  "ClaimRegistry": "', vm.toString(a[2]), '",\n',
            '  "Settlement": "', vm.toString(a[3]), '",\n',
            '  "ops": "', vm.toString(ops), '",\n',
            '  "attestorA": "', vm.toString(attestorA), '",\n',
            '  "attestorB": "', vm.toString(attestorB), '"\n}\n'
        );
        vm.writeFile("../deployments.json", string.concat(head, tail));
    }
}
