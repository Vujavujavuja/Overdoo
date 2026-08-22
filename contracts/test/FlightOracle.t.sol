// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlightOracle} from "../src/FlightOracle.sol";

contract FlightOracleTest is Test {
    FlightOracle oracle;

    uint256 pkA = 0xA11CE;
    uint256 pkB = 0xB0B;
    uint256 pkRogue = 0xBAD;
    address attestorA;
    address attestorB;
    address rogue;

    address owner = makeAddr("owner");
    bytes32 flightKey = keccak256(abi.encodePacked("LH", "1411", uint64(1700000000)));

    function setUp() public {
        attestorA = vm.addr(pkA);
        attestorB = vm.addr(pkB);
        rogue = vm.addr(pkRogue);

        oracle = new FlightOracle(owner);
        vm.startPrank(owner);
        oracle.setAttestor(attestorA, true);
        oracle.setAttestor(attestorB, true);
        vm.stopPrank();
    }

    function _attestation() internal view returns (FlightOracle.Attestation memory) {
        return FlightOracle.Attestation({
            flightKey: flightKey,
            scheduledArrival: 1700010000,
            actualArrival: 1700024400, // 4h late
            delayMinutes: 240,
            status: 1,
            distanceKm: 1200,
            attestedAt: uint64(block.timestamp)
        });
    }

    function _sign(uint256 pk, FlightOracle.Attestation memory a) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, oracle.hashAttestation(a));
        return abi.encodePacked(r, s, v);
    }

    /// @dev The contract requires ascending signer addresses to make duplicate
    ///      detection cheap, so tests must submit in that order too.
    function _sortedPair(uint256 p1, uint256 p2) internal pure returns (uint256, uint256) {
        return vm.addr(p1) < vm.addr(p2) ? (p1, p2) : (p2, p1);
    }

    function test_attestWithTwoValidSignatures() public {
        FlightOracle.Attestation memory a = _attestation();
        (uint256 lo, uint256 hi) = _sortedPair(pkA, pkB);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(lo, a);
        sigs[1] = _sign(hi, a);

        oracle.attest(a, sigs);

        assertTrue(oracle.isAttested(flightKey));
        assertEq(oracle.getAttestation(flightKey).delayMinutes, 240);
        assertEq(oracle.signersOf(flightKey).length, 2);
    }

    function test_revertsBelowThreshold() public {
        FlightOracle.Attestation memory a = _attestation();
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(pkA, a);

        vm.expectRevert(abi.encodeWithSelector(FlightOracle.NotEnoughSignatures.selector, 1, 2));
        oracle.attest(a, sigs);
    }

    /// @dev The attack that matters: one attestor signing twice to fake a quorum.
    function test_revertsOnDuplicateSigner() public {
        FlightOracle.Attestation memory a = _attestation();
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(pkA, a);
        sigs[1] = _sign(pkA, a);

        vm.expectRevert(FlightOracle.SignersNotSorted.selector);
        oracle.attest(a, sigs);
    }

    function test_revertsOnUnauthorisedSigner() public {
        FlightOracle.Attestation memory a = _attestation();
        (uint256 lo, uint256 hi) = _sortedPair(pkA, pkRogue);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(lo, a);
        sigs[1] = _sign(hi, a);

        vm.expectRevert(abi.encodeWithSelector(FlightOracle.UnauthorisedSigner.selector, rogue));
        oracle.attest(a, sigs);
    }

    function test_revertsOnDoubleAttestation() public {
        FlightOracle.Attestation memory a = _attestation();
        (uint256 lo, uint256 hi) = _sortedPair(pkA, pkB);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(lo, a);
        sigs[1] = _sign(hi, a);

        oracle.attest(a, sigs);
        vm.expectRevert(abi.encodeWithSelector(FlightOracle.AlreadyAttested.selector, flightKey));
        oracle.attest(a, sigs);
    }

    /// @dev A signature over different flight data must not validate.
    function test_signatureIsBoundToAttestationContents() public {
        FlightOracle.Attestation memory a = _attestation();
        (uint256 lo, uint256 hi) = _sortedPair(pkA, pkB);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(lo, a);
        sigs[1] = _sign(hi, a);

        a.delayMinutes = 999; // tamper after signing
        vm.expectRevert();
        oracle.attest(a, sigs);
    }

    function test_onlyOwnerCanSetAttestor() public {
        vm.expectRevert();
        oracle.setAttestor(rogue, true);
    }
}
