import { describe, test, expect } from '@jest/globals';
import { normaliseSpace, stripTags, epubParagraphsFromHTML, splitPageText, chapterIndexForPage, hasProAccess, imageLimit, safeDocumentFileName, documentPath } from '../src/lib';

describe('core ports', () => {
  test('normaliseSpace + stripTags', () => {
    expect(normaliseSpace('  a   b\n')).toBe('a b');
    expect(stripTags('<p>Hello&nbsp;&amp;</p>')).toBe('Hello &');
  });

  test('epub paragraphs filter short text', () => {
    const html = '<h1>Title</h1><p>short</p><p>This is a long paragraph with more than thirty five characters.</p>';
    const out = epubParagraphsFromHTML(html, 'Ch');
    expect(out.map((p) => p.kind)).toEqual(['heading', 'paragraph']);
  });

  test('pdf helpers', () => {
    expect(splitPageText('a\nThis is a sufficiently long line of text for the reader view.')).toHaveLength(1);
    expect(chapterIndexForPage(5, [{ pageNumber: 1, pageOffsetRatio: 0, title: 'A' }, { pageNumber: 6, pageOffsetRatio: 0, title: 'B' }])).toBe(0);
  });

  test('billing + storage paths', () => {
    expect(hasProAccess(null)).toBe(false);
    expect(imageLimit(false)).toBe(25);
    expect(imageLimit(true)).toBe(1000);
    expect(safeDocumentFileName('My Book!.epub', 'epub')).toBe('My-Book.epub');
    expect(documentPath('ABC', 'DEF', 'x.epub', 'epub')).toBe('abc/def/x.epub');
  });
});
