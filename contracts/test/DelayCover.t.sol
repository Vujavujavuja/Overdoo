// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DelayCover} from "../src/DelayCover.sol";
import {FlightOracle} from "../src/FlightOracle.sol";

contract DelayCoverTest is Test {
    DelayCover cover;
    FlightOracle oracle;

    uint256 pkA = 0xA11CE;
    uint256 pkB = 0xB0B;

    address owner = makeAddr("owner");
    address flyer = makeAddr("flyer");

    bytes32 flightKey = keccak256("LH1107-2026-08-21");
    uint256 constant COVER = 0.025 ether; // EUR 250 at demo scale

    function setUp() public {
        oracle = new FlightOracle(owner);
        cover = new DelayCover(oracle, owner);

        vm.startPrank(owner);
        oracle.setAttestor(vm.addr(pkA), true);
        oracle.setAttestor(vm.addr(pkB), true);
        vm.stopPrank();

        vm.deal(address(cover), 1 ether); // underwriter reserves
        vm.deal(flyer, 1 ether);
    }

    function _attest(uint32 delayMinutes, uint8 status) internal {
        FlightOracle.Attestation memory a = FlightOracle.Attestation({
            flightKey: flightKey,
            scheduledArrival: 1700010000,
            actualArrival: 1700010000 + uint64(delayMinutes) * 60,
            delayMinutes: delayMinutes,
            status: status,
            distanceKm: 470,
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

    function test_quoteIsEightPercent() public view {
        assertEq(cover.quote(COVER), (COVER * 800) / 10_000);
    }

    /// @dev The MetaMask moment: buying needs no oracle, because nothing has
    ///      happened to the flight yet.
    function test_buyNeedsNoOracle() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        uint256 id = cover.buy{value: premium}(flightKey, COVER);

        DelayCover.Policy memory p = cover.getPolicy(id);
        assertEq(p.holder, flyer);
        assertEq(p.cover, COVER);
        assertEq(p.premium, premium);
        assertFalse(p.settled);
        assertEq(cover.liveCover(), COVER);
        assertEq(cover.policiesOf(flyer).length, 1);
    }

    function test_buyRejectsUnderpayment() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        vm.expectRevert(
            abi.encodeWithSelector(DelayCover.Underpaid.selector, premium - 1, premium)
        );
        cover.buy{value: premium - 1}(flightKey, COVER);
    }

    /// @dev Several policies on one flight are allowed — a family on a single
    ///      booking pays from one wallet — so each gets its own id and payout.
    function test_multiplePoliciesOnSameFlight() public {
        uint256 premium = cover.quote(COVER);
        vm.startPrank(flyer);
        uint256 a = cover.buy{value: premium}(flightKey, COVER);
        uint256 b = cover.buy{value: premium}(flightKey, COVER);
        vm.stopPrank();

        assertTrue(a != b);
        assertEq(cover.policiesOnFlight(flightKey), 2);
        assertEq(cover.liveCover(), COVER * 2);
        assertEq(cover.policiesOf(flyer).length, 2);
    }

    function test_eachPolicyPaysSeparately() public {
        uint256 premium = cover.quote(COVER);
        vm.startPrank(flyer);
        uint256 a = cover.buy{value: premium}(flightKey, COVER);
        uint256 b = cover.buy{value: premium}(flightKey, COVER);
        vm.stopPrank();

        _attest(216, 1);
        uint256 before = flyer.balance;
        cover.settle(a);
        cover.settle(b);
        assertEq(flyer.balance, before + COVER * 2);
        assertEq(cover.liveCover(), 0);
    }

    /// @dev Never sell cover the reserves cannot honour.
    function test_cannotSellCoverBeyondReserves() public {
        DelayCover poor = new DelayCover(oracle, owner);
        uint256 big = 10 ether;
        // Resolve the quote BEFORE arming the cheatcodes: it is itself an
        // external call and would otherwise consume the prank and expectRevert.
        uint256 premium = poor.quote(big);
        vm.deal(flyer, 5 ether);

        vm.prank(flyer);
        vm.expectRevert(
            abi.encodeWithSelector(DelayCover.InsufficientReserves.selector, big, premium)
        );
        poor.buy{value: premium}(flightKey, big);
    }

    function test_settlePaysOutOnLongDelay() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        uint256 id = cover.buy{value: premium}(flightKey, COVER);

        _attest(216, 1);
        uint256 before = flyer.balance;
        cover.settle(id);

        assertEq(flyer.balance, before + COVER);
        assertTrue(cover.getPolicy(id).paidOut);
        assertEq(cover.liveCover(), 0);
        assertEq(cover.totalPaidOut(), COVER);
    }

    function test_settleDoesNotPayUnderThreshold() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        uint256 id = cover.buy{value: premium}(flightKey, COVER);

        _attest(179, 1);
        uint256 before = flyer.balance;
        cover.settle(id);

        assertEq(flyer.balance, before);
        assertFalse(cover.getPolicy(id).paidOut);
        assertTrue(cover.getPolicy(id).settled);
        assertEq(cover.liveCover(), 0);
    }

    /// @dev A cancellation compensates like a long delay under Article 5.
    function test_cancellationPaysOut() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        uint256 id = cover.buy{value: premium}(flightKey, COVER);

        _attest(0, 2);
        uint256 before = flyer.balance;
        cover.settle(id);
        assertEq(flyer.balance, before + COVER);
    }

    function test_settleRevertsWithoutAttestation() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        uint256 id = cover.buy{value: premium}(flightKey, COVER);

        vm.expectRevert(abi.encodeWithSelector(DelayCover.NotAttested.selector, flightKey));
        cover.settle(id);
    }

    function test_cannotSettleTwice() public {
        uint256 premium = cover.quote(COVER);
        vm.prank(flyer);
        uint256 id = cover.buy{value: premium}(flightKey, COVER);
        _attest(216, 1);
        cover.settle(id);
        vm.expectRevert(DelayCover.AlreadySettled.selector);
        cover.settle(id);
    }

    function testFuzz_premiumAlwaysBelowCover(uint96 c) public view {
        vm.assume(c > 10_000);
        assertLt(cover.quote(c), c);
    }
}
