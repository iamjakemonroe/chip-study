import { useEffect, useState } from 'react';
import { institutionPrices } from '../lib/api.ts';
import type { InstitutionPrices } from '../lib/institutionPrice.ts';

let known: InstitutionPrices | null = null;
let asking: Promise<InstitutionPrices | null> | null = null;

/** The price for institutions, asked once a visit: undefined until it's known, null if it can't be. */
export function useInstitutionPrices(): InstitutionPrices | null | undefined {
  const [prices, setPrices] = useState<InstitutionPrices | null | undefined>(known ?? undefined);
  useEffect(() => {
    if (known) return;
    asking ??= institutionPrices()
      .then((p) => (known = Object.keys(p).length ? p : null))
      .catch(() => {
        asking = null;
        return null;
      });
    let on = true;
    void asking.then((p) => on && setPrices(p));
    return () => {
      on = false;
    };
  }, []);
  return prices;
}
