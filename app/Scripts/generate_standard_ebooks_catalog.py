#!/usr/bin/env python3
"""Generate the Illume curated Standard Ebooks catalog from public subject pages."""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen


BASE_URL = "https://standardebooks.org"
SUBJECTS = [
    ("adventure", "Adventure"),
    ("autobiography", "Autobiography"),
    ("biography", "Biography"),
    ("childrens", "Children's"),
    ("comedy", "Comedy"),
    ("drama", "Drama"),
    ("fantasy", "Fantasy"),
    ("fiction", "Fiction"),
    ("horror", "Horror"),
    ("memoir", "Memoir"),
    ("mystery", "Mystery"),
    ("nonfiction", "Nonfiction"),
    ("philosophy", "Philosophy"),
    ("poetry", "Poetry"),
    ("satire", "Satire"),
    ("science-fiction", "Science Fiction"),
    ("shorts", "Shorts"),
    ("spirituality", "Spirituality"),
    ("travel", "Travel"),
]


@dataclass
class SubjectEntry:
    page_url: str
    title: str
    author: str
    cover_url: str


@dataclass
class CatalogEntry:
    id: str
    title: str
    author: str
    cover_url: str
    download_url: str
    source_page_url: str
    summary: str
    genres: list[str] = field(default_factory=list)


class SubjectPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[SubjectEntry] = []
        self._in_book = False
        self._book_url = ""
        self._cover_url = ""
        self._title = ""
        self._author = ""
        self._capture_title = False
        self._capture_author = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "li" and values.get("typeof") == "schema:Book":
            self._in_book = True
            self._book_url = urljoin(BASE_URL, values.get("about", "") or "")
            self._cover_url = ""
            self._title = ""
            self._author = ""
            return

        if not self._in_book:
            return

        if tag == "img" and not self._cover_url:
            self._cover_url = urljoin(BASE_URL, values.get("src", "") or "")
        elif tag == "span" and values.get("property") == "schema:name":
            self._capture_title = not self._title
            self._capture_author = bool(self._title) and not self._author

    def handle_data(self, data: str) -> None:
        if not self._in_book:
            return
        text = " ".join(data.split())
        if not text:
            return
        if self._capture_title:
            self._title = text
        elif self._capture_author:
            self._author = text

    def handle_endtag(self, tag: str) -> None:
        if tag == "span":
            self._capture_title = False
            self._capture_author = False
        elif tag == "li" and self._in_book:
            if self._book_url and self._title and self._author:
                self.entries.append(
                    SubjectEntry(
                        page_url=self._book_url,
                        title=self._title,
                        author=self._author,
                        cover_url=self._cover_url,
                    )
                )
            self._in_book = False


class DetailPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.summary = ""
        self.download_url = ""
        self.cover_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "meta":
            if values.get("property") == "schema:description" and not self.summary:
                self.summary = values.get("content", "") or self.summary
            elif values.get("property") == "schema:image":
                self.cover_url = urljoin(BASE_URL, values.get("content", "") or "") or self.cover_url
            return

        if tag == "a" and values.get("property") == "schema:contentUrl":
            href = values.get("href", "") or ""
            css_class = values.get("class", "") or ""
            if not self.download_url and href.endswith(".epub") and "kepub" not in href and "advanced" not in href and "epub" in css_class:
                self.download_url = urljoin(BASE_URL, href)


def fetch(url: str) -> str:
    request = Request(url, headers={"User-Agent": "Illume catalog generator (public Standard Ebooks pages)"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def parse_subject(slug: str) -> list[SubjectEntry]:
    parser = SubjectPageParser()
    parser.feed(fetch(f"{BASE_URL}/subjects/{slug}?sort=popularity"))
    return parser.entries[:10]


def parse_detail(url: str) -> tuple[str, str, str]:
    parser = DetailPageParser()
    parser.feed(fetch(url))
    if not parser.download_url:
        raise RuntimeError(f"No compatible epub found for {url}")
    return parser.summary, parser.download_url, parser.cover_url


def swift_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    escaped = escaped.replace("\n", "\\n").replace("\r", "")
    return f'"{escaped}"'


def generate_catalog() -> list[CatalogEntry]:
    entries_by_url: dict[str, CatalogEntry] = {}
    for slug, genre in SUBJECTS:
        print(f"Fetching {genre}...", file=sys.stderr)
        for subject_entry in parse_subject(slug):
            if subject_entry.page_url not in entries_by_url:
                time.sleep(0.08)
                summary, download_url, detail_cover_url = parse_detail(subject_entry.page_url)
                identifier = subject_entry.page_url.removeprefix(f"{BASE_URL}/ebooks/").replace("/", "-")
                entries_by_url[subject_entry.page_url] = CatalogEntry(
                    id=identifier,
                    title=html.unescape(subject_entry.title),
                    author=html.unescape(subject_entry.author),
                    cover_url=detail_cover_url or subject_entry.cover_url,
                    download_url=download_url,
                    source_page_url=subject_entry.page_url,
                    summary=html.unescape(summary),
                )
            entry = entries_by_url[subject_entry.page_url]
            if genre not in entry.genres:
                entry.genres.append(genre)
    return sorted(entries_by_url.values(), key=lambda entry: (entry.title.lower(), entry.author.lower()))


def render_swift(entries: list[CatalogEntry]) -> str:
    lines = [
        "// Generated by Scripts/generate_standard_ebooks_catalog.py.",
        "// Source: public Standard Ebooks subject pages sorted by popularity.",
        "",
        "#if os(iOS)",
        "import Foundation",
        "",
        "extension ClassicCatalog {",
        "    static let books: [ClassicBook] = [",
    ]
    for entry in entries:
        lines.extend(
            [
                "        ClassicBook(",
                f"            id: {swift_string(entry.id)},",
                f"            title: {swift_string(entry.title)},",
                f"            author: {swift_string(entry.author)},",
                f"            coverResourceName: {swift_string(entry.id)},",
                f"            coverUrl: URL(string: {swift_string(entry.cover_url)}),",
                f"            downloadUrl: URL(string: {swift_string(entry.download_url)})!,",
                f"            sourcePageUrl: URL(string: {swift_string(entry.source_page_url)})!,",
                f"            genres: [{', '.join(swift_string(genre) for genre in entry.genres)}],",
                f"            summary: {swift_string(entry.summary)}",
                "        ),",
            ]
        )
    lines.extend(
        [
            "    ]",
            "}",
            "#endif",
            "",
        ]
    )
    return "\n".join(lines)


def validate_swift(source: str) -> None:
    required = [
        "downloadUrl: URL(string:",
        "sourcePageUrl: URL(string:",
        "genres: [",
        ".epub",
    ]
    for needle in required:
        if needle not in source:
            raise RuntimeError(f"Generated catalog is missing {needle}")
    if re.search(r'title: ""|author: ""|genres: \[\]', source):
        raise RuntimeError("Generated catalog has empty required fields")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="Sources/IllumeNative/ClassicCatalog.generated.swift",
        help="Swift file to write.",
    )
    args = parser.parse_args()

    entries = generate_catalog()
    source = render_swift(entries)
    validate_swift(source)
    Path(args.output).write_text(source, encoding="utf-8")
    print(f"Wrote {len(entries)} unique Standard Ebooks catalog entries to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
