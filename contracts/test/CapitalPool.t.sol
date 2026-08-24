// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CapitalPool} from "../src/CapitalPool.sol";

contract CapitalPoolTest is Test {
    CapitalPool pool;

    address owner = makeAddr("owner");
    address settlement = makeAddr("settlement");
    address lpA = makeAddr("lpA");
    address lpB = makeAddr("lpB");

    function setUp() public {
        pool = new CapitalPool(owner);
        vm.prank(owner);
        pool.setSettlement(settlement);

        vm.deal(lpA, 100 ether);
        vm.deal(lpB, 100 ether);
        vm.deal(settlement, 100 ether);
    }

    function test_firstDepositIsOneToOne() public {
        vm.prank(lpA);
        uint256 shares = pool.deposit{value: 5 ether}();

        assertEq(shares, 5 ether);
        assertEq(pool.sharePrice(), 1e18);
        assertEq(pool.totalAssets(), 5 ether);
        assertEq(pool.idle(), 5 ether);
    }

    function test_drawMovesIdleToDeployedWithoutChangingSharePrice() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();

        uint256 before = settlement.balance;
        vm.prank(settlement);
        pool.draw(1 ether);

        assertEq(pool.idle(), 4 ether);
        assertEq(pool.deployed(), 1 ether);
        assertEq(pool.totalAssets(), 5 ether);
        
        // Deployed capital is carried at cost until it resolves.
        assertEq(pool.sharePrice(), 1e18);
        assertEq(settlement.balance, before + 1 ether);
    }

    function test_repayWithYieldRaisesSharePrice() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        vm.prank(settlement);
        pool.draw(1 ether);

        vm.prank(settlement);
        pool.repay{value: 1.2 ether}(1 ether, 0.2 ether);

        assertEq(pool.deployed(), 0);
        assertEq(pool.totalAssets(), 5.2 ether);
        assertEq(pool.sharePrice(), 1.04e18);
    }

    /// @dev The core solvency property: a write-off hits share price immediately.
    function test_writeOffLowersSharePriceImmediately() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        vm.prank(settlement);
        pool.draw(1 ether);

        vm.prank(settlement);
        pool.writeOff(1 ether);

        assertEq(pool.deployed(), 0);
        assertEq(pool.totalAssets(), 4 ether);
        assertEq(pool.sharePrice(), 0.8e18);
    }

    function test_laterDepositorPaysCurrentSharePrice() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        vm.prank(settlement);
        pool.draw(1 ether);
        vm.prank(settlement);
        pool.writeOff(1 ether); // price now 0.8

        vm.prank(lpB);
        uint256 shares = pool.deposit{value: 4 ether}();

        // 4 MON at 0.8 buys 5 shares, not 4.
        assertEq(shares, 5 ether);
        assertEq(pool.sharePrice(), 0.8e18);
    }

    function test_cannotWithdrawDeployedCapital() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        vm.prank(settlement);
        pool.draw(4.5 ether);

        vm.prank(lpA);
        vm.expectRevert(
            abi.encodeWithSelector(CapitalPool.InsufficientIdle.selector, 5 ether, 0.5 ether)
        );
        pool.withdraw(5 ether);
    }

    function test_withdrawReturnsProRataAssets() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        uint256 before = lpA.balance;

        vm.prank(lpA);
        uint256 amount = pool.withdraw(2.5 ether);

        assertEq(amount, 2.5 ether);
        assertEq(lpA.balance, before + 2.5 ether);
    }

    function test_onlySettlementCanDraw() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        vm.prank(lpA);
        vm.expectRevert(CapitalPool.NotSettlement.selector);
        pool.draw(1 ether);
    }

    function test_repayRejectsWrongValue() public {
        vm.prank(lpA);
        pool.deposit{value: 5 ether}();
        vm.prank(settlement);
        pool.draw(1 ether);

        vm.prank(settlement);
        vm.expectRevert(
            abi.encodeWithSelector(CapitalPool.WrongValue.selector, 0.5 ether, 1 ether)
        );
        pool.repay{value: 0.5 ether}(1 ether, 0);
    }

    function testFuzz_sharePriceStableWhenNothingResolves(uint96 a, uint96 b) public {
        vm.assume(a >= 1e12 && a <= 50 ether);
        vm.assume(b >= 1e12 && b <= 50 ether);

        vm.prank(lpA);
        pool.deposit{value: a}();
        vm.prank(lpB);
        pool.deposit{value: b}();

        // Rounding is in the pool's favour, never the depositor's.
        assertLe(pool.sharePrice(), 1e18 + 1e6);
        assertGe(pool.sharePrice(), 1e18 - 1e6);
    }
}
