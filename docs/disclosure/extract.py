#!/usr/bin/env python3
"""Rebuild the issuer disclosure files from the saved docs.robinhood.com/rhj pages.

    python3 docs/disclosure/extract.py                 write candidate-<n>.txt and rhj-disclosure.txt
    python3 docs/disclosure/extract.py --check         exit 1 if the files on disk differ from a fresh extraction
    python3 docs/disclosure/extract.py --html-dir DIR  read rhj-page.html and rhj-product-page.html from DIR

The candidates and the normalization rule are documented in README.md next to this file.
Standard library only. keccak256 is printed when Foundry's cast is on PATH.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECOMMENDED = 3
HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")
TEXT_BLOCKS = HEADINGS + ("p", "li")
WHITESPACE_RUN = re.compile(r"\s+")


@dataclass(frozen=True)
class Block:
    region: str
    kind: str
    anchor: str | None
    text: str


class PageBlocks(HTMLParser):
    """Flattens the server-rendered article and the RHJ legal footer into text blocks in document order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self._region: str | None = None
        self._footer_div_depth = 0
        self._open_tag: str | None = None
        self._open_anchor: str | None = None
        self._open_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()
        if self._region is None:
            if tag == "article" and "vocs_Content" in classes:
                self._region = "article"
            elif tag == "div" and "rhj-legal-footer" in classes:
                self._region = "footer"
                self._footer_div_depth = 1
            return
        if self._region == "footer" and tag == "div":
            self._footer_div_depth += 1
        if self._open_tag is None and tag in TEXT_BLOCKS:
            self._open_tag, self._open_anchor, self._open_parts = tag, None, []
        elif self._open_tag is not None and tag == "div" and self._open_anchor is None:
            self._open_anchor = attributes.get("id")

    def handle_endtag(self, tag: str) -> None:
        if self._region is None:
            return
        if tag == self._open_tag:
            self.blocks.append(Block(self._region, tag, self._open_anchor, "".join(self._open_parts)))
            self._open_tag = None
        if self._region == "article" and tag == "article":
            self._region = None
        elif self._region == "footer" and tag == "div":
            self._footer_div_depth -= 1
            if self._footer_div_depth == 0:
                self._region = None

    def handle_data(self, data: str) -> None:
        if self._region is None:
            return
        if self._open_tag is not None:
            self._open_parts.append(data)
        elif data.strip():
            self.blocks.append(Block(self._region, "other", None, data))


def parse(path: Path) -> list[Block]:
    parser = PageBlocks()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return parser.blocks


def section_paragraphs(blocks: list[Block], anchor: str) -> list[str]:
    """Paragraphs between the article heading with this anchor and the next heading. Anything else there fails."""
    paragraphs: list[str] = []
    inside = False
    for block in blocks:
        if block.region != "article":
            continue
        if block.kind in HEADINGS:
            if inside:
                break
            inside = block.anchor == anchor
            continue
        if not inside:
            continue
        if block.kind != "p":
            sys.exit(f"#{anchor} now holds a {block.kind} block, review the page by hand: {block.text.strip()[:80]!r}")
        paragraphs.append(block.text)
    if not paragraphs:
        sys.exit(f"no paragraphs found under #{anchor}")
    return paragraphs


def normalize(paragraphs: list[str]) -> bytes:
    return "\n".join(WHITESPACE_RUN.sub(" ", p).strip() for p in paragraphs).encode("utf-8")


def build(html_dir: Path) -> dict[str, bytes]:
    landing = parse(html_dir / "rhj-page.html")
    product = parse(html_dir / "rhj-product-page.html")
    regulatory_status = section_paragraphs(landing, "regulatory-status")
    product_intro = section_paragraphs(product, "product")
    legal_footer = [b.text for b in landing if b.region == "footer" and b.kind == "p"][1:]
    if not legal_footer:
        sys.exit("legal footer paragraphs not found")
    candidates = {
        1: regulatory_status,
        2: product_intro,
        3: product_intro + regulatory_status,
        4: legal_footer,
    }
    files = {f"candidate-{n}.txt": normalize(paragraphs) for n, paragraphs in candidates.items()}
    files["rhj-disclosure.txt"] = files[f"candidate-{RECOMMENDED}.txt"]
    return files


def keccak256(data: bytes) -> str:
    if shutil.which("cast") is None:
        return "cast not on PATH"
    result = subprocess.run(["cast", "keccak", "0x" + data.hex()], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--html-dir", type=Path, default=HERE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    files = build(args.html_dir)
    mismatches = 0
    for name, data in files.items():
        target = HERE / name
        if args.check:
            same = target.exists() and target.read_bytes() == data
            mismatches += not same
            status = "same" if same else "DIFFERENT"
        else:
            target.write_bytes(data)
            status = "written"
        sha256 = hashlib.sha256(data).hexdigest()
        print(f"{name}  {status}  bytes={len(data)}  sha256={sha256}  keccak256={keccak256(data)}")
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
