# Issuer disclosure, pinned by hash

Sleeve shows the issuer's own status and risk disclosure word for word, with its retrieval date and hash (PRD section 10, build contract copy rules). This folder holds that text, the other blocks that could have been chosen, the raw pages they came from, and the script that rebuilds every text file from those pages.

| File | What it is |
| --- | --- |
| rhj-disclosure.txt | The disclosure Sleeve uses, same bytes as candidate-3.txt. The SleeveModule deployed on 3 October 2026 stores its keccak256 (docs/DEPLOYMENTS.md, Configuration), and the app serves the same bytes at /disclosure/rhj-disclosure.txt. |
| candidate-1.txt to candidate-4.txt | Every block on the Issuer Website that could be read as the issuer's status and risk disclosure. |
| rhj-page.html | Raw HTML of https://docs.robinhood.com/rhj as served. |
| rhj-product-page.html | Raw HTML of https://docs.robinhood.com/rhj/product as served. |
| rhj-restricted-jurisdictions-page.html | Raw HTML of https://docs.robinhood.com/rhj/restricted-jurisdictions as served, the source of the onboarding block list. |
| extract.py | Rebuilds the .txt files from the saved HTML. `--check` compares instead of writing. Python 3 standard library only. |

## Pinned values

| Field | Value |
| --- | --- |
| keccak256 of rhj-disclosure.txt | 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89 |
| sha256 of rhj-disclosure.txt | 9bb00fc01df7700d045cd888a8a92246cee1bca0a0e4eb7166b0c79423ac29bc |
| Size and shape | 2,360 bytes, ASCII only, 4 paragraphs joined by 3 LF bytes, no trailing newline |
| Paragraphs 1 to 3 | https://docs.robinhood.com/rhj/product, the three paragraphs under the page title "Product" |
| Paragraph 4 | https://docs.robinhood.com/rhj, the paragraph under the heading "Regulatory status" |
| Retrieved | 2 October 2026. First fetch 14:54:00 UTC (/rhj) and 14:54:29 UTC (/rhj/product). Saved copies fetched 15:08:01 and 15:08:03 UTC, byte-identical to the first fetch. |

The hashes were computed from the file bytes with the commands below. Output is pasted as returned.

```
$ cast keccak 0x$(xxd -p -c 1000000 docs/disclosure/rhj-disclosure.txt)
0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89

$ cast keccak 0x$(xxd -p docs/disclosure/rhj-disclosure.txt | tr -d '\n')
0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89

$ shasum -a 256 docs/disclosure/rhj-disclosure.txt
9bb00fc01df7700d045cd888a8a92246cee1bca0a0e4eb7166b0c79423ac29bc  docs/disclosure/rhj-disclosure.txt
```

The second keccak form is there for xxd builds that cap `-c`. On this machine (xxd 2025-08-24) both forms print one line and agree.

## Why docs.robinhood.com/rhj is the source

The issuer's Base Prospectus dated 25 June 2026 names this site as the Issuer Website, in its Definitions section:

> “Issuer Website” The website maintained by the Issuer in relation to the Programme and the Products, accessible at: http://docs.robinhood.com/rhj, as may be updated from time to time.

Source: https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf, fetched 2026-10-02T15:00:03Z with `curl -sS -D bp.headers -o rhj_base_prospectus.pdf 'https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf'`, 1,600,342 bytes, `last-modified: Wed, 02 Sep 2026 20:06:38 GMT`, sha256 e3b4697a4831723867f71caaf567af7cdd882bafcd1e1b39d7d5fd338916db46. Text read with `pdftotext -layout`. The definition sits in a two-column table with justified spacing, so the quote joins the term and its definition on one line and collapses the justified gaps to single spaces. The PDF is linked from https://robinhood.com/eu/en/legal/rhj/, the target of the "Disclosures" card on /rhj.

## Candidates

| # | Source block | Covers | Bytes | sha256 | keccak256 |
| --- | --- | --- | --- | --- | --- |
| 1 | /rhj, the one paragraph under "Regulatory status" | The issuer is not regulated, what its Jersey consents do and do not mean | 459 | 343bb24320de7c667842c47b84afa6236b710ec18c8117545f29560305e6a4ec | 0x4e7fd5f65a85c9721e9977c6b4e00ed2fca053aa2ab9793d89250cbc20d179ed |
| 2 | /rhj/product, the three paragraphs between the title "Product" and the heading "Product details" | What a Stock Token is, who issues it, no rights in the underlying, the risk warning, what the prospectus approval does not mean | 1,900 | f5a0b12e5352070cf57e3ecb8ca83cceffa72e20f2b5e5b569c27a4b40951a7a | 0xd471225fa198bb3e4c4ec0b43a3e54159ea4a50cc57c2fa31f7557baed50059f |
| 3 | Candidate 2, then candidate 1 | Both of the above | 2,360 | 9bb00fc01df7700d045cd888a8a92246cee1bca0a0e4eb7166b0c79423ac29bc | 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89 |
| 4 | The legal footer shown on every /rhj page, the paragraph after the copyright line | US Securities Act and Regulation S selling restriction | 613 | 1bae780a8e4411fe48df579378a3ab25b5b9ab803fe0611e62d9d42b38b49033 | 0xfab9b62f4cd22fc9c8588814919c1cf9da6e80fa0e8804fe0128673f2682c481 |

Considered and not saved as candidates:

- The /rhj intro paragraph. It describes the site, not the product or its risk.
- The "Disclaimer" section of https://docs.robinhood.com/chain/stock-tokens. It is a compact status and risk text, but it sits in the developer docs, outside the Issuer Website, and the build contract names docs.robinhood.com/rhj.
- The FAQ answer to "What are Robinhood Stock Tokens?". It repeats the first two sentences of candidate 2 with "tokenized" spelled with a z, and carries no risk warning.

## Recommendation: candidate 3

1. PRD section 10 answers "who stands behind it" from "the issuer named in the disclosure". Candidate 1 never names the issuer. Candidates 2 and 3 do.
2. "Status and risk" lines up with the issuer's own labels. /rhj has a section titled "Regulatory status", and the /rhj card for the Product page reads "What the Product is, key risks, and product details."
3. Only whole blocks are taken. No sentence is dropped from inside a block, so nothing is selected to read better.
4. Candidate 2 comes first because it defines "Product" and "Issuer". Candidate 1 starts "The Issuer is not regulated" and relies on that definition.

The cost is two source pages. A wording change on either page means a new module version with a new hash (PRD section 10). If the owner wants a single source page, candidate 2 is the fallback, and the only thing lost is the statement that the issuer is not regulated. The owner's go for the deploy confirmed candidate 3 (D-028), and the module deployed on 3 October 2026 carries its hash.

## Extraction method

The site is a Vocs static site. The article text is in the HTML the server sends, so no client rendering is involved for these blocks. extract.py parses the saved HTML with Python's html.parser, decodes character references (`&quot;` becomes `"`), collects the `<p>` elements that sit between a given heading anchor and the next heading, and fails if anything other than a paragraph appears in that span. The footer paragraphs come from the `div.rhj-legal-footer` element.

Independent cross-check. The site's JavaScript bundle https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/index--FXM3_nW.js (fetched 2026-10-02T14:55:47Z, 1,397,448 bytes, sha256 3af7bd5503c31a67c744cccbf552845555e0576855476ae04838f323ea7da22c) carries every page's MDX source, URL-encoded, in its route table (`filePath:"rhj/index.mdx"`, `filePath:"rhj/product/index.mdx"`). Paragraphs taken from that source and normalized with the same rule match candidates 1, 2 and 3 byte for byte. The footer text is a string constant in the same bundle, rendered only when the path starts with `/rhj`, and it matches candidate 4 byte for byte.

## Normalization rule

One rule, applied to every candidate:

For each paragraph, take the text content of the `<p>` element with tags removed and character references decoded, replace every run of whitespace (Python `re` `\s`) with one space U+0020, and trim both ends. Join the paragraphs with one LF (U+000A). Encode as UTF-8 without a byte order mark. No trailing newline.

In the blocks above the rule changes nothing inside a paragraph. Every paragraph in the source holds only single U+0020 spaces with no leading or trailing whitespace, so the text is the paragraph's character data exactly as served, and the rule only fixes how paragraphs are joined. All five files are plain ASCII.

## Refresh and release check

Fetch into a fresh temporary folder so the audit copies stay untouched and no earlier download can be reused, then compare:

```
d=$(mktemp -d)
curl -fsS -L -o "$d/rhj-page.html" 'https://docs.robinhood.com/rhj' &&
curl -fsS -L -o "$d/rhj-product-page.html" 'https://docs.robinhood.com/rhj/product' &&
python3 docs/disclosure/extract.py --check --html-dir "$d"
```

Exit code 0 means the issuer text is unchanged. Exit code 1 means it changed, and PRD section 10 applies: ship a new module version with the new hash, and old receipts keep the old one. The script also exits non-zero if a list, table or other non-paragraph block appears inside a candidate section, because that needs a person to look. Both failure paths were tested on edited copies of the saved HTML: one changed character in the "Regulatory status" paragraph gave exit 1 with candidates 1 and 3 reported DIFFERENT, and a list inserted under "Product" gave exit 1 with "#product now holds a li block, review the page by hand". An error page saved in place of an issuer page also gives exit 1, with "no paragraphs found under #regulatory-status", so a blocked fetch can never pass.

## Using the file in the app and the verifier

- Serve rhj-disclosure.txt as a static file and show its bytes as they are, with each LF as a paragraph break. Do not run it through anything that rewrites text, such as smart quotes, hyphenation or Markdown, because the verifier hashes the served bytes.
- The verifiers, packages/verifier and the app's /verify page, compare each receipt's disclosure hash with this file's keccak256, pinned in packages/core/src/disclosure.ts. packages/verifier hashes the raw served bytes instead when its caller passes them. The app checks its embedded copy of the file against the pinned sha256 before a page shows it (app/src/lib/disclosure.ts). None of them hashes the rendered page.
- Attribution line to show with it: issuer text from docs.robinhood.com/rhj/product and docs.robinhood.com/rhj, retrieved 2 October 2026, keccak256 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89.

## Raw files and the commands that fetched them

| File | Command | Retrieved (UTC) | Result | sha256 |
| --- | --- | --- | --- | --- |
| rhj-page.html | `curl -sS -L -o "docs/disclosure/rhj-page.html" -w 'http=%{http_code} size=%{size_download} url=%{url_effective}' "https://docs.robinhood.com/rhj"` | 2026-10-02T15:08:01Z | http=200 size=21718 url=https://docs.robinhood.com/rhj/ | 44e5406175a43a2a8b4039db99fab4a8aea153f23e7f8aa05de5082f3132f298 |
| rhj-product-page.html | same form, URL https://docs.robinhood.com/rhj/product | 2026-10-02T15:08:03Z | http=200 size=19526 url=https://docs.robinhood.com/rhj/product/ | fdb120afd642683ce60e83913e0719efe172d9094dc9422f2a29b97a4fb830c0 |
| rhj-restricted-jurisdictions-page.html | same form, URL https://docs.robinhood.com/rhj/restricted-jurisdictions | 2026-10-02T15:08:06Z | http=200 size=16406 url=https://docs.robinhood.com/rhj/restricted-jurisdictions/ | c4d747394028d4bbc71e2f213538e9b26608b9c7c369f84be760748b6bdf4ef7 |

The first fetch of /rhj, `curl -sS -L -D rhj.headers -o rhj.html -w 'http=%{http_code} size=%{size_download} url=%{url_effective} type=%{content_type}\n' 'https://docs.robinhood.com/rhj'` at 2026-10-02T14:54:00Z, returned a 301 to /rhj/ and then a 200 with `date: Fri, 02 Oct 2026 14:54:01 GMT`, `cache-control: no-cache` and `x-amz-cf-pop: LOS50-P4`. The /rhj/product and /rhj/restricted-jurisdictions first fetches ran at 14:54:29Z and 14:54:35Z. All three first fetches match the saved files byte for byte (`cmp`).

`python3 docs/disclosure/extract.py --check` against the saved HTML exits 0. The release check above, run on a fresh fetch of both pages at 2026-10-02T15:23:09Z, also exits 0.
