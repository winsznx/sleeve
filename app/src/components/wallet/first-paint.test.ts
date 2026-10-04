// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * D-022 and D-041: no product page outside onboarding loads wagmi, RainbowKit or the Reown SDK on first paint. Next
 * puts a page's static imports in its first-load chunks and an import() in a chunk of its own, so this walks the
 * static import graph from every product route file and the root layout, the way the bundler does, and checks that
 * no wallet package is in it. Imports the compiler erases (import type, or only type bindings) are not followed;
 * import() is recorded, not followed.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCT = path.join(SRC, 'app', '(product)');
const WALLET_PACKAGE = /^(wagmi|@wagmi\/|@rainbow-me\/|@reown\/|@walletconnect\/)/;
const CODE = /\.(ts|tsx|js|jsx|mjs)$/;
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const ROUTE_FILE = /^(page|layout|loading|error|not-found|template)\.tsx$/;

interface Imports {
  statics: string[];
  dynamics: string[];
}

/** An import declaration the compiler drops: `import type`, or one whose every binding is a type. */
function erasedImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined || clause.namedBindings === undefined || ts.isNamespaceImport(clause.namedBindings)) return false;
  const elements = clause.namedBindings.elements;
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

function erasedExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

function importsOf(file: string): Imports {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const imports: Imports = { statics: [], dynamics: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!erasedImport(node)) imports.statics.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!erasedExport(node)) imports.statics.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) imports.dynamics.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

/** A file in app/src for an alias or relative specifier, or null for a package. */
function resolve(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else return null;
  const candidates = [base, ...EXTENSIONS.map((ext) => `${base}${ext}`), ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))];
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (found === undefined) throw new Error(`${specifier} from ${path.relative(SRC, from)} does not resolve`);
  return found;
}

interface Graph {
  files: Set<string>;
  /** Each package reached, with a file that imports it. */
  packages: Map<string, string>;
}

/** Every file and package a static import reaches from the entries. */
function staticGraph(entries: readonly string[]): Graph {
  const graph: Graph = { files: new Set(), packages: new Map() };
  const queue = [...entries];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (graph.files.has(file)) continue;
    graph.files.add(file);
    if (!CODE.test(file)) continue;
    for (const specifier of importsOf(file).statics) {
      const target = resolve(file, specifier);
      if (target === null) graph.packages.set(specifier, path.relative(SRC, file));
      else queue.push(target);
    }
  }
  return graph;
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'onboard' ? [] : routeFiles(full);
    return ROUTE_FILE.test(entry.name) ? [full] : [];
  });
}

function walletPackages(graph: Graph): string[] {
  return [...graph.packages].filter(([name]) => WALLET_PACKAGE.test(name)).map(([name, importer]) => `${name} from ${importer}`);
}

const WALLET = path.join(SRC, 'components', 'wallet');

describe('first paint of the product pages', () => {
  const entries = [path.join(SRC, 'app', 'layout.tsx'), ...routeFiles(PRODUCT)];
  const graph = staticGraph(entries);

  it('covers Home, Payments and every other product page but onboarding', () => {
    const names = entries.map((file) => path.relative(PRODUCT, file));
    expect(names).toEqual(expect.arrayContaining(['home/page.tsx', 'payments/page.tsx', 'send/page.tsx', 'layout.tsx']));
    expect(names.some((name) => name.startsWith('onboard'))).toBe(false);
  });

  it('imports no wallet package: no wagmi, RainbowKit, Reown or WalletConnect', () => {
    expect(walletPackages(graph)).toEqual([]);
  });

  it('reaches the wallet layer, and the wallet code only through its import()', () => {
    expect(graph.files.has(path.join(WALLET, 'wallet-layer.tsx'))).toBe(true);
    for (const heavy of ['wallet-island.tsx', 'wallet-providers.tsx', 'use-wallet.ts', 'config.ts', 'connect-wallet-button.tsx']) {
      expect(graph.files.has(path.join(WALLET, heavy)), heavy).toBe(false);
    }
    expect(importsOf(path.join(WALLET, 'wallet-layer.tsx')).dynamics).toEqual(['./wallet-island']);
  });

  it('would see a wallet package: the island and onboarding reach wagmi and RainbowKit', () => {
    const island = walletPackages(staticGraph([path.join(WALLET, 'wallet-island.tsx')]));
    const onboarding = walletPackages(staticGraph([path.join(PRODUCT, 'onboard', 'layout.tsx')]));
    for (const reached of [island, onboarding]) {
      expect(reached.some((entry) => entry.startsWith('wagmi'))).toBe(true);
      expect(reached.some((entry) => entry.startsWith('@rainbow-me/rainbowkit'))).toBe(true);
    }
  });
});
