// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Kernel} from "kernel/Kernel.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";

/// @notice A Kernel v3.1 hook on Sleeve's executor config. Kernel calls preCheck and postCheck inside
/// executeFromExecutor and bubbles their reverts; once armed, postCheck reverts PremiumAboveCap(-4242).
contract ForgingHook {
    bool public armed;

    function arm() external {
        armed = true;
    }

    function onInstall(bytes calldata) external payable {}

    function onUninstall(bytes calldata) external payable {}

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == 4;
    }

    function isInitialized(address) external pure returns (bool) {
        return false;
    }

    function preCheck(address, uint256, bytes calldata) external payable returns (bytes memory) {
        return "";
    }

    function postCheck(bytes calldata) external payable {
        if (armed) revert ISleeveModule.PremiumAboveCap(-4242);
    }
}

/// @notice Audit A1-19 and A1-12 on chain 4663 forked at block 78,312,136, with real USDG, the SPY token, feed and
/// fee-500 pool, SwapRouter02 and the deployed Kernel v3.1, after the fixes.
contract AuditBuyExecForkTest is SleeveModuleForkTradeBase {
    address private constant POOL = LaunchConfig.SPY_POOL_500;

    function setUp() public {
        _setUpTrade();
    }

    /// A1-19: the owner installs Sleeve with an executor hook. Unarmed, the keeper's split fills on the real pool;
    /// armed, the hook's forged PremiumAboveCap(-4242) now reverts the split BatchReverted, with no receipt, where it
    /// used to write QUEUED(PREMIUM) with premiumBps -4242.
    function test_fork_A1_19_kernelExecutorHookCannotForgeAPremiumQueue() public {
        ForgingHook hook = new ForgingHook();
        address account = _createAccount(owner, bytes32("hooked"));
        bytes memory initData =
            abi.encodePacked(address(hook), abi.encode(_installData(address(0), _defaultRule()), hex"00"));
        OpResult memory installed = _sendOp(
            account, ownerKey, abi.encodeCall(Kernel.installModule, (MODULE_TYPE_EXECUTOR, address(module), initData))
        );
        assertTrue(installed.success, "installed with the hook");
        _pay(account, PAYMENT);
        uint256 quote = _quote(SPY, POOL, EQUITY);

        uint256 snapshot = vm.snapshotState();
        ISleeveModule.Receipt memory control = _onlyReceipt(_keeperSplit(account, POOL, quote));
        assertEq(uint8(control.status), uint8(Status.FILLED), "unarmed, the same split fills");
        vm.revertToState(snapshot);

        hook.arm();
        uint256 next = module.nextReceiptId();
        bytes memory forged = abi.encodeWithSelector(ISleeveModule.PremiumAboveCap.selector, int256(-4242));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BatchReverted.selector, forged));
        vm.prank(keeper);
        module.split(account, POOL, quote);
        assertEq(module.nextReceiptId(), next, "no receipt");
        assertEq(module.bucketOf(account, SPY).amount, 0, "nothing queued");
    }

    /// A1-12: the keeper quotes, then a 100,000 USDG whale buy pushes the real pool past the 100 bps cap. The split
    /// with the quote from before the push now queues PREMIUM, as PRD 7.4 orders step 8 before step 9, where
    /// SwapRouter02's "Too little received" used to revert it.
    function test_fork_A1_12_poolPushedAfterTheQuote_queuesPremium() public {
        address account = _account(0, _defaultRule());
        uint256 quoteBeforeThePush = _quote(SPY, POOL, EQUITY);
        _pushPool(SPY, POOL, 100_000e6);

        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, POOL, quoteBeforeThePush));

        assertEq(uint8(receipt.status), uint8(Status.QUEUED));
        assertEq(uint8(receipt.reason), uint8(Reason.PREMIUM));
        assertGt(receipt.premiumBps, 100, "step 8 failed first");
        assertEq(receipt.quote, quoteBeforeThePush, "the stale quote is on the receipt");
        assertEq(module.bucketOf(account, SPY).amount, EQUITY, "the equity part waits");
    }
}
