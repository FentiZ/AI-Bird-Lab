// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Educational example: local Hardhat ETH only. Not audited for real funds.
contract BirdSubscription {
    address public immutable owner;
    uint256 public immutable price;
    uint256 public constant DURATION = 30 days;
    mapping(address => uint256) public expiresAt;

    event Subscribed(address indexed subscriber, uint256 newExpiry);

    constructor(uint256 _price) {
        require(_price > 0, "Invalid price");
        owner = msg.sender;
        price = _price;
    }

    function subscribe() external payable {
        require(msg.value == price, "Incorrect amount");
        uint256 start = expiresAt[msg.sender] > block.timestamp
            ? expiresAt[msg.sender]
            : block.timestamp;
        expiresAt[msg.sender] = start + DURATION;
        emit Subscribed(msg.sender, expiresAt[msg.sender]);
    }

    function isActive(address subscriber) external view returns (bool) {
        return expiresAt[subscriber] > block.timestamp;
    }

    function withdraw() external {
        require(msg.sender == owner, "Not owner");
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}
