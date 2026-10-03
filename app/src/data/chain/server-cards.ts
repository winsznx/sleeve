import { findCardRow, serviceSupabase } from '@/lib/chain/server-records';

import { DataLayerError } from '../errors';
import type { CardStore, StoredCard } from './cards';

/**
 * Server only: the card page and the card images read a shared card straight from Supabase with the service role.
 * Cards are made through the browser's route, which checks the owner's signature, so this store never creates one.
 */
export function serverCardStore(): CardStore {
  return {
    async get(cardId) {
      const config = serviceSupabase();
      if (config === null) {
        throw new DataLayerError(
          { code: 'MissingConfig', key: 'SUPABASE_SERVICE_ROLE_KEY' },
          'Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local to read shared cards',
        );
      }
      const row = await findCardRow(config, cardId);
      if (row === null) return null;
      const subject: StoredCard['subject'] =
        row.receiptId !== null ? { kind: 'receipt', receiptId: BigInt(row.receiptId) } : { kind: 'week', weekStart: BigInt(row.weekStart ?? '0') };
      return { cardId: row.cardId, account: row.account, subject, showAmounts: row.showAmounts, showProof: row.showProof };
    },
    async create() {
      throw new DataLayerError({ code: 'NotSignedIn' }, 'Cards are made in the browser, where the owner signs them');
    },
  };
}
