#!/usr/bin/env node
/**
 * Prints the /pitch deck to pitch/sleeve-pitch.pdf at the repo root, one 1920 by 1080 page per slide.
 *
 *   pnpm --filter @sleeve/app pitch:pdf                      starts its own dev server on port 3123
 *   PITCH_URL=https://trysleeve.xyz/pitch pnpm ... pitch:pdf  prints a running deck instead
 *
 * Success is read back from the file: the page count in the written PDF must equal the slide count on the page.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.resolve(APP_DIR, '..', 'pitch', 'sleeve-pitch.pdf');
const PORT = 3123;
const READY_TIMEOUT_MS = 180_000;

async function waitForServer(url, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not answer within ${READY_TIMEOUT_MS / 1000} s`);
}

function startDevServer() {
  // A separate output folder, so a dev server already running in .next keeps its own (next.config.ts).
  // Its own process group, so stopping it also stops the workers next dev starts.
  return spawn(path.join(APP_DIR, 'node_modules', '.bin', 'next'), ['dev', '-p', String(PORT)], {
    cwd: APP_DIR,
    env: { ...process.env, NEXT_DIST_DIR: '.next-pitch' },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
}

/** Chromium writes each page as an uncompressed object of type /Page. */
function countPdfPages(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

async function main() {
  const server = process.env.PITCH_URL ? null : startDevServer();
  const url = process.env.PITCH_URL ?? `http://localhost:${PORT}/pitch`;
  try {
    await waitForServer(url, Date.now() + READY_TIMEOUT_MS);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const slides = await page.locator('section[aria-label^="Slide "]').count();
      if (slides === 0) throw new Error(`No slides rendered at ${url}`);

      await mkdir(path.dirname(OUT_FILE), { recursive: true });
      await page.pdf({ path: OUT_FILE, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });

      const pages = countPdfPages(await readFile(OUT_FILE));
      if (pages !== slides) throw new Error(`${OUT_FILE} has ${pages} pages for ${slides} slides`);
      console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}: ${pages} pages, one per slide.`);
    } finally {
      await browser.close();
    }
  } finally {
    if (server?.pid !== undefined) process.kill(-server.pid, 'SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
