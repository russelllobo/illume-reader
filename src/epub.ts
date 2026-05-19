import JSZip from "jszip";

export type ReaderParagraph = {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  kind?: "heading" | "paragraph" | "quote" | "list";
  text: string;
};

type ReaderBlockKind = NonNullable<ReaderParagraph["kind"]>;

export type ReaderBook = {
  title: string;
  author: string;
  paragraphs: ReaderParagraph[];
  chapters: string[];
};

type TocEntry = {
  href: string;
  title: string;
};

const parser = new DOMParser();

const parseXml = (source: string, type: DOMParserSupportedType = "application/xml") =>
  parser.parseFromString(source, type);

const textFrom = (root: ParentNode, selectors: string[]) => {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
};

const resolvePath = (basePath: string, href: string) => {
  const parts = basePath.split("/");
  parts.pop();

  for (const segment of href.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }

  return parts.join("/");
};

const withoutHash = (href: string) => href.split("#")[0];

const normaliseSpace = (text: string) => text.replace(/\s+/g, " ").trim();

const getRootFilePath = async (zip: JSZip) => {
  const container = await zip.file("META-INF/container.xml")?.async("text");
  if (!container) throw new Error("This EPUB is missing META-INF/container.xml.");

  const doc = parseXml(container);
  const rootPath = doc.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootPath) throw new Error("This EPUB does not declare a package file.");

  return rootPath;
};

const getChapterTitle = (doc: Document, fallback: string) => {
  const heading = normaliseSpace(doc.querySelector("h1, h2, h3, h4, h5, h6")?.textContent ?? "");
  const title = normaliseSpace(doc.querySelector("title")?.textContent ?? "");
  return heading || title || fallback;
};

const collectParagraphs = (doc: Document) => {
  const nodes = Array.from(
    doc.body?.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li") ?? []
  );

  return nodes
    .map((node) => {
      const text = normaliseSpace(node.textContent ?? "");
      const tag = node.tagName.toLowerCase();
      const kind: ReaderBlockKind = tag.startsWith("h")
        ? "heading"
        : tag === "li"
          ? "list"
          : node.closest("blockquote")
            ? "quote"
            : "paragraph";

      return { kind, text };
    })
    .filter(({ kind, text }) => (kind === "heading" ? text.length > 0 : text.length > 35));
};

const getElementText = (root: Element, selector: string) =>
  normaliseSpace(root.querySelector(selector)?.textContent ?? "");

const getNcxEntries = async (
  zip: JSZip,
  opfPath: string,
  opf: Document,
  manifest: Map<string, string>
) => {
  const spine = opf.querySelector("spine");
  const tocId = spine?.getAttribute("toc");
  const ncxPath =
    (tocId ? manifest.get(tocId) : "") ||
    Array.from(opf.querySelectorAll("manifest > item"))
      .find((item) => item.getAttribute("media-type") === "application/x-dtbncx+xml")
      ?.getAttribute("href");

  if (!ncxPath) return [];

  const resolvedNcxPath = tocId ? ncxPath : resolvePath(opfPath, ncxPath);
  const ncxText = await zip.file(resolvedNcxPath)?.async("text");
  if (!ncxText) return [];

  const ncx = parseXml(ncxText);

  return Array.from(ncx.querySelectorAll("navPoint"))
    .map((point): TocEntry | null => {
      const title = getElementText(point, "navLabel text");
      const src = point.querySelector("content")?.getAttribute("src");

      if (!title || !src) return null;

      return {
        href: resolvePath(resolvedNcxPath, withoutHash(src)),
        title
      };
    })
    .filter((entry): entry is TocEntry => Boolean(entry));
};

const getNavEntries = async (
  zip: JSZip,
  opfPath: string,
  opf: Document,
  manifest: Map<string, string>
) => {
  const navItem = Array.from(opf.querySelectorAll("manifest > item")).find((item) =>
    (item.getAttribute("properties") ?? "").split(/\s+/).includes("nav")
  );
  const navHref = navItem?.getAttribute("href");
  if (!navHref) return [];

  const navPath = resolvePath(opfPath, navHref);
  const navText = await zip.file(navPath)?.async("text");
  if (!navText) return [];

  const nav = parseXml(navText, "text/html");
  const links = Array.from(nav.querySelectorAll("nav a, nav li a"));

  return links
    .map((link): TocEntry | null => {
      const title = normaliseSpace(link.textContent ?? "");
      const href = link.getAttribute("href");

      if (!title || !href) return null;

      return {
        href: resolvePath(navPath, withoutHash(href)),
        title
      };
    })
    .filter((entry): entry is TocEntry => Boolean(entry));
};

export const parseEpub = async (file: File): Promise<ReaderBook> => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const opfPath = await getRootFilePath(zip);
  const opfText = await zip.file(opfPath)?.async("text");

  if (!opfText) throw new Error("The EPUB package file could not be read.");

  const opf = parseXml(opfText);
  const manifest = new Map<string, string>();

  Array.from(opf.querySelectorAll("manifest > item")).forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, resolvePath(opfPath, href));
  });

  const title = textFrom(opf, ["metadata title", "dc\\:title", "title"]) || file.name;
  const author = textFrom(opf, ["metadata creator", "dc\\:creator", "creator"]);
  const paragraphs: ReaderParagraph[] = [];
  const chapters: string[] = [];

  const spineIds = Array.from(opf.querySelectorAll("spine > itemref"))
    .map((item) => item.getAttribute("idref"))
    .filter((idref): idref is string => Boolean(idref));

  const spinePaths = spineIds
    .map((idref) => manifest.get(idref))
    .filter((path): path is string => Boolean(path));
  const pathToSpineIndex = new Map(spinePaths.map((path, index) => [path, index]));
  const navEntries = await getNavEntries(zip, opfPath, opf, manifest);
  const tocEntries = navEntries.length
    ? navEntries
    : await getNcxEntries(zip, opfPath, opf, manifest);
  const tocBySpine = tocEntries
    .map((entry) => ({
      ...entry,
      spineIndex: pathToSpineIndex.get(entry.href)
    }))
    .filter((entry): entry is TocEntry & { spineIndex: number } => entry.spineIndex !== undefined)
    .sort((a, b) => a.spineIndex - b.spineIndex);

  let currentChapterTitle = "";
  let currentChapterIndex = -1;
  let tocIndex = 0;

  for (let spineIndex = 0; spineIndex < spineIds.length; spineIndex += 1) {
    const path = manifest.get(spineIds[spineIndex]);
    if (!path) continue;

    while (
      tocIndex + 1 < tocBySpine.length &&
      tocBySpine[tocIndex + 1].spineIndex <= spineIndex
    ) {
      tocIndex += 1;
    }

    const html = await zip.file(path)?.async("text");
    if (!html) continue;

    const doc = parseXml(html, "text/html");
    const chapterParagraphs = collectParagraphs(doc);

    if (!chapterParagraphs.length) continue;

    const activeToc = tocBySpine[tocIndex];
    const tocTitle = activeToc && activeToc.spineIndex <= spineIndex ? activeToc.title : "";
    const fallbackTitle = getChapterTitle(doc, `Chapter ${chapters.length + 1}`);
    const chapterTitle =
      tocTitle ||
      (fallbackTitle === title ? `Chapter ${chapters.length + 1}` : fallbackTitle);

    if (chapterTitle !== currentChapterTitle) {
      currentChapterTitle = chapterTitle;
      currentChapterIndex = chapters.length;
      chapters.push(chapterTitle);
    }

    chapterParagraphs.forEach((paragraph, paragraphIndex) => {
      paragraphs.push({
        id: `${currentChapterIndex}-${paragraphs.length}-${paragraphIndex}`,
        chapterIndex: currentChapterIndex,
        chapterTitle,
        kind: paragraph.kind,
        text: paragraph.text
      });
    });
  }

  if (!paragraphs.length) {
    throw new Error("No readable paragraphs were found in this EPUB.");
  }

  return {
    title,
    author,
    paragraphs,
    chapters
  };
};
