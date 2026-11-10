// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AssayAttestations
/// @notice Emits an event recording an Assay reading for a tokenized stock. It stores nothing,
/// holds no funds, accepts no ETH and moves no tokens. Anyone can call it, so the event proves
/// only that `attester` submitted these values at that time, not that they are correct.
/// Prices use 8 decimals (same scale as the reference feeds).
contract AssayAttestations {
    /// @dev state: 0 Fresh, 1 Stale, 2 Drifting, 3 Broken.
    event Attested(
        address indexed token,
        address indexed attester,
        uint256 price,
        uint256 referencePrice,
        uint64 timestamp,
        uint8 state
    );

    error InvalidState(uint8 state);

    function attest(address token, uint256 price, uint256 referencePrice, uint64 timestamp, uint8 state) external {
        if (state > 3) revert InvalidState(state);
        emit Attested(token, msg.sender, price, referencePrice, timestamp, state);
    }
}
