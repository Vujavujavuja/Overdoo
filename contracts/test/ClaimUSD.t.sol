// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimUSD} from "../src/ClaimUSD.sol";

contract ClaimUSDTest is Test {
    ClaimUSD cusd;
    address alice = makeAddr("alice");

    function setUp() public {
        cusd = new ClaimUSD();
    }

    function test_metadata() public view {
        assertEq(cusd.decimals(), 6);
        assertEq(cusd.symbol(), "cUSD");
    }

    function test_mintUpToDailyCap() public {
        cusd.mint(alice, 10_000e6);
        assertEq(cusd.balanceOf(alice), 10_000e6);
        assertEq(cusd.remainingAllowanceToday(alice), 0);
    }

    function test_mintRevertsOverCap() public {
        cusd.mint(alice, 9_000e6);
        vm.expectRevert(
            abi.encodeWithSelector(ClaimUSD.DailyCapExceeded.selector, 2_000e6, 1_000e6)
        );
        cusd.mint(alice, 2_000e6);
    }

    function test_capResetsNextDay() public {
        cusd.mint(alice, 10_000e6);
        vm.warp(block.timestamp + 1 days);
        cusd.mint(alice, 10_000e6);
        assertEq(cusd.balanceOf(alice), 20_000e6);
    }

    function test_capIsPerAddress() public {
        address bob = makeAddr("bob");
        cusd.mint(alice, 10_000e6);
        cusd.mint(bob, 10_000e6);
        assertEq(cusd.balanceOf(bob), 10_000e6);
    }
}
