import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';

/** The families and weights docs/DESIGN.md section 4 sets. tokens.css reads both variables on :root. */
export const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});
