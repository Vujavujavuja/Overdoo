// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FlightOracle
/// @notice Threshold-signed flight outcome attestations.
/// @dev This is NOT trustless. It is an m-of-n signature threshold over a set of
///      authorised attestors. Its value is that an underwriter can verify a payout
///      was triggered by data which m independent parties were willing to sign,
///      and can identify exactly who signed it.
contract FlightOracle is EIP712, Ownable {
    struct Attestation {
        bytes32 flightKey; // keccak256(carrier, flightNumber, scheduledDepUTC)
        uint64 scheduledArrival;
        uint64 actualArrival;
        uint32 delayMinutes;
        uint8 status; // 0=OnTime 1=Delayed 2=Cancelled 3=Diverted
        uint32 distanceKm;
        uint64 attestedAt;
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 flightKey,uint64 scheduledArrival,uint64 actualArrival,uint32 delayMinutes,uint8 status,uint32 distanceKm,uint64 attestedAt)"
    );

    mapping(address => bool) public isAttestor;
    uint8 public threshold;

    mapping(bytes32 => Attestation) private _attestations;
    mapping(bytes32 => bool) private _attested;
    /// @notice Signers who attested a given flight, for after-the-fact audit.
    mapping(bytes32 => address[]) private _signersOf;

    event FlightAttested(
        bytes32 indexed flightKey, uint32 delayMinutes, uint8 status, address[] signers
    );
    event AttestorSet(address indexed attestor, bool allowed);
    event ThresholdSet(uint8 threshold);

    error AlreadyAttested(bytes32 flightKey);
    error NotEnoughSignatures(uint256 provided, uint8 required);
    error UnauthorisedSigner(address signer);
    error SignersNotSorted();
    error InvalidThreshold();

    constructor(address initialOwner) EIP712("Aeroclaim", "1") Ownable(initialOwner) {
        threshold = 2;
    }

    function setAttestor(address attestor, bool allowed) external onlyOwner {
        isAttestor[attestor] = allowed;
        emit AttestorSet(attestor, allowed);
    }

    function setThreshold(uint8 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert InvalidThreshold();
        threshold = newThreshold;
        emit ThresholdSet(newThreshold);
    }

    /// @notice Hash an attestation under this contract's EIP-712 domain.
    function hashAttestation(Attestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    a.flightKey,
                    a.scheduledArrival,
                    a.actualArrival,
                    a.delayMinutes,
                    a.status,
                    a.distanceKm,
                    a.attestedAt
                )
            )
        );
    }

    /// @notice Submit an attestation signed by at least `threshold` authorised attestors.
    /// @dev Signatures MUST be ordered by ascending signer address. That ordering is
    ///      what makes duplicate-signer detection O(n) instead of O(n^2), and a
    ///      duplicate signature is the one attack that would let a single attestor
    ///      satisfy the threshold alone.
    function attest(Attestation calldata a, bytes[] calldata sigs) external {
        if (_attested[a.flightKey]) revert AlreadyAttested(a.flightKey);
        if (sigs.length < threshold) revert NotEnoughSignatures(sigs.length, threshold);

        bytes32 digest = hashAttestation(a);
        address[] memory signers = new address[](sigs.length);
        address previous = address(0);

        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = ECDSA.recover(digest, sigs[i]);
            if (!isAttestor[signer]) revert UnauthorisedSigner(signer);
            if (signer <= previous) revert SignersNotSorted();
            previous = signer;
            signers[i] = signer;
        }

        _attestations[a.flightKey] = a;
        _attested[a.flightKey] = true;
        _signersOf[a.flightKey] = signers;

        emit FlightAttested(a.flightKey, a.delayMinutes, a.status, signers);
    }

    function getAttestation(bytes32 flightKey) external view returns (Attestation memory) {
        return _attestations[flightKey];
    }

    function isAttested(bytes32 flightKey) external view returns (bool) {
        return _attested[flightKey];
    }

    function signersOf(bytes32 flightKey) external view returns (address[] memory) {
        return _signersOf[flightKey];
    }
}
