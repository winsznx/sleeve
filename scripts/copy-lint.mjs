#!/usr/bin/env node
/**
 * Copy lint over every UI string in app/src: the I12 control in PRD section 11, plus the build contract's copy
 * rules and the Robinhood Chain brand rules (docs/research/issuer-docs.md section 4).
 *
 * A UI string is JSX text, a string literal or a template literal in a .ts, .tsx, .js or .jsx file. Comments,
 * module specifiers, type positions, object keys, directives and attributes that never render (className, id,
 * data-*) are skipped. Test files are skipped. The issuer disclosure is served from a .txt file and is never
 * scanned, so it stays verbatim.
 *
 *   node scripts/copy-lint.mjs [file or directory ...]    defaults to app/src
 *
 * Exit 0 when clean, 1 with findings, 2 when a path cannot be read.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_TARGET = path.join(REPO_ROOT, 'app', 'src');

/**
 * Lines the product shows word for word (app/src/lib/copy.ts). They are taken out of a string before the
 * rules run, so they pass wherever they appear. The app tests check that these match the constants.
 */
export const REQUIRED_LINES = [
  'Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.',
  "Sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and pays cash, not shares. Sleeve offers no redemption.",
];

/** Terms the PRD defines, taken out case-insensitively and only as whole words. */
export const ALLOWED_TERMS = [
  'debt security, not a share',
  'spend share',
  'equity share',
  'share of pay',
  'Robinhood Assets (Jersey) Limited',
];

/**
 * String literals that are code, not copy. PAYLINK is the M1 member of the contract's Trigger enum; code may
 * compare against it, while any label for it must still say it is not available yet.
 */
const CODE_TOKENS = new Set(['PAYLINK']);

/** The words a gated feature's mention must carry in the same string. */
const GATED_LABEL = /not available yet/i;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
// app/src/generated holds embedded copies of files this lint never reads: the issuer's .txt, tokens.css, fonts and logos.
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '__tests__', '__mocks__', 'generated']);

/** JSX attributes whose values never render as text. */
const SILENT_ATTRIBUTES = new Set([
  'as',
  'autoComplete',
  'className',
  'crossOrigin',
  'dir',
  'encType',
  'enterKeyHint',
  'form',
  'htmlFor',
  'id',
  'inputMode',
  'key',
  'lang',
  'method',
  'name',
  'prefetch',
  'rel',
  'role',
  'sizes',
  'src',
  'srcSet',
  'target',
  'type',
]);

/** Intrinsic elements that flow inside a sentence, so their text joins the sentence around them. */
const INLINE_ELEMENTS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
]);

/** Stands in for an expression whose value the lint cannot see. */
const PLACEHOLDER = ' … ';

const VERB_OBJECTS = new Set([
  'a',
  'an',
  'address',
  'by',
  'card',
  'cards',
  'here',
  'image',
  'it',
  'link',
  'links',
  'my',
  'now',
  'on',
  'our',
  'page',
  'payday',
  'payment',
  'proof',
  'qr',
  'receipt',
  'receipts',
  'that',
  'the',
  'them',
  'these',
  'this',
  'those',
  'to',
  'via',
  'week',
  'with',
  'your',
]);

const VERB_LEADS = new Set(['and', 'can', 'click', 'or', 'please', 'tap', 'then', 'to']);

const NOUN_FOLLOWERS = new Set([
  'buyback',
  'buybacks',
  'certificate',
  'certificates',
  'class',
  'classes',
  'count',
  'equivalent',
  'holder',
  'holders',
  'of',
  'ownership',
  'price',
  'prices',
  'split',
  'splits',
  'value',
  'values',
]);

/**
 * @typedef {{ index: number, match: string }} RuleHit
 * @typedef {{ id: string, message: string, find: (text: string) => RuleHit[] }} Rule
 * @typedef {{ rule: string, message: string, index: number, match: string }} TextFinding
 * @typedef {{ text: string, start: number, literal: boolean }} TextUnit
 * @typedef {{ file: string, line: number, column: number, rule: string, message: string, match: string, excerpt: string }} SourceFinding
 */

/**
 * @param {RegExp} pattern
 * @param {string} text
 * @returns {RuleHit[]}
 */
function hits(pattern, text) {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(global)].map((found) => ({ index: found.index ?? 0, match: found[0] }));
}

/**
 * @param {RegExp[]} patterns
 * @returns {(text: string) => RuleHit[]}
 */
function anyOf(patterns) {
  return (text) => patterns.flatMap((pattern) => hits(pattern, text)).sort((a, b) => a.index - b.index);
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function wordBefore(text, index) {
  return /([a-z]+)[\s\u2026]*$/i.exec(text.slice(0, index))?.[1]?.toLowerCase() ?? '';
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function wordAfter(text, index) {
  return /^[\s\u2026]*([a-z]+)/i.exec(text.slice(index))?.[1]?.toLowerCase() ?? '';
}

/**
 * "share" as a verb ("Share card", "Tap to share") is fine. As a noun it calls the token a share.
 * @param {string} text
 * @returns {RuleHit[]}
 */
function findShares(text) {
  return hits(/\bshare(?:s|holders?|holdings?)?\b/i, text).filter(({ index, match }) => {
    if (match.toLowerCase() !== 'share') return true;
    if (text.trim().toLowerCase() === 'share') return false;
    const next = wordAfter(text, index + match.length);
    if (VERB_OBJECTS.has(next)) return false;
    return !(VERB_LEADS.has(wordBefore(text, index)) && !NOUN_FOLLOWERS.has(next));
  });
}

/**
 * "Robinhood" may appear only as "Robinhood Chain" in title case, inside a domain name, in the disclaimer or in
 * the issuer's name. The last two are taken out before the rules run.
 * @param {string} text
 * @returns {RuleHit[]}
 */
function findBareRobinhood(text) {
  return hits(/(?<![\w./@])robinhood(?!\w)/i, text).filter(({ index, match }) => {
    const after = text.slice(index + match.length);
    if (/^\.[a-z]/i.test(after)) return false;
    return !(match === 'Robinhood' && /^ +Chain\b/.test(after));
  });
}

/**
 * Brand rules capitalize "Stock Token". All capitals pass; a lower-case word does not.
 * @param {string} text
 * @returns {RuleHit[]}
 */
function findStockTokenCase(text) {
  return hits(/\bstock\s+tokens?\b/i, text).filter(({ match }) => /^s|\st/.test(match));
}

/**
 * A gated feature may be named only in a string that also says it is not available yet.
 * @param {string} text
 * @returns {RuleHit[]}
 */
function findGatedFeatures(text) {
  if (GATED_LABEL.test(text)) return [];
  return anyOf([
    /\bborrow(?:s|ed|ing|er|ers)?\b/i,
    /\bpay[\s-]?links?\b/i,
    /\bpayment[\s-]links?\b/i,
    /\bbaskets?\b/i,
    /\bcrews?\b/i,
  ])(text);
}

/** @type {Rule[]} */
export const RULES = [
  {
    id: 'share',
    message:
      'Calls the token a share. A Stock Token is a debt security, not a share. Allowed: "spend share", "equity share", "share of pay", the debt security line, and "share" as a verb ("Share card").',
    find: findShares,
  },
  {
    id: 'stock-ownership',
    message: 'Claims ownership of the stock or of the underlying. The owner holds a Stock Token, a debt security.',
    find: anyOf([
      /\bstock\s*ownership\b/i,
      /\bown(?:s|ed|ing)?\s+(?:the\s+|a\s+|any\s+|real\s+|actual\s+)?(?:underlying\s+)?(?:stocks?|underlying)\b(?!\s+tokens?\b)/i,
      /\bownership\s+of\s+(?:the\s+)?(?:underlying|stocks?|shares?)\b/i,
      /\bstockholders?\b/i,
    ]),
  },
  {
    id: 'dividend',
    message: 'Mentions dividends. A Stock Token carries no dividend right; describe the multiplier change instead.',
    find: anyOf([/\bdividends?\b/i]),
  },
  {
    id: 'yield',
    message: 'Yield or APY. Sleeve makes no yield claim.',
    find: anyOf([/\byield(?:s|ed|ing)?\b/i, /\bAPY\b/i]),
  },
  {
    id: 'performance',
    message: 'Return or performance claim. Sleeve makes none (PRD 7.10 and 16).',
    find: anyOf([
      /\breturns\b/i,
      /\btotal\s+return\b/i,
      /\breturn\s+on\s+investment\b/i,
      /\bROI\b/,
      /\bannuali[sz]ed\b/i,
      /\bprofits?\b/i,
      /\boutperform\w*/i,
    ]),
  },
  {
    id: 'best-execution',
    message: 'Best execution or best price claim. Say the premium stayed within the owner\'s cap instead.',
    find: anyOf([/\bbest\s+execution\b/i, /\bbest\s+(?:price|prices|rate|rates)\b/i]),
  },
  {
    id: 'tokenized-stock',
    message: 'Brand rule: write "Stock Tokens", never "tokenized stocks" or "tokenized equities".',
    find: anyOf([/\btokeni[sz]ed\s+(?:US\s+|U\.S\.\s+)?(?:stocks?|equit(?:y|ies)|shares?)\b/i]),
  },
  {
    id: 'hood-chain',
    message: 'Brand rule: write "Robinhood Chain" in full, never "Hood Chain" or another shorthand.',
    find: anyOf([/\bhood\s*chain\b/i, /\bRH\s+Chain\b/i]),
  },
  {
    id: 'bare-robinhood',
    message:
      'Brand rule: "Robinhood" appears only as "Robinhood Chain" in title case, in the disclaimer, or in the issuer name "Robinhood Assets (Jersey) Limited".',
    find: findBareRobinhood,
  },
  {
    id: 'hood-ticker',
    message: 'Brand rule: never reference HOOD or $HOOD.',
    find: anyOf([/(?<![\w$])\$?HOOD(?!\w)/]),
  },
  {
    id: 'stock-token-case',
    message: 'Brand rule: capitalize "Stock Token" and "Stock Tokens".',
    find: findStockTokenCase,
  },
  {
    id: 'partnership',
    message: 'Implies a partnership, affiliation or endorsement. Nothing may imply one; the disclaimer is the only such line.',
    find: anyOf([/\bpartner(?:s|ed|ing|ship|ships)?\b/i, /\bendorse(?:d|s|ment|ments)?\b/i, /\baffiliat(?:e|ed|es|ion)\b/i]),
  },
  {
    id: 'dash',
    message: 'Em dash or en dash. Use a comma, a period or a hyphen.',
    find: anyOf([/[‒-―]/]),
  },
  {
    id: 'gated-feature',
    message:
      'Borrow, the pay link, baskets and crews are not live. Name one only in a string that also says it is "not available yet".',
    find: findGatedFeatures,
  },
];

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {string}
 */
function blankOut(text, pattern) {
  return text.replace(pattern, (found) => ' '.repeat(found.length));
}

const REQUIRED_PATTERNS = REQUIRED_LINES.map((line) => new RegExp(escapeRegExp(line), 'g'));
const ALLOWED_PATTERNS = ALLOWED_TERMS.map((term) => {
  const start = /^\w/.test(term) ? '\\b' : '';
  const end = /\w$/.test(term) ? '\\b' : '';
  return new RegExp(`${start}${escapeRegExp(term)}${end}`, 'gi');
});

/**
 * Same length in, same length out, so indices still point into the original string.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  let out = text.replace(/[   ]/g, ' ').replace(/[‘’]/g, "'");
  for (const pattern of [...REQUIRED_PATTERNS, ...ALLOWED_PATTERNS]) out = blankOut(out, pattern);
  return out;
}

/**
 * Every rule against one UI string.
 * @param {string} text
 * @returns {TextFinding[]}
 */
export function lintText(text) {
  const prepared = normalize(text);
  return RULES.flatMap((rule) =>
    rule.find(prepared).map(({ index, match }) => ({
      rule: rule.id,
      message: rule.message,
      index,
      match: text.slice(index, index + match.length),
    })),
  );
}

const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
});

/**
 * JSX text keeps HTML entities as written; decode the ones copy uses so &mdash; is caught like the character.
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    const name = String(body);
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/**
 * @param {ts.TemplateExpression} node
 * @returns {string}
 */
function templateText(node) {
  return node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join('');
}

/**
 * @param {ts.JsxAttribute} attribute
 * @returns {boolean}
 */
function isSilentAttribute(attribute) {
  const name = attribute.name.getText();
  return SILENT_ATTRIBUTES.has(name) || name.startsWith('data-');
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function inSilentAttribute(node) {
  const parent = node.parent;
  if (ts.isJsxAttribute(parent)) return isSilentAttribute(parent);
  return ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) && isSilentAttribute(parent.parent);
}

/**
 * Whether a string literal can reach the screen. False for code positions.
 * @param {ts.StringLiteral | ts.NoSubstitutionTemplateLiteral} node
 * @returns {boolean}
 */
function isUiString(node) {
  const parent = node.parent;
  if (CODE_TOKENS.has(node.text) || node.text.trim() === '') return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) {
    return false;
  }
  if (ts.isLiteralTypeNode(parent) || ts.isImportTypeNode(parent)) return false;
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return false;
    if (ts.isIdentifier(callee) && callee.text === 'require') return false;
  }
  if (ts.isExpressionStatement(parent) && /^use (?:client|server|strict)$/.test(node.text)) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return false;
  return !inSilentAttribute(node);
}

/**
 * Text a JSX element renders as one run: its text children, literal expressions, and inline elements, with any
 * other expression or block element as a placeholder.
 * @param {ts.NodeArray<ts.JsxChild>} children
 * @returns {string}
 */
function jsxText(children) {
  return children
    .map((child) => {
      if (ts.isJsxText(child)) return child.containsOnlyTriviaWhiteSpaces ? ' ' : decodeEntities(child.text);
      if (ts.isJsxExpression(child)) {
        const expression = child.expression;
        if (expression === undefined) return '';
        if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
        if (ts.isTemplateExpression(expression)) return templateText(expression);
        return PLACEHOLDER;
      }
      if (ts.isJsxFragment(child)) return jsxText(child.children);
      if (ts.isJsxElement(child)) {
        const tag = child.openingElement.tagName.getText();
        return INLINE_ELEMENTS.has(tag) ? jsxText(child.children) : PLACEHOLDER;
      }
      return PLACEHOLDER;
    })
    .join('');
}

/**
 * @param {string} fileName
 * @returns {ts.ScriptKind}
 */
function scriptKind(fileName) {
  const extension = path.extname(fileName);
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (['.js', '.mjs', '.cjs'].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Every UI string in one source file.
 * @param {string} source
 * @param {string} fileName
 * @returns {{ units: TextUnit[], sourceFile: ts.SourceFile }}
 */
function collectUnits(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  /** @type {TextUnit[]} */
  const units = [];
  /** @param {ts.Node} node */
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isUiString(node)) {
      units.push({ text: node.text, start: node.getStart(sourceFile), literal: true });
    } else if (ts.isTemplateExpression(node) && !inSilentAttribute(node)) {
      units.push({ text: templateText(node), start: node.getStart(sourceFile), literal: false });
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const text = jsxText(node.children).replace(/\s+/g, ' ').trim();
      const placeholderOnly = text.replace(/…/g, '').trim() === '';
      if (!placeholderOnly) units.push({ text, start: node.getStart(sourceFile), literal: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { units, sourceFile };
}

/**
 * @param {string} text
 * @param {number} index
 * @param {number} length
 * @returns {string}
 */
function excerpt(text, index, length) {
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + length + 40);
  return `${from > 0 ? '...' : ''}${text.slice(from, to)}${to < text.length ? '...' : ''}`;
}

/**
 * Lints one file's source text. fileName decides the parser (TSX or TS) and labels the findings.
 * @param {string} source
 * @param {string} fileName
 * @returns {SourceFinding[]}
 */
export function lintSource(source, fileName) {
  const { units, sourceFile } = collectUnits(source, fileName);
  /** @type {Map<string, SourceFinding>} */
  const findings = new Map();
  for (const unit of units) {
    for (const finding of lintText(unit.text)) {
      const singleLine = unit.literal && !unit.text.includes('\n');
      const offset = singleLine ? unit.start + 1 + finding.index : unit.start;
      const position = sourceFile.getLineAndCharacterOfPosition(offset);
      const line = position.line + 1;
      const key = `${line}:${finding.rule}:${finding.match.toLowerCase()}`;
      if (findings.has(key)) continue;
      findings.set(key, {
        file: fileName,
        line,
        column: position.character + 1,
        rule: finding.rule,
        message: finding.message,
        match: finding.match,
        excerpt: excerpt(unit.text, finding.index, finding.match.length),
      });
    }
  }
  return [...findings.values()].sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Source files under the given files or directories, sorted. Throws when a path does not exist.
 * @param {string[]} targets
 * @returns {string[]}
 */
export function listSourceFiles(targets) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} target */
  const walk = (target) => {
    const stats = statSync(target);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(target)) {
        if (!SKIPPED_DIRECTORIES.has(entry)) walk(path.join(target, entry));
      }
    } else if (SOURCE_EXTENSIONS.has(path.extname(target)) && !SKIPPED_FILE.test(path.basename(target))) {
      files.push(target);
    }
  };
  for (const target of targets) walk(path.resolve(target));
  return files.sort();
}

/**
 * Lints every source file under the targets. File names in findings are relative to the repo root.
 * @param {string[]} [targets]
 * @returns {{ files: number, findings: SourceFinding[] }}
 */
export function lintPaths(targets = [DEFAULT_TARGET]) {
  const files = listSourceFiles(targets);
  const findings = files.flatMap((file) =>
    lintSource(readFileSync(file, 'utf8'), file).map((finding) => ({
      ...finding,
      file: path.relative(REPO_ROOT, finding.file),
    })),
  );
  return { files: files.length, findings };
}

/**
 * @param {SourceFinding} finding
 * @returns {string}
 */
export function formatFinding(finding) {
  return `${finding.file}:${finding.line}:${finding.column}  ${finding.rule}  "${finding.match}" in "${finding.excerpt}"\n    ${finding.message}`;
}

/**
 * @param {string[]} argv
 * @returns {number} the exit code
 */
export function main(argv) {
  const targets = argv.length > 0 ? argv : [DEFAULT_TARGET];
  let result;
  try {
    result = lintPaths(targets);
  } catch (error) {
    console.error(`copy-lint: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  for (const finding of result.findings) console.error(formatFinding(finding));
  const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const summary = `copy-lint: ${count(result.files, 'file')}, ${count(result.findings.length, 'finding')}`;
  if (result.findings.length > 0) {
    console.error(summary);
    return 1;
  }
  console.log(summary);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
  process.exitCode = main(process.argv.slice(2));
}
