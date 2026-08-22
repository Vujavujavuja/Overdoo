// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CapitalPool
/// @notice Underwriter capital, denominated in native MON.
/// @dev Share price is a pure function of on-chain state. A write-off reduces
///      `deployed` with no offsetting repayment, so `totalAssets` falls and the
///      share price falls in the same transaction. Losses cannot be deferred,
///      netted or restated. That property is the argument for running this
///      on-chain rather than in a spreadsheet.
contract CapitalPool is Ownable {
    address public settlement;

    uint256 public idle;
    uint256 public deployed;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    event Deposit(address indexed who, uint256 amount, uint256 shares);
    event Withdraw(address indexed who, uint256 shares, uint256 amount);
    event Draw(uint256 amount);
    event Repay(uint256 principal, uint256 yieldAmount);
    event WriteOff(uint256 principal);
    event SettlementSet(address settlement);

    error NotSettlement();
    error SettlementAlreadySet();
    error ZeroAmount();
    error InsufficientIdle(uint256 requested, uint256 available);
    error InsufficientDeployed(uint256 requested, uint256 available);
    error InsufficientShares(uint256 requested, uint256 available);
    error TransferFailed();
    error WrongValue(uint256 sent, uint256 expected);

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setSettlement(address settlement_) external onlyOwner {
        if (settlement != address(0)) revert SettlementAlreadySet();
        settlement = settlement_;
        emit SettlementSet(settlement_);
    }

    function totalAssets() public view returns (uint256) {
        return idle + deployed;
    }

    /// @notice Value of one share, scaled by 1e18.
    function sharePrice() public view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (totalAssets() * 1e18) / totalShares;
    }

    function deposit() external payable returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();

        // Priced against assets BEFORE this deposit lands. msg.value is already
        // in the contract balance, so we must not read balance directly here.
        uint256 assetsBefore = totalAssets();
        shares = totalShares == 0 ? msg.value : (msg.value * totalShares) / assetsBefore;
        if (shares == 0) revert ZeroAmount();

        idle += msg.value;
        totalShares += shares;
        sharesOf[msg.sender] += shares;
        emit Deposit(msg.sender, msg.value, shares);
    }

    function withdraw(uint256 shares) external returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        uint256 held = sharesOf[msg.sender];
        if (shares > held) revert InsufficientShares(shares, held);

        amount = (shares * totalAssets()) / totalShares;
        // Deployed capital is illiquid by construction: it is out against claims
        // that have not resolved. Only idle capital can leave.
        if (amount > idle) revert InsufficientIdle(amount, idle);

        totalShares -= shares;
        sharesOf[msg.sender] = held - shares;
        idle -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdraw(msg.sender, shares, amount);
    }

    function draw(uint256 amount) external onlySettlement {
        if (amount == 0) revert ZeroAmount();
        if (amount > idle) revert InsufficientIdle(amount, idle);
        idle -= amount;
        deployed += amount;
        (bool ok, ) = settlement.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Draw(amount);
    }

    function repay(uint256 principal, uint256 yieldAmount) external payable onlySettlement {
        if (principal > deployed) revert InsufficientDeployed(principal, deployed);
        if (msg.value != principal + yieldAmount) {
            revert WrongValue(msg.value, principal + yieldAmount);
        }
        deployed -= principal;
        idle += msg.value;
        emit Repay(principal, yieldAmount);
    }

    function writeOff(uint256 principal) external onlySettlement {
        if (principal > deployed) revert InsufficientDeployed(principal, deployed);
        deployed -= principal;
        emit WriteOff(principal);
    }
}
