// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TipJar
/// @notice Anyone can click to send a fixed tip. The money is forwarded to the
///         owner immediately (so it lands in their wallet in real time), and the
///         contract keeps a public tally of who paid and how much.
/// @dev The deployer becomes the owner/recipient. No admin functions, no way to
///      change the recipient, nothing held in the contract.
contract TipJar {
    /// @notice Minimum tip. MON has 18 decimals, so `ether` here means MON.
    uint256 public constant PRICE = 0.01 ether;

    /// @notice Whoever deployed this contract. Receives every tip.
    address public immutable owner;

    /// @notice Number of tips received.
    uint256 public totalTips;

    /// @notice Total MON received, in wei.
    uint256 public totalReceived;

    /// @notice Tips sent per address.
    mapping(address => uint256) public tipsOf;

    address[] private _tippers;
    mapping(address => bool) private _seen;

    event Tipped(
        address indexed from,
        uint256 amount,
        uint256 totalTips,
        uint256 totalReceived
    );

    error Underpaid(uint256 sent, uint256 required);
    error ForwardFailed();

    constructor() {
        owner = msg.sender;
    }

    /// @notice Pay the owner. Send at least PRICE; anything more is forwarded too.
    function tip() external payable {
        if (msg.value < PRICE) revert Underpaid(msg.value, PRICE);

        // Effects before interaction (checks-effects-interactions), so the
        // forwarding call below can't re-enter into inconsistent state.
        unchecked {
            ++totalTips;
            ++tipsOf[msg.sender];
            totalReceived += msg.value;
        }
        if (!_seen[msg.sender]) {
            _seen[msg.sender] = true;
            _tippers.push(msg.sender);
        }

        emit Tipped(msg.sender, msg.value, totalTips, totalReceived);

        (bool ok, ) = owner.call{value: msg.value}("");
        if (!ok) revert ForwardFailed();
    }

    /// @notice How many distinct addresses have tipped.
    function tipperCount() external view returns (uint256) {
        return _tippers.length;
    }

    /// @notice Everyone who has tipped, in first-tip order.
    function tippers() external view returns (address[] memory) {
        return _tippers;
    }
}
