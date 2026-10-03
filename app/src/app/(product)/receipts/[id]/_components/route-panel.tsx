import type { JSX } from 'react';

import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { PoolRoute } from '../../_components/pool-route';
import { feeTierWords } from '../../_lib/pool';
import type { RouteModel } from '../receipt-panels';
import { Fact, FactGrid, ReceiptPanel } from './fact';

/**
 * The route a buy or sale took (PRD 7.4): the pool, its allowlist standing and fee tier, the venue, the trigger's
 * quote and the least the swap would accept. When the guard stopped first, the route is the one the trigger named
 * and the panel says no swap ran.
 */
export interface RoutePanelProps {
  model: RouteModel;
  symbol: string;
  /** The block explorer, when the data comes from the chain. */
  explorerBase: string | null;
}

export function RoutePanel({ model, symbol, explorerBase }: RoutePanelProps): JSX.Element {
  const pool = model.pool;
  return (
    <ReceiptPanel
      id="action-route"
      title="Route"
      aside={model.venue === null ? 'No swap ran' : `${model.venue}, one hop`}
      intro={model.swapRan ? undefined : 'No swap ran. This is the pool the trigger named. The guard stopped before any swap.'}
    >
      <PoolRoute
        className="mt-5 max-w-reading"
        from={model.from}
        to={model.to}
        venue={model.venue}
        fee={pool?.fee ?? null}
        allowlisted={pool?.allowlisted ?? false}
        planned={!model.swapRan}
      />
      <FactGrid className="mt-5 border-t border-border pt-5">
        {pool === null ? null : (
          <Fact
            term="Pool"
            className="sm:col-span-2"
            note={
              <span className={cx('inline-flex items-center gap-1 font-medium', pool.allowlisted ? 'text-success' : 'text-danger')}>
                <Icon name={pool.allowlisted ? 'check' : 'alert'} className="size-4" />
                {pool.allowlisted ? `On the ${symbol} pool allowlist` : `Not on the ${symbol} pool allowlist`}
              </span>
            }
          >
            <span className="flex items-start gap-1">
              <span className="min-w-0 flex-1 break-all py-px font-mono text-mono-s">{pool.address}</span>
              <CopyButton value={pool.address} label="Copy pool address" className="-my-3 -mr-2.5" />
            </span>
            {explorerBase === null ? null : (
              <a
                href={`${explorerBase}/address/${pool.address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-touch items-center gap-1 font-medium text-link underline underline-offset-4 hover:text-link-hover"
              >
                View on the explorer
                <Icon name="external" className="size-4" />
              </a>
            )}
          </Fact>
        )}
        {pool === null || pool.fee === null ? null : (
          <Fact term="Fee tier" note="Set when the pool was allowlisted. The all-in price already includes it.">
            {feeTierWords(pool.fee)}
          </Fact>
        )}
        {model.venue === null ? null : (
          <Fact term="Venue">
            {model.venue} {model.venuePath}
          </Fact>
        )}
        {model.from.amount === null ? null : <Fact term="In">{model.from.amount}</Fact>}
        {model.to.amount === null ? null : <Fact term="Out">{model.to.amount}</Fact>}
        {model.quote === null ? null : <Fact term="Quote from the trigger">{model.quote}</Fact>}
        {model.minOut === null ? null : (
          <Fact term="Least accepted" note="The swap reverts below this, and nothing moves.">
            {model.minOut}
          </Fact>
        )}
      </FactGrid>
    </ReceiptPanel>
  );
}
