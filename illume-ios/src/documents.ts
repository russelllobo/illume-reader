// Port of DocumentParser.swift (EPUB via ZIP + OPF manifest; PDF text comes from backend book_pages).
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { epubMetadata, epubParagraphsFromHTML, pdfReaderBook } from './lib';
import type { BookPage, PdfTocEntry, ReaderBook } from './types';

export interface ParsedDocument {
  book: ReaderBook;
  coverDataUrl?: string | null;
}

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data as any);
}

function mimeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

function base64Of(data: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  // btoa exists in Expo Hermes; fallback for safety
  if (typeof btoa !== 'undefined') return btoa(binary);
  const g = globalThis as any;
  return g.Buffer ? g.Buffer.from(binary, 'binary').toString('base64') : '';
}

function resolve(href: string, opfPath: string): string {
  const decoded = decodeURIComponent(href.split('#')[0].split('?')[0]);
  if (!decoded) return '';
  if (decoded.startsWith('/')) return decoded.slice(1);
  const base = opfPath.split('/').slice(0, -1).join('/');
  return base ? `${base}/${decoded}` : decoded;
}

export async function parseEpub(data: Uint8Array, fileName: string): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(data as any);
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Invalid EPUB: container.xml missing');
  const container = await containerFile.async('string');
  const opfPath = /full-path="([^"]+)"/i.exec(container)?.[1];
  if (!opfPath) throw new Error('Invalid EPUB: OPF path missing');
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('Invalid EPUB: OPF missing');
  const opf = await opfFile.async('string');

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const opfJson: any = parser.parse(opf);
  const pkg = opfJson.package ?? opfJson['opf:package'] ?? {};
  const manifest = pkg.manifest?.item ?? [];
  const items = (Array.isArray(manifest) ? manifest : [manifest]).map((it: any) => ({
    href: String(it.href ?? ''),
    mediaType: String(it['media-type'] ?? it.mediaType ?? ''),
    properties: String(it.properties ?? ''),
    id: String(it.id ?? ''),
  }));

  let book = epubMetadata(opf, fileName);

  // Spine order preferred; fall back to xhtml manifest order.
  const spineRefs: string[] = (() => {
    const refs = pkg.spine?.itemref;
    if (!refs) return [];
    const arr = Array.isArray(refs) ? refs : [refs];
    return arr.map((r: any) => String(r.idref ?? ''));
  })();
  const byId = new Map(items.map((i) => [i.id, i]));
  const chapterPaths: string[] = [];
  if (spineRefs.length > 0) {
    for (const id of spineRefs) {
      const item = byId.get(id);
      if (item?.href && /\.(xhtml|html|htm)$/i.test(item.href)) chapterPaths.push(resolve(item.href, opfPath));
    }
  } else {
    for (const item of items) {
      if (item.mediaType === 'application/xhtml+xml' && /\.(xhtml|html|htm)$/i.test(item.href)) {
        chapterPaths.push(resolve(item.href, opfPath));
      }
    }
  }

  const paragraphs: ReaderBook['paragraphs'] = [];
  const chapters: string[] = [];
  for (const path of chapterPaths) {
    const f = zip.file(path);
    if (!f) continue;
    const html = await f.async('string');
    const extracted = epubParagraphsFromHTML(html, book.title);
    const heading = extracted.find((p) => p.kind === 'heading')?.text;
    if (heading) chapters.push(heading);
    extracted.forEach((p) => {
      paragraphs.push({ ...p, id: `epub-${paragraphs.length}-${p.id}`, chapterIndex: Math.max(0, chapters.length - 1) });
    });
  }
  book = { ...book, paragraphs, chapters: chapters.length ? chapters : [book.title] };

  // Cover: meta name=cover -> id, or properties=cover-image, or id contains cover + image mime.
  const coverId = /<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i.exec(opf)?.[1] ?? '';
  const coverItem = items.find(
    (it) =>
      (!!coverId && it.id === coverId) ||
      it.properties.split(' ').includes('cover-image') ||
      (it.id.toLowerCase().includes('cover') && it.mediaType.startsWith('image/'))
  );
  let coverDataUrl: string | null = null;
  if (coverItem?.href) {
    const p = resolve(coverItem.href, opfPath);
    const f = zip.file(p);
    if (f) {
      const bytes = new Uint8Array(await f.async('uint8array'));
      coverDataUrl = `data:${coverItem.mediaType || mimeFor(p)};base64,${base64Of(bytes)}`;
    }
  }
  return { book, coverDataUrl };
}

export function pdfBookFromPages(opts: {
  title: string;
  author?: string;
  fileName: string;
  pageCount: number;
  toc: PdfTocEntry[];
  pages: BookPage[];
}): ReaderBook {
  return pdfReaderBook(opts);
}

export function parseFileNameType(fileName: string): 'epub' | 'pdf' {
  return fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub';
}
