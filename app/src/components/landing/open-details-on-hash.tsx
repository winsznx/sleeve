'use client';

import { useEffect } from 'react';

function openLinkedDetails(): void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (id === '') return;
  const details = document.getElementById(id)?.closest('details');
  if (details instanceof HTMLDetailsElement) details.open = true;
}

/**
 * A link to a collapsed answer opens it, on arrival and whenever the hash changes. Chromium does this for fragment
 * links on its own; Safari and Firefox may scroll to a closed details element and leave it shut. The URL hash is
 * the external system this effect listens to.
 */
export function OpenDetailsOnHash(): null {
  useEffect(() => {
    openLinkedDetails();
    window.addEventListener('hashchange', openLinkedDetails);
    return () => window.removeEventListener('hashchange', openLinkedDetails);
  }, []);
  return null;
}
