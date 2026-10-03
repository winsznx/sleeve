import type { JSX } from 'react';

import { cx } from './cx';
import { encodeQr, type QrErrorLevel } from './qr';

/** Four light modules around the symbol, as the standard asks, so scanners find its edge. */
const QUIET_ZONE = 4;

/** One path, one run of dark modules per subpath, whole-module coordinates. */
function pathData(modules: readonly boolean[], size: number): string {
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!modules[row * size + col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && modules[row * size + col]) col += 1;
      parts.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`);
    }
  }
  return parts.join('');
}

export interface QRCodeProps {
  /** The exact text to encode, such as the full payment address. */
  value: string;
  /** What the code holds, for screen readers: "QR code of your payment address". */
  label: string;
  errorLevel?: QrErrorLevel;
  /** Sets the rendered size; the code scales to its box. Default 192 px. */
  className?: string;
}

/**
 * A QR code drawn as SVG on the server or the client, with no dependency (./qr.ts). Ink on a white tile, never
 * inverted, because some scanners fail on light-on-dark codes. The value must also be shown as text next to it.
 */
export function QRCode({ value, label, errorLevel = 'M', className }: QRCodeProps): JSX.Element {
  const matrix = encodeQr(value, { errorLevel });
  const extent = matrix.size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className={cx('block size-48 rounded-row bg-surface text-ink', className)}
    >
      <path fill="currentColor" d={pathData(matrix.modules, matrix.size)} />
    </svg>
  );
}
