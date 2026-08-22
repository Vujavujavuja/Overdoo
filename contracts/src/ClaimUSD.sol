// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ClaimUSD
/// @notice Settlement stablecoin for Aeroclaim. 6 decimals to match USDC.
/// @dev Monad testnet has no canonical stablecoin, so we ship a real ERC20 with
///      a rate-limited open faucet. Real transfers, real balances — this is
///      infrastructure standing in for USDC, not a mock of one.
contract ClaimUSD is ERC20 {
    /// @notice Maximum a single address may mint per UTC day.
    uint256 public constant DAILY_MINT_CAP = 10_000e6;

    /// @dev address => day index => amount minted that day.
    mapping(address => mapping(uint256 => uint256)) public mintedOn;

    error DailyCapExceeded(uint256 requested, uint256 remaining);

    constructor() ERC20("Claim USD", "cUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Current UTC day index, used for faucet rate limiting.
    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice How much `who` may still mint today.
    function remainingAllowanceToday(address who) public view returns (uint256) {
        uint256 used = mintedOn[who][today()];
        return used >= DAILY_MINT_CAP ? 0 : DAILY_MINT_CAP - used;
    }

    /// @notice Open faucet, capped per address per day.
    function mint(address to, uint256 amount) external {
        uint256 remaining = remainingAllowanceToday(to);
        if (amount > remaining) revert DailyCapExceeded(amount, remaining);
        mintedOn[to][today()] += amount;
        _mint(to, amount);
    }
}
