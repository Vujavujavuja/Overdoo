// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CapitalPool} from "../src/CapitalPool.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {FlightOracle} from "../src/FlightOracle.sol";
import {Settlement} from "../src/Settlement.sol";

/// @notice End-to-end: attest a flight, buy the claim, settle the outcome.
///         Amounts mirror the demo scale (EUR 1 = 0.0001 MON).
contract SettlementTest is Test {
    CapitalPool pool;
    ClaimRegistry registry;
    FlightOracle oracle;
    Settlement settlement;

    uint256 pkA = 0xA11CE;
    uint256 pkB = 0xB0B;

    address owner = makeAddr("owner");
    address ops = makeAddr("ops");
    address lp = makeAddr("lp");
    address passenger = makeAddr("passenger");

    bytes32 flightKey = keccak256(abi.encodePacked("LH", "1411", uint64(1700000000)));
    bytes32 assignmentHash = keccak256("ASSIGNMENT OF STATUTORY CLAIM ...");

    uint256 constant STATUTORY = 0.04 ether; // EUR 400
    uint256 constant PRICE = 0.0289 ether; // EUR 289

    function setUp() public {
        oracle = new FlightOracle(owner);
        pool = new CapitalPool(owner);
        registry = new ClaimRegistry(owner);
        settlement = new Settlement(pool, registry, oracle, owner);

        vm.startPrank(owner);
        pool.setSettlement(address(settlement));
        registry.setRoles(address(settlement), ops);
        settlement.setOps(ops);
        oracle.setAttestor(vm.addr(pkA), true);
        oracle.setAttestor(vm.addr(pkB), true);
        vm.stopPrank();

        vm.deal(lp, 10 ether);
        vm.deal(ops, 10 ether);

        vm.prank(lp);
        pool.deposit{value: 5 ether}();
    }

    function _attest() internal {
        FlightOracle.Attestation memory a = FlightOracle.Attestation({
            flightKey: flightKey,
            scheduledArrival: 1700010000,
            actualArrival: 1700024400,
            delayMinutes: 240,
            status: 1,
            distanceKm: 1800,
            attestedAt: uint64(block.timestamp)
        });

        (uint256 lo, uint256 hi) = vm.addr(pkA) < vm.addr(pkB) ? (pkA, pkB) : (pkB, pkA);
        bytes32 digest = oracle.hashAttestation(a);

        bytes[] memory sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(lo, digest);
        sigs[0] = abi.encodePacked(r1, s1, v1);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(hi, digest);
        sigs[1] = abi.encodePacked(r2, s2, v2);

        oracle.attest(a, sigs);
    }

    function _purchase() internal returns (uint256 claimId) {
        _attest();
        vm.prank(ops);
        claimId = settlement.purchaseClaim(flightKey, passenger, STATUTORY, PRICE, assignmentHash);
    }

    /// @dev No attestation, no purchase. Capital cannot move on unverified data.
    function test_purchaseRevertsWithoutAttestation() public {
        vm.prank(ops);
        vm.expectRevert(abi.encodeWithSelector(Settlement.FlightNotAttested.selector, flightKey));
        settlement.purchaseClaim(flightKey, passenger, STATUTORY, PRICE, assignmentHash);
    }

    function test_purchasePaysPassengerInMonAndDeploysCapital() public {
        uint256 before = passenger.balance;
        uint256 claimId = _purchase();

        // The passenger's native MON balance rises: no token to add to a wallet.
        assertEq(passenger.balance, before + PRICE);
        assertEq(pool.deployed(), PRICE);
        assertEq(pool.idle(), 5 ether - PRICE);
        assertEq(pool.totalAssets(), 5 ether);
        assertEq(pool.sharePrice(), 1e18);

        ClaimRegistry.Claim memory c = registry.getClaim(claimId);
        assertEq(c.passenger, passenger);
        assertEq(c.statutoryAmount, STATUTORY);
        assertEq(c.purchasePrice, PRICE);
        assertEq(c.assignmentHash, assignmentHash);
        assertEq(uint8(c.status), uint8(ClaimRegistry.Status.Purchased));
    }

    function test_doublePurchaseReverts() public {
        _purchase();
        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(ClaimRegistry.AlreadyAssigned.selector, flightKey, passenger)
        );
        settlement.purchaseClaim(flightKey, passenger, STATUTORY, PRICE, assignmentHash);
    }

    function test_onlyOpsCanPurchase() public {
        _attest();
        vm.prank(passenger);
        vm.expectRevert(Settlement.NotOps.selector);
        settlement.purchaseClaim(flightKey, passenger, STATUTORY, PRICE, assignmentHash);
    }

    function test_fullRecoveryRaisesSharePrice() public {
        uint256 claimId = _purchase();

        vm.prank(ops);
        settlement.settleRecovery{value: STATUTORY}(claimId, STATUTORY);

        assertEq(pool.deployed(), 0);
        assertEq(pool.totalAssets(), 5 ether + (STATUTORY - PRICE));
        assertGt(pool.sharePrice(), 1e18);
        assertEq(uint8(registry.getClaim(claimId).status), uint8(ClaimRegistry.Status.Recovered));
    }

    function test_writeOffLowersSharePrice() public {
        uint256 claimId = _purchase();

        vm.prank(ops);
        settlement.settleWriteOff(claimId);

        assertEq(pool.deployed(), 0);
        assertEq(pool.totalAssets(), 5 ether - PRICE);
        assertLt(pool.sharePrice(), 1e18);
        assertEq(uint8(registry.getClaim(claimId).status), uint8(ClaimRegistry.Status.WrittenOff));
    }

    /// @dev Partial recovery repays what came in and writes off the shortfall, so
    ///      `deployed` returns to zero either way.
    function test_partialRecoverySplitsRepayAndWriteOff() public {
        uint256 claimId = _purchase();
        uint256 got = 0.01 ether;

        vm.prank(ops);
        settlement.settleRecovery{value: got}(claimId, got);

        assertEq(pool.deployed(), 0);
        assertEq(pool.totalAssets(), 5 ether - (PRICE - got));
        assertLt(pool.sharePrice(), 1e18);
    }

    function test_pursuitFlow() public {
        uint256 claimId = _purchase();

        vm.prank(ops);
        registry.markInPursuit(claimId);
        assertEq(uint8(registry.getClaim(claimId).status), uint8(ClaimRegistry.Status.InPursuit));

        vm.prank(ops);
        settlement.settleRecovery{value: STATUTORY}(claimId, STATUTORY);
        assertEq(uint8(registry.getClaim(claimId).status), uint8(ClaimRegistry.Status.Recovered));
    }

    function test_cannotSettleTwice() public {
        uint256 claimId = _purchase();
        vm.prank(ops);
        settlement.settleRecovery{value: STATUTORY}(claimId, STATUTORY);

        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(
                Settlement.BadStatus.selector, uint8(ClaimRegistry.Status.Recovered)
            )
        );
        settlement.settleWriteOff(claimId);
    }

    function test_statsTrackOutcomes() public {
        uint256 claimId = _purchase();
        vm.prank(ops);
        settlement.settleRecovery{value: STATUTORY}(claimId, STATUTORY);

        (uint256 total, uint256 recovered, uint256 written, uint256 outstanding) = registry.stats();
        assertEq(total, 1);
        assertEq(recovered, 1);
        assertEq(written, 0);
        assertEq(outstanding, 0);
    }
}
