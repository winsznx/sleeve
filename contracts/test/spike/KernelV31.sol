// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ZeroDev Kernel v3.1 deployment on chain 4663. Addresses come from the npm packages
/// zerodev sdk 5.5.10 (KernelVersionToAddressesMap["0.3.1"]) and zerodev ecdsa-validator 5.4.9 (">=0.3.1").
/// Runtime bytecode checks against the v3.1 tag are recorded in docs/research/g6-notes.md.
library KernelV31 {
    address internal constant IMPLEMENTATION = 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D;
    address internal constant FACTORY = 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419;
    /// FactoryStaker. The SDK's default factory for v3.x UserOps: deployWithFactory(FACTORY, initData, salt).
    address internal constant META_FACTORY = 0xd703aaE79538628d27099B8c4f621bE4CCd142d5;
    address internal constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;

    /// keccak256 of the ERC-1967 proxy creation code FACTORY deploys (SDK initCodeHash for "0.3.1"). With it the
    /// account address is CREATE2(FACTORY, keccak256(abi.encodePacked(initData, salt)), PROXY_INIT_CODE_HASH).
    bytes32 internal constant PROXY_INIT_CODE_HASH = 0x85d96aa1c9a65886d094915d76ccae85f14027a02c1647dde659f869460f03e6;

    string internal constant ACCOUNT_ID = "kernel.advanced.v0.3.1";
}
