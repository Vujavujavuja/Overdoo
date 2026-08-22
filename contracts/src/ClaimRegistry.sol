// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ClaimRegistry
/// @notice Canonical record of every purchased claim and its lifecycle.
contract ClaimRegistry is Ownable {
    enum Status {
        None,
        Purchased,
        InPursuit,
        Recovered,
        WrittenOff
    }

    struct Claim {
        bytes32 flightKey;
        address passenger;
        uint256 statutoryAmount; // 6dp cUSD
        uint256 purchasePrice;
        uint256 recoveredAmount;
        bytes32 assignmentHash;
        Status status;
        uint64 purchasedAt;
        uint64 resolvedAt;
    }

    address public settlement;
    address public ops;

    uint256 public nextId = 1;
    mapping(uint256 => Claim) private _claims;
    mapping(address => uint256[]) private _byPassenger;

    /// @dev A statutory claim can only be assigned once. Enforcing that here means
    ///      a double-purchase is impossible even if the backend is compromised.
    mapping(bytes32 => mapping(address => bool)) public assigned;

    uint256 public totalClaims;
    uint256 public recoveredClaims;
    uint256 public writtenOffClaims;

    event ClaimOpened(
        uint256 indexed id,
        bytes32 indexed flightKey,
        address indexed passenger,
        uint256 statutoryAmount,
        uint256 purchasePrice
    );
    event ClaimInPursuit(uint256 indexed id);
    event ClaimRecovered(uint256 indexed id, uint256 amount);
    event ClaimWrittenOff(uint256 indexed id);
    event RolesSet(address settlement, address ops);

    error NotSettlement();
    error NotOps();
    error AlreadyAssigned(bytes32 flightKey, address passenger);
    error BadStatus(Status current);

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    modifier onlyOps() {
        if (msg.sender != ops) revert NotOps();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRoles(address settlement_, address ops_) external onlyOwner {
        settlement = settlement_;
        ops = ops_;
        emit RolesSet(settlement_, ops_);
    }

    function open(
        bytes32 flightKey,
        address passenger,
        uint256 statutory,
        uint256 price,
        bytes32 assignmentHash
    ) external onlySettlement returns (uint256 id) {
        if (assigned[flightKey][passenger]) revert AlreadyAssigned(flightKey, passenger);
        assigned[flightKey][passenger] = true;

        id = nextId++;
        _claims[id] = Claim({
            flightKey: flightKey,
            passenger: passenger,
            statutoryAmount: statutory,
            purchasePrice: price,
            recoveredAmount: 0,
            assignmentHash: assignmentHash,
            status: Status.Purchased,
            purchasedAt: uint64(block.timestamp),
            resolvedAt: 0
        });
        _byPassenger[passenger].push(id);
        totalClaims++;

        emit ClaimOpened(id, flightKey, passenger, statutory, price);
    }

    function markInPursuit(uint256 id) external onlyOps {
        Claim storage c = _claims[id];
        if (c.status != Status.Purchased) revert BadStatus(c.status);
        c.status = Status.InPursuit;
        emit ClaimInPursuit(id);
    }

    function markRecovered(uint256 id, uint256 amount) external onlySettlement {
        Claim storage c = _claims[id];
        if (c.status != Status.Purchased && c.status != Status.InPursuit) {
            revert BadStatus(c.status);
        }
        c.status = Status.Recovered;
        c.recoveredAmount = amount;
        c.resolvedAt = uint64(block.timestamp);
        recoveredClaims++;
        emit ClaimRecovered(id, amount);
    }

    function markWrittenOff(uint256 id) external onlySettlement {
        Claim storage c = _claims[id];
        if (c.status != Status.Purchased && c.status != Status.InPursuit) {
            revert BadStatus(c.status);
        }
        c.status = Status.WrittenOff;
        c.resolvedAt = uint64(block.timestamp);
        writtenOffClaims++;
        emit ClaimWrittenOff(id);
    }

    function getClaim(uint256 id) external view returns (Claim memory) {
        return _claims[id];
    }

    function claimsByPassenger(address passenger) external view returns (uint256[] memory) {
        return _byPassenger[passenger];
    }

    function stats()
        external
        view
        returns (uint256 total, uint256 recovered, uint256 written, uint256 outstanding)
    {
        total = totalClaims;
        recovered = recoveredClaims;
        written = writtenOffClaims;
        outstanding = total - recovered - written;
    }
}
