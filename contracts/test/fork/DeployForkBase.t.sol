// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Kernel} from "kernel/Kernel.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {IQuoterV2} from "../../src/interfaces/IQuoterV2.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {Deployment} from "../../script/DeployChecks.sol";
import {DeployConfig} from "../../script/DeployConfig.sol";
import {ArbSysMock} from "../utils/ForkBase.sol";
import {KernelHelpers} from "../utils/KernelHelpers.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice The smoke test every deploy proof ends with, on contracts Deploy.s.sol deployed: a Kernel v3.1 account
/// created through the deployed factory with an ECDSA root, the deployed module installed in its first UserOp, a rule
/// set in a bracketed owner UserOp, a USDG payment from TEST_PAYER, and the default keeper's split. The split fills when
/// the SPY session is open at the block and queues SESSION when it is closed, and its receipt hash is checked against
/// the module's stored hash and against the event's own bytes.
/// @dev Forge's EVM cannot run ArbSys, which every receipt reads, so the base etches the same mock the other fork tests
/// use, after the deploy checks have seen the real precompile's placeholder code.
abstract contract DeployForkBase is KernelHelpers {
    IERC20 internal constant USDG = IERC20(DeployConfig.USDG);
    uint8 internal constant SPY_ID = 0;
    uint256 internal constant PAYMENT = 1_000e6;
    uint256 internal constant EQUITY = 100e6;

    /// @notice What the smoke split did.
    struct Smoke {
        address account;
        bool sessionOpen;
        uint256 quote;
        ISleeveModule.Receipt receipt;
        uint256 tokensBought;
    }

    /// @notice Forks `rpc` at `blockNumber`, or at its latest block when zero, and checks the chain id.
    function _forkChain(string memory rpc, uint256 blockNumber) internal {
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
        assertEq(block.chainid, DeployConfig.CHAIN_ID, "not chain 4663");
    }

    /// @notice Puts the ArbSys stand-in at 0x64, as ForkBase does for the other fork tests.
    function _etchArbSys() internal {
        vm.etch(DeployConfig.ARB_SYS, address(new ArbSysMock()).code);
    }

    /// @notice The product default rule (SPEC 5): 10 percent to SPY, 100 bps premium cap, 50 bps slippage, 25 USDG clip.
    function _defaultRule() internal pure returns (ISleeveModule.RuleInput memory) {
        return ISleeveModule.RuleInput({
            spendBps: 9_000, equityBps: 1_000, tickerId: SPY_ID, premiumCapBps: 100, slippageBps: 50, minClip: 25e6
        });
    }

    /// @notice The smoke flow on a deployment, with every postcondition read back from chain state.
    function _smoke(Deployment memory d, bytes32 salt) internal returns (Smoke memory s) {
        ISleeveModule module = ISleeveModule(address(d.module));
        (address owner, uint256 ownerKey) = makeAddrAndKey("deploy-smoke-owner");

        OpResult memory installed;
        (s.account, installed) = _deployThenInstall(owner, ownerKey, salt, address(module), "");
        assertTrue(installed.success, "first UserOp: deploy and install");
        assertEq(Kernel(payable(s.account)).accountId(), "kernel.advanced.v0.3.1", "Kernel v3.1 account");
        assertTrue(
            Kernel(payable(s.account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""), "Kernel lists it"
        );
        assertTrue(module.isInitialized(s.account), "module snapshot");
        assertEq(module.keeperOf(s.account), DeployConfig.KEEPER, "default keeper");

        OpResult memory ruled = _sendOp(s.account, ownerKey, OwnerOps.setRule(address(module), _defaultRule()));
        assertTrue(ruled.success, "setRule UserOp");
        assertEq(module.ruleOf(s.account).version, 1, "rule version 1");
        assertEq(uint8(module.ruleOf(s.account).status), uint8(ISleeveModule.RuleStatus.ACTIVE), "rule active");

        deal(address(USDG), DeployConfig.TEST_PAYER, PAYMENT);
        vm.prank(DeployConfig.TEST_PAYER);
        assertTrue(USDG.transfer(s.account, PAYMENT), "payment");
        (,,, uint256 unsorted) = module.ledger(s.account);
        assertEq(unsorted, PAYMENT, "the payment is unsorted income");

        s.quote = _quote(DeployConfig.SPY, DeployConfig.SPY_POOL_500, EQUITY);
        s.sessionOpen = module.sessionOpenedAt(SPY_ID) != 0;
        uint256 tokensBefore = IERC20(DeployConfig.SPY).balanceOf(s.account);
        uint256 expectedId = module.nextReceiptId();
        vm.recordLogs();
        vm.prank(DeployConfig.KEEPER);
        uint256 id = module.split(s.account, DeployConfig.SPY_POOL_500, s.quote);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(id, expectedId, "receipt id");

        s.receipt = _onlyReceipt(logs, address(module), id);
        s.tokensBought = IERC20(DeployConfig.SPY).balanceOf(s.account) - tokensBefore;
        _assertSplitReceipt(d, s);
    }

    /// @notice The split's receipt: its hash, the deployment's own fields, I2, and the outcome the session allows.
    function _assertSplitReceipt(Deployment memory d, Smoke memory s) internal view {
        ISleeveModule.Receipt memory r = s.receipt;
        ISleeveModule module = ISleeveModule(address(d.module));
        assertEq(module.receiptHash(r.id), keccak256(abi.encode(r)), "stored receipt hash");
        assertEq(r.account, s.account, "account");
        assertEq(r.ruleVersion, 1, "rule version");
        assertEq(uint8(r.trigger), uint8(Trigger.KEEPER), "keeper trigger");
        assertEq(uint8(r.mode), uint8(AccountingMode.WRAPPED), "accounting mode");
        assertEq(r.tickerId, SPY_ID, "ticker");
        assertEq(r.token, DeployConfig.SPY, "token");
        assertEq(r.calendarVersion, DeployConfig.CALENDAR_VERSION, "calendar version");
        assertEq(r.disclosureHash, DeployConfig.DISCLOSURE_HASH, "disclosure hash");
        assertEq(r.usdgIn, PAYMENT, "usdgIn");
        assertEq(r.usdgToEquity, EQUITY, "usdgToEquity");
        assertEq(r.usdgIn, r.usdgToSpend + r.usdgSpent + r.usdgQueued, "I2");
        assertEq(USDG.balanceOf(address(d.module)), 0, "I1: the module holds no USDG");
        if (s.sessionOpen) {
            assertEq(uint8(r.status), uint8(Status.FILLED), "FILLED while the session is open");
            assertEq(uint8(r.reason), uint8(Reason.NONE), "no reason on a fill");
            assertEq(r.usdgSpent, EQUITY, "spent the equity part");
            assertEq(r.tokensOut, s.tokensBought, "tokens by balance delta");
            assertGt(s.tokensBought, 0, "I3: tokens in the account");
            assertEq(r.pool, DeployConfig.SPY_POOL_500, "pool");
            assertEq(r.quote, s.quote, "quote");
            assertEq(r.lotId, r.id, "lot id");
            assertEq(module.lot(r.id).tokensRemaining, s.tokensBought, "the lot holds the tokens");
            assertEq(USDG.allowance(s.account, DeployConfig.SWAP_ROUTER_02), 0, "I4: allowance reset");
        } else {
            assertEq(uint8(r.status), uint8(Status.QUEUED), "QUEUED while the session is closed");
            assertEq(uint8(r.reason), uint8(Reason.SESSION), "reason SESSION");
            assertEq(r.usdgQueued, EQUITY, "the equity part waits");
            assertEq(s.tokensBought, 0, "nothing bought");
            ISleeveModule.Bucket memory bucket = module.bucketOf(s.account, SPY_ID);
            assertEq(bucket.amount, EQUITY, "bucket");
            assertEq(uint8(bucket.reason), uint8(Reason.SESSION), "bucket reason");
            assertEq(USDG.balanceOf(s.account), PAYMENT, "the equity part stayed in the account");
        }
        (, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(s.account);
        assertEq(spend, PAYMENT - EQUITY, "spend ledger");
        assertEq(pendingTotal, s.sessionOpen ? 0 : EQUITY, "pending");
        assertEq(unsorted, 0, "nothing left unsorted");
    }

    /// @notice QuoterV2's output for `amountIn` USDG into `token` through `pool`, as the keeper's quote: token base
    /// units per 1e6 USDG base units.
    function _quote(address token, address pool, uint256 amountIn) internal returns (uint256) {
        (bool ok, bytes memory feeData) = pool.staticcall(abi.encodeWithSignature("fee()"));
        assertTrue(ok, "pool fee");
        (uint256 amountOut,,,) = IQuoterV2(DeployConfig.QUOTER_V2)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: DeployConfig.USDG,
                tokenOut: token,
                amountIn: amountIn,
                fee: abi.decode(feeData, (uint24)),
                sqrtPriceLimitX96: 0
            })
            );
        return amountOut * 1e6 / amountIn;
    }

    function _statusName(Status status) internal pure returns (string memory) {
        string[9] memory names = [
            "FILLED",
            "QUEUED",
            "SETTLED",
            "REFUSED_TICKER",
            "REFUSED_ACCOUNT",
            "RELEASED",
            "PART_SOLD",
            "SOLD",
            "RECONCILED"
        ];
        return names[uint8(status)];
    }

    function _reasonName(Reason reason) internal pure returns (string memory) {
        string[9] memory names =
            ["NONE", "PAUSED", "ORACLE_PAUSED", "SESSION", "MULTIPLIER", "STALE", "DEPEG", "CLIP", "PREMIUM"];
        return names[uint8(reason)];
    }

    /// @notice The one ReceiptWritten in `logs`, decoded, with its topics and its bytes checked against the module.
    function _onlyReceipt(Vm.Log[] memory logs, address module, uint256 id)
        internal
        view
        returns (ISleeveModule.Receipt memory receipt)
    {
        uint256 found;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.emitter != module || log.topics.length != 4) continue;
            if (log.topics[0] != ISleeveModule.ReceiptWritten.selector) continue;
            ++found;
            receipt = abi.decode(log.data, (ISleeveModule.Receipt));
            assertEq(log.topics[1], bytes32(id), "indexed id");
            assertEq(log.topics[2], bytes32(uint256(uint160(receipt.account))), "indexed account");
            assertEq(log.topics[3], bytes32(uint256(uint8(receipt.status))), "indexed status");
            assertEq(ISleeveModule(module).receiptHash(id), keccak256(log.data), "stored hash is the event's bytes");
        }
        assertEq(found, 1, "one receipt");
    }
}
