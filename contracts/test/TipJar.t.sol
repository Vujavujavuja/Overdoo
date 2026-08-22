// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TipJar} from "../src/TipJar.sol";

contract TipJarTest is Test {
    TipJar jar;

    address vuja = makeAddr("vuja"); // deployer / recipient
    address friend = makeAddr("friend");
    address stranger = makeAddr("stranger");

    event Tipped(
        address indexed from,
        uint256 amount,
        uint256 totalTips,
        uint256 totalReceived
    );

    function setUp() public {
        vm.prank(vuja);
        jar = new TipJar();

        vm.deal(friend, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    function test_deployerIsOwner() public view {
        assertEq(jar.owner(), vuja);
        assertEq(jar.PRICE(), 0.01 ether);
    }

    function test_tipPaysOwnerImmediately() public {
        uint256 before = vuja.balance;

        vm.prank(friend);
        jar.tip{value: 0.01 ether}();

        // The money reaches the owner, not the contract.
        assertEq(vuja.balance, before + 0.01 ether);
        assertEq(address(jar).balance, 0);
    }

    function test_tipCounts() public {
        vm.prank(friend);
        jar.tip{value: 0.01 ether}();
        vm.prank(friend);
        jar.tip{value: 0.01 ether}();
        vm.prank(stranger);
        jar.tip{value: 0.01 ether}();

        assertEq(jar.totalTips(), 3);
        assertEq(jar.tipsOf(friend), 2);
        assertEq(jar.tipsOf(stranger), 1);
        assertEq(jar.totalReceived(), 0.03 ether);
        assertEq(jar.tipperCount(), 2);
    }

    function test_tippersRecordedOnceInOrder() public {
        vm.prank(friend);
        jar.tip{value: 0.01 ether}();
        vm.prank(stranger);
        jar.tip{value: 0.01 ether}();
        vm.prank(friend);
        jar.tip{value: 0.01 ether}();

        address[] memory t = jar.tippers();
        assertEq(t.length, 2);
        assertEq(t[0], friend);
        assertEq(t[1], stranger);
    }

    function test_emitsTippedEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Tipped(friend, 0.01 ether, 1, 0.01 ether);

        vm.prank(friend);
        jar.tip{value: 0.01 ether}();
    }

    function test_rejectsUnderpayment() public {
        vm.prank(friend);
        vm.expectRevert(
            abi.encodeWithSelector(TipJar.Underpaid.selector, 0.009 ether, 0.01 ether)
        );
        jar.tip{value: 0.009 ether}();
    }

    function test_rejectsZero() public {
        vm.prank(friend);
        vm.expectRevert(
            abi.encodeWithSelector(TipJar.Underpaid.selector, 0, 0.01 ether)
        );
        jar.tip{value: 0}();
    }

    function test_overpaymentIsForwardedInFull() public {
        uint256 before = vuja.balance;

        vm.prank(friend);
        jar.tip{value: 1 ether}();

        assertEq(vuja.balance, before + 1 ether);
        assertEq(jar.totalReceived(), 1 ether);
        assertEq(address(jar).balance, 0);
    }

    function testFuzz_anyAmountAtOrAbovePriceWorks(uint96 amount) public {
        vm.assume(amount >= 0.01 ether);
        vm.deal(friend, amount);
        uint256 before = vuja.balance;

        vm.prank(friend);
        jar.tip{value: amount}();

        assertEq(vuja.balance, before + amount);
        assertEq(jar.totalReceived(), amount);
    }
}
