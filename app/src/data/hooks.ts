import type { Address, Rule, RuleInput, TickerId } from '@sleeve/core';
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useDataLayer } from './provider';
import { queryKeys } from './query-keys';
import type {
  AccountOverview,
  ActionPreview,
  BucketView,
  CardData,
  CreateAccountInput,
  CreateCardInput,
  EligibilityInput,
  EligibilityResult,
  Holding,
  InboxItem,
  LedgerView,
  MarketSnapshot,
  OwnerAction,
  PasskeyCredential,
  ReceiptPage,
  ReceiptQuery,
  ReceiptRecord,
  RemoveResult,
  SellQuote,
  SellRequest,
  Session,
  SleeveDataLayer,
  SplitPreview,
  VerifyResult,
  WithdrawRequest,
  WithdrawResult,
} from './types';

/**
 * React bindings for the data layer. Reads are queries keyed by queryKeys; every write invalidates them all,
 * because one owner action can move the ledger, buckets, holdings, inbox and receipts together. Pass undefined
 * for an id or account that is not known yet and the query waits.
 */

type Read<T> = UseQueryResult<T, Error>;
type Write<TInput, TResult> = UseMutationResult<TResult, Error, TInput>;

export function useSession(): Read<Session | null> {
  const layer = useDataLayer();
  return useQuery({ queryKey: queryKeys.session(), queryFn: () => layer.getSession() });
}

export function useMarket(): Read<MarketSnapshot> {
  const layer = useDataLayer();
  return useQuery({ queryKey: queryKeys.market(), queryFn: () => layer.getMarket() });
}

export function useAccount(account: Address | undefined): Read<AccountOverview> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.account(account),
    queryFn: account === undefined ? skipToken : () => layer.getAccount(account),
  });
}

export function useLedger(account: Address | undefined): Read<LedgerView> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.ledger(account),
    queryFn: account === undefined ? skipToken : () => layer.getLedger(account),
  });
}

export function useRule(account: Address | undefined): Read<Rule> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.rule(account),
    queryFn: account === undefined ? skipToken : () => layer.getRule(account),
  });
}

export function useBuckets(account: Address | undefined): Read<BucketView[]> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.buckets(account),
    queryFn: account === undefined ? skipToken : () => layer.getBuckets(account),
  });
}

export function useSplitPreview(account: Address | undefined): Read<SplitPreview> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.splitPreview(account),
    queryFn: account === undefined ? skipToken : () => layer.previewSplit(account),
  });
}

export function useHoldings(account: Address | undefined): Read<Holding[]> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.holdings(account),
    queryFn: account === undefined ? skipToken : () => layer.getHoldings(account),
  });
}

export function useInbox(account: Address | undefined): Read<InboxItem[]> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.inbox(account),
    queryFn: account === undefined ? skipToken : () => layer.getInbox(account),
  });
}

/** Receipts newest first, a page at a time: call fetchNextPage while hasNextPage. */
export function useReceipts(
  query: Partial<Omit<ReceiptQuery, 'cursor'>>,
): UseInfiniteQueryResult<InfiniteData<ReceiptPage, string | undefined>, Error> {
  const layer = useDataLayer();
  const { account } = query;
  return useInfiniteQuery({
    queryKey: queryKeys.receipts(query),
    queryFn:
      account === undefined
        ? skipToken
        : ({ pageParam }: { pageParam: string | undefined }) =>
            layer.listReceipts({ ...query, account, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (page: ReceiptPage) => page.nextCursor ?? undefined,
  });
}

export function useReceipt(id: bigint | undefined): Read<ReceiptRecord | null> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.receipt(id),
    queryFn: id === undefined ? skipToken : () => layer.getReceipt(id),
  });
}

export function useCard(cardId: string | undefined): Read<CardData | null> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.card(cardId),
    queryFn: cardId === undefined ? skipToken : () => layer.getCard(cardId),
  });
}

/** Recomputes on every visit, never from cache: the page exists to check the chain again. */
export function useVerification(id: bigint | undefined): Read<VerifyResult> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.verify(id),
    queryFn: id === undefined ? skipToken : () => layer.verifyReceipt(id),
    staleTime: 0,
    gcTime: 0,
  });
}

/** What a sell would do now. Null while the owner is still choosing. */
export function useSellQuote(request: SellRequest | null): Read<SellQuote> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: queryKeys.sellQuote(request),
    queryFn: request === null ? skipToken : () => layer.getSellQuote(request),
  });
}

/** A write that changes chain state, after which every read is stale. */
function useWrite<TInput, TResult>(
  write: (layer: SleeveDataLayer, input: TInput) => Promise<TResult>,
): Write<TInput, TResult> {
  const layer = useDataLayer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => write(layer, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.all }),
  });
}

/** Onboarding's residency and IP check. It changes nothing, so nothing is invalidated. */
export function useCheckEligibility(): Write<EligibilityInput, EligibilityResult> {
  const layer = useDataLayer();
  return useMutation({ mutationFn: (input: EligibilityInput) => layer.checkEligibility(input) });
}

/** The passkey ceremony that starts a new account. It changes nothing onchain, so nothing is invalidated. */
export function useCreatePasskey(): Write<void, PasskeyCredential> {
  const layer = useDataLayer();
  return useMutation({ mutationFn: () => layer.createPasskey() });
}

export function useCreateAccount(): Write<CreateAccountInput, Session> {
  return useWrite((layer, input: CreateAccountInput) => layer.createAccount(input));
}

export function useSignIn(): Write<void, Session> {
  return useWrite<void, Session>((layer) => layer.signIn());
}

export function useSignOut(): Write<void, void> {
  return useWrite<void, void>((layer) => layer.signOut());
}

export function useSetRule(): Write<RuleInput, Rule> {
  return useWrite((layer, input: RuleInput) => layer.setRule(input));
}

export function usePauseRule(): Write<void, Rule> {
  return useWrite<void, Rule>((layer) => layer.pauseRule());
}

export function useResumeRule(): Write<void, Rule> {
  return useWrite<void, Rule>((layer) => layer.resumeRule());
}

export function useSplit(): Write<void, ReceiptRecord[]> {
  return useWrite<void, ReceiptRecord[]>((layer) => layer.split());
}

export function useSettle(): Write<TickerId, ReceiptRecord> {
  return useWrite((layer, tickerId: TickerId) => layer.settle(tickerId));
}

export function useRelease(): Write<TickerId, ReceiptRecord> {
  return useWrite((layer, tickerId: TickerId) => layer.release(tickerId));
}

export function useSell(): Write<SellRequest, ReceiptRecord[]> {
  return useWrite((layer, request: SellRequest) => layer.sell(request));
}

export function useCreateCard(): Write<CreateCardInput, CardData> {
  return useWrite((layer, input: CreateCardInput) => layer.createCard(input));
}

export function useWithdraw(): Write<WithdrawRequest, WithdrawResult> {
  return useWrite((layer, request: WithdrawRequest) => layer.withdraw(request));
}

export function useRemoveSleeve(): Write<void, RemoveResult> {
  return useWrite<void, RemoveResult>((layer) => layer.removeSleeve());
}

export function useReinstallSleeve(): Write<RuleInput, Rule> {
  return useWrite((layer, rule: RuleInput) => layer.reinstallSleeve(rule));
}

/** An owner action as JSON for a query key, which cannot carry a bigint. */
function actionKey(action: OwnerAction): string {
  return JSON.stringify(action, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
}

/**
 * What an owner action would do now. Read fresh every time it is asked for, never from cache, because the preview
 * stands in front of a signature. Null while there is no action to preview.
 */
export function useActionPreview(action: OwnerAction | null): Read<ActionPreview> {
  const layer = useDataLayer();
  return useQuery({
    queryKey: [...queryKeys.all, 'action-preview', action === null ? null : actionKey(action)],
    queryFn: action === null ? skipToken : () => layer.previewAction(action),
    staleTime: 0,
    gcTime: 0,
  });
}
