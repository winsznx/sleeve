import type { JSX } from 'react';

import { formatUtc } from '@/components/ui/format-time';

import { isoTime } from '../../_lib/register';
import type { PriceModel } from '../receipt-panels';
import { Fact, FactGrid, ReceiptPanel } from './fact';

/**
 * The market data the guard read, as the receipt stores it (PRD 10): the Chainlink round of the Stock Token's feed
 * with its answer and time, the USDG/USD round, and the issuer's multiplier. The verifier re-reads each round with
 * getRoundData, so the ids are machine values, set in mono.
 */
export function GuardReads({ model }: { model: PriceModel }): JSX.Element {
  return (
    <ReceiptPanel id="action-rounds" title="What the guard read" headingLevel={3} aside="Chainlink rounds">
      <FactGrid className="mt-4">
        <Fact term={`${model.symbol} feed round`} mono note={model.round} className="sm:col-span-2">
          {model.roundId.toString()}
        </Fact>
        <Fact term="Answer" note={<>Published <time dateTime={isoTime(model.referenceAt)}>{formatUtc(model.referenceAt)}</time></>}>
          <span className="tabular-nums">{model.reference}</span> USD per {model.symbol}
        </Fact>
        {model.multiplier === null ? null : (
          <Fact term="Multiplier when read" mono note="The issuer's uiMultiplier. The Chainlink price already includes it.">
            {model.multiplier}
          </Fact>
        )}
        {model.usdg === null ? null : (
          <>
            <Fact term="USDG/USD round" mono note={model.usdg.round} className="sm:col-span-2">
              {model.usdg.roundId.toString()}
            </Fact>
            <Fact term="USDG/USD answer">
              <span className="tabular-nums">{model.usdg.answer}</span> USD per USDG
            </Fact>
          </>
        )}
      </FactGrid>
    </ReceiptPanel>
  );
}
