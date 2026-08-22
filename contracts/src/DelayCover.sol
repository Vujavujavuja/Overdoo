// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FlightOracle} from "./FlightOracle.sol";

/// @title DelayCover
/// @notice Buy cover on a flight before you fly. If it lands 3+ hours late, the
///         policy pays the EU261 statutory amount.
/// @dev Deliberately the inverse of claim-purchasing: the passenger pays first,
///      so buying needs no oracle at all. The oracle is only consulted at
///      settlement, when there is finally a fact to verify.
contract DelayCover is Ownable {
    /// @notice Premium as a fraction of cover, in basis points.
    uint256 public premiumBps = 800; // 8%

    /// @notice EU261 compensation threshold: three hours late at arrival.
    uint32 public constant DELAY_THRESHOLD_MIN = 180;

    FlightOracle public immutable oracle;

    struct Policy {
        address holder;
        bytes32 flightKey;
        uint256 premium;
        uint256 cover;
        uint64 boughtAt;
        bool settled;
        bool paidOut;
    }

    Policy[] private _policies;
    mapping(address => uint256[]) private _byHolder;
    /// @dev One policy per holder per flight; nobody insures the same seat twice.
    mapping(bytes32 => mapping(address => bool)) public covered;

    /// @notice Premiums received minus payouts made. What the underwriter holds.
    uint256 public totalPremiums;
    uint256 public totalPaidOut;
    uint256 public liveCover;

    event PolicyBought(
        uint256 indexed id, address indexed holder, bytes32 indexed flightKey,
        uint256 premium, uint256 cover
    );
    event PolicyPaid(uint256 indexed id, address indexed holder, uint256 amount, uint32 delayMinutes);
    event PolicyExpired(uint256 indexed id, uint32 delayMinutes);
    event PremiumBpsSet(uint256 bps);

    error Underpaid(uint256 sent, uint256 required);
    error AlreadyCovered(bytes32 flightKey, address holder);
    error UnknownPolicy();
    error AlreadySettled();
    error NotAttested(bytes32 flightKey);
    error InsufficientReserves(uint256 needed, uint256 available);
    error TransferFailed();
    error ZeroCover();

    constructor(FlightOracle oracle_, address initialOwner) Ownable(initialOwner) {
        oracle = oracle_;
    }

    /// @notice Top up the reserve that pays claims.
    receive() external payable {}

    function setPremiumBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= 10_000, "bad bps");
        premiumBps = bps;
        emit PremiumBpsSet(bps);
    }

    /// @notice Premium required for a given amount of cover.
    function quote(uint256 cover) public view returns (uint256) {
        return (cover * premiumBps) / 10_000;
    }

    /// @notice Reserves not already committed to live policies.
    function freeReserves() public view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > liveCover ? balance - liveCover : 0;
    }

    /// @notice Buy cover on a flight. No oracle involved — nothing has happened yet.
    function buy(bytes32 flightKey, uint256 cover) external payable returns (uint256 id) {
        if (cover == 0) revert ZeroCover();
        if (covered[flightKey][msg.sender]) revert AlreadyCovered(flightKey, msg.sender);

        uint256 required = quote(cover);
        if (msg.value < required) revert Underpaid(msg.value, required);

        // The contract must be able to honour the policy it is selling.
        // msg.value is already inside address(this).balance here, so
        // freeReserves() counts it — adding it again would overstate cover.
        uint256 available = freeReserves();
        if (available < cover) revert InsufficientReserves(cover, available);

        covered[flightKey][msg.sender] = true;
        liveCover += cover;
        totalPremiums += msg.value;

        id = _policies.length;
        _policies.push(
            Policy({
                holder: msg.sender,
                flightKey: flightKey,
                premium: msg.value,
                cover: cover,
                boughtAt: uint64(block.timestamp),
                settled: false,
                paidOut: false
            })
        );
        _byHolder[msg.sender].push(id);

        emit PolicyBought(id, msg.sender, flightKey, msg.value, cover);
    }

    /// @notice Settle a policy once the flight has been attested on chain.
    ///         Anyone may call it — the outcome is determined by the oracle,
    ///         not by who asks.
    function settle(uint256 id) external {
        if (id >= _policies.length) revert UnknownPolicy();
        Policy storage p = _policies[id];
        if (p.settled) revert AlreadySettled();
        if (!oracle.isAttested(p.flightKey)) revert NotAttested(p.flightKey);

        FlightOracle.Attestation memory a = oracle.getAttestation(p.flightKey);

        p.settled = true;
        liveCover -= p.cover;

        // status 2 = Cancelled, which compensates like a long delay under Art. 5.
        if (a.delayMinutes >= DELAY_THRESHOLD_MIN || a.status == 2) {
            p.paidOut = true;
            totalPaidOut += p.cover;
            (bool ok, ) = p.holder.call{value: p.cover}("");
            if (!ok) revert TransferFailed();
            emit PolicyPaid(id, p.holder, p.cover, a.delayMinutes);
        } else {
            emit PolicyExpired(id, a.delayMinutes);
        }
    }

    function policyCount() external view returns (uint256) {
        return _policies.length;
    }

    function getPolicy(uint256 id) external view returns (Policy memory) {
        if (id >= _policies.length) revert UnknownPolicy();
        return _policies[id];
    }

    function policiesOf(address holder) external view returns (uint256[] memory) {
        return _byHolder[holder];
    }

    /// @notice Withdraw reserves not committed to live policies.
    function withdrawFree(uint256 amount) external onlyOwner {
        if (amount > freeReserves()) revert InsufficientReserves(amount, freeReserves());
        (bool ok, ) = owner().call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
