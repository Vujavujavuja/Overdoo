// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CapitalPool} from "./CapitalPool.sol";
import {ClaimRegistry} from "./ClaimRegistry.sol";
import {FlightOracle} from "./FlightOracle.sol";

/// @title Settlement
/// @notice The only contract that moves capital. Purchases are atomic: the
///         registry entry, the pool draw and the passenger payment all happen,
///         or none of them do. Denominated in native MON.
contract Settlement is Ownable {
    CapitalPool public immutable pool;
    ClaimRegistry public immutable registry;
    FlightOracle public immutable oracle;

    address public ops;

    event ClaimPurchased(
        uint256 indexed claimId, bytes32 indexed flightKey, address indexed passenger, uint256 price
    );
    event RecoverySettled(uint256 indexed claimId, uint256 recovered, uint256 principal, uint256 yieldAmount);
    event WriteOffSettled(uint256 indexed claimId, uint256 principal);
    event OpsSet(address ops);

    error NotOps();
    error FlightNotAttested(bytes32 flightKey);
    error BadStatus(ClaimRegistry.Status current);
    error TransferFailed();

    modifier onlyOps() {
        if (msg.sender != ops) revert NotOps();
        _;
    }

    constructor(
        CapitalPool pool_,
        ClaimRegistry registry_,
        FlightOracle oracle_,
        address initialOwner
    ) Ownable(initialOwner) {
        pool = pool_;
        registry = registry_;
        oracle = oracle_;
    }

    /// @dev Receives drawn capital from the pool.
    receive() external payable {}

    function setOps(address ops_) external onlyOwner {
        ops = ops_;
        emit OpsSet(ops_);
    }

    /// @notice Buy a passenger's statutory claim for cash, now.
    /// @dev Registry entry opens FIRST so the double-assignment guard reverts
    ///      before any capital moves.
    function purchaseClaim(
        bytes32 flightKey,
        address passenger,
        uint256 statutoryAmount,
        uint256 purchasePrice,
        bytes32 assignmentHash
    ) external onlyOps returns (uint256 claimId) {
        if (!oracle.isAttested(flightKey)) revert FlightNotAttested(flightKey);

        claimId = registry.open(flightKey, passenger, statutoryAmount, purchasePrice, assignmentHash);

        pool.draw(purchasePrice);
        (bool ok, ) = passenger.call{value: purchasePrice}("");
        if (!ok) revert TransferFailed();

        emit ClaimPurchased(claimId, flightKey, passenger, purchasePrice);
    }

    /// @notice Record money recovered from the airline and return it to the pool.
    /// @dev A partial recovery repays what came in and writes off the shortfall,
    ///      so `deployed` always returns to zero for a resolved claim.
    function settleRecovery(uint256 claimId, uint256 recoveredAmount) external payable onlyOps {
        ClaimRegistry.Claim memory c = registry.getClaim(claimId);
        if (c.status != ClaimRegistry.Status.Purchased && c.status != ClaimRegistry.Status.InPursuit) {
            revert BadStatus(c.status);
        }
        if (msg.value != recoveredAmount) revert TransferFailed();

        uint256 principal;
        uint256 yieldAmount;
        if (recoveredAmount >= c.purchasePrice) {
            principal = c.purchasePrice;
            yieldAmount = recoveredAmount - c.purchasePrice;
            pool.repay{value: recoveredAmount}(principal, yieldAmount);
        } else {
            principal = recoveredAmount;
            pool.repay{value: recoveredAmount}(principal, 0);
            pool.writeOff(c.purchasePrice - recoveredAmount);
        }

        registry.markRecovered(claimId, recoveredAmount);
        emit RecoverySettled(claimId, recoveredAmount, principal, yieldAmount);
    }

    /// @notice Abandon a claim. The pool eats the loss immediately.
    function settleWriteOff(uint256 claimId) external onlyOps {
        ClaimRegistry.Claim memory c = registry.getClaim(claimId);
        if (c.status != ClaimRegistry.Status.Purchased && c.status != ClaimRegistry.Status.InPursuit) {
            revert BadStatus(c.status);
        }
        pool.writeOff(c.purchasePrice);
        registry.markWrittenOff(claimId);
        emit WriteOffSettled(claimId, c.purchasePrice);
    }
}
