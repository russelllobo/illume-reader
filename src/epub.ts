import JSZip from "jszip";

export type ReaderParagraph = {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  kind?: "heading" | "paragraph" | "quote" | "list" | "image";
  pageNumber?: number;
  text: string;
  image?: {
    alt: string;
    src: string;
  };
};

type ReaderBlockKind = NonNullable<ReaderParagraph["kind"]>;

export type ReaderBook = {
  title: string;
  author: string;
  coverUrl: string;
  fileName?: string;
  format: "epub" | "pdf";
  pageCount?: number;
  chapterPageNumbers?: number[];
  chapterPageOffsets?: number[];
  chapterLevels?: number[];
  paragraphs: ReaderParagraph[];
  chapters: string[];
};

type TocEntry = {
  href: string;
  fullHref: string;
  level: number;
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

const getElementTextNS = (root: Element, localNames: string[]) => {
  let current: Element | null = root;
  for (const name of localNames) {
    if (!current) break;
    current = current.getElementsByTagNameNS("*", name)[0] ?? null;
  }
  return current ? normaliseSpace(current.textContent ?? "") : "";
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

const withoutHashOrQuery = (href: string) => href.split("#")[0].split("?")[0];

const normaliseSpace = (text: string) => text.replace(/\s+/g, " ").trim();

const safeDecodePath = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const imageMimeFromPath = (path: string) => {
  const extension = path.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "svg":
    case "svgz":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
};

const getRootFilePath = async (zip: JSZip) => {
  const container = await zip.file("META-INF/container.xml")?.async("text");
  if (!container) throw new Error("This EPUB is missing META-INF/container.xml.");

  const doc = parseXml(container);
  const rootPath = doc.getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  if (!rootPath) throw new Error("This EPUB does not declare a package file.");

  return rootPath;
};

const getChapterTitle = (doc: Document, fallback: string) => {
  const heading = normaliseSpace(doc.querySelector("h1, h2, h3, h4, h5, h6")?.textContent ?? "");
  const title = normaliseSpace(doc.querySelector("title")?.textContent ?? "");
  return heading || title || fallback;
};

const readImageAsDataUrl = async (
  zip: JSZip,
  imagePath: string,
  assetMimeByPath: Map<string, string>
) => {
  const decodedPath = safeDecodePath(imagePath);
  let file = zip.file(imagePath) ?? zip.file(decodedPath);

  if (!file) {
    const fileName = imagePath.split("/").pop();
    if (fileName) {
      const found = Object.keys(zip.files).find(
        (key) => key.split("/").pop() === fileName
      );
      if (found) {
        file = zip.file(found);
      }
    }
  }

  if (!file) return "";

  const mime = assetMimeByPath.get(imagePath) ?? assetMimeByPath.get(decodedPath) ?? imageMimeFromPath(imagePath);
  const data = await file.async("base64");
  return `data:${mime};base64,${data}`;
};

const collectParagraphs = async (
  zip: JSZip,
  docPath: string,
  doc: Document,
  assetMimeByPath: Map<string, string>
) => {
  const nodes = Array.from(
    doc.body?.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, img, image") ?? []
  );
  const blocks: Array<Pick<ReaderParagraph, "image" | "kind" | "text">> = [];

  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();

    if (tag === "img" || tag === "image") {
      const rawSrc =
        node.getAttribute("src") ||
        node.getAttribute("href") ||
        node.getAttribute("xlink:href") ||
        "";
      if (!rawSrc) continue;

      const alt = normaliseSpace(
        node.getAttribute("alt") || node.getAttribute("title") || node.getAttribute("aria-label") || ""
      );
      const src = rawSrc.startsWith("data:") || /^https?:\/\//i.test(rawSrc)
        ? rawSrc
        : await readImageAsDataUrl(zip, resolvePath(docPath, withoutHashOrQuery(rawSrc)), assetMimeByPath);

      if (src) {
        blocks.push({
          kind: "image",
          text: alt,
          image: { alt, src }
        });
      }

      continue;
    }

    const text = normaliseSpace(node.textContent ?? "");
    const kind: ReaderBlockKind = tag.startsWith("h")
      ? "heading"
      : tag === "li"
        ? "list"
        : node.closest("blockquote")
          ? "quote"
          : "paragraph";

    if (kind === "heading" ? text.length > 0 : text.length > 35) {
      blocks.push({ kind, text });
    }
  }

  return blocks;
};

const getElementText = (root: Element, selector: string) =>
  normaliseSpace(root.querySelector(selector)?.textContent ?? "");

const getCoverPath = (opfPath: string, opf: Document, manifest: Map<string, string>) => {
  const metaElements = Array.from(opf.getElementsByTagNameNS("*", "meta"));
  const coverId = metaElements.find((meta) => {
    const name = meta.getAttribute("name")?.toLowerCase();
    const property = meta.getAttribute("property")?.toLowerCase();
    return name === "cover" || property === "cover" || property === "dc:cover";
  })?.getAttribute("content");

  if (coverId) {
    const manifestEntry = Array.from(manifest.entries()).find(
      ([id]) => id.toLowerCase() === coverId.toLowerCase()
    );
    const coverPath = manifestEntry ? manifestEntry[1] : undefined;
    if (coverPath) return coverPath;
  }

  const items = Array.from(opf.getElementsByTagNameNS("*", "item"));
  const coverItem = items.find((item) => {
    const properties = (item.getAttribute("properties") ?? "").split(/\s+/);
    const id = item.getAttribute("id")?.toLowerCase() ?? "";
    const href = item.getAttribute("href")?.toLowerCase() ?? "";
    const mediaType = item.getAttribute("media-type") ?? "";
    return (
      mediaType.startsWith("image/") &&
      (properties.includes("cover-image") ||
        /cover|thumb|front|jacket/i.test(id) ||
        /cover|thumb|front|jacket/i.test(href))
    );
  });

  const href = coverItem?.getAttribute("href");
  return href ? resolvePath(opfPath, href) : "";
};

const getNcxEntries = async (
  zip: JSZip,
  opfPath: string,
  opf: Document,
  manifest: Map<string, string>
) => {
  const spine = opf.getElementsByTagNameNS("*", "spine")[0];
  const tocId = spine?.getAttribute("toc");
  const items = Array.from(opf.getElementsByTagNameNS("*", "item"));
  const ncxPath =
    (tocId ? manifest.get(tocId) : "") ||
    items.find((item) => item.getAttribute("media-type") === "application/x-dtbncx+xml")
      ?.getAttribute("href");

  if (!ncxPath) return [];

  const resolvedNcxPath = tocId ? ncxPath : resolvePath(opfPath, ncxPath);
  const ncxText = await zip.file(resolvedNcxPath)?.async("text");
  if (!ncxText) return [];

  const ncx = parseXml(ncxText);
  const navMap = ncx.getElementsByTagNameNS("*", "navMap")[0];
  if (!navMap) return [];

  const entries: TocEntry[] = [];
  const topPoints = Array.from(navMap.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).localName === "navPoint"
  );
  const fallbackPoints =
    topPoints.length > 0
      ? topPoints
      : Array.from(ncx.getElementsByTagNameNS("*", "navPoint")).filter((point) => {
          const parent = point.parentElement;
          return !parent || parent.localName !== "navPoint";
        });

  const visitPoints = (points: Element[], level: number) => {
    for (const point of points) {
      const title = getElementTextNS(point, ["navLabel", "text"]);
      const src = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
      if (title && src) {
        entries.push({
          href: resolvePath(resolvedNcxPath, withoutHashOrQuery(src)),
          fullHref: resolvePath(resolvedNcxPath, src),
          level,
          title
        });
      }
      const children = Array.from(point.childNodes).filter(
        (node): node is Element => node.nodeType === 1 && (node as Element).localName === "navPoint"
      );
      if (children.length) visitPoints(children, level + 1);
    }
  };

  visitPoints(fallbackPoints, 0);
  return entries;
};

const getNavEntries = async (
  zip: JSZip,
  opfPath: string,
  opf: Document,
  manifest: Map<string, string>
) => {
  const items = Array.from(opf.getElementsByTagNameNS("*", "item"));
  const navItem = items.find((item) =>
    (item.getAttribute("properties") ?? "").split(/\s+/).includes("nav")
  );
  const navHref = navItem?.getAttribute("href");
  if (!navHref) return [];

  const navPath = resolvePath(opfPath, navHref);
  const navText = await zip.file(navPath)?.async("text");
  if (!navText) return [];

  const nav = parseXml(navText, "text/html");
  const tocNav =
    Array.from(nav.querySelectorAll("nav")).find((navEl) => {
      const type = navEl.getAttribute("epub:type") ?? navEl.getAttribute("type") ?? "";
      return type.toLowerCase().includes("toc");
    }) ?? nav.querySelector("nav");
  const rootList = tocNav?.querySelector(":scope > ol, :scope > ul") ?? tocNav?.querySelector("ol, ul");
  if (!rootList) {
    const links = Array.from(nav.querySelectorAll("nav a"));
    return links
      .map((link): TocEntry | null => {
        const title = normaliseSpace(link.textContent ?? "");
        const href = link.getAttribute("href");
        if (!title || !href) return null;
        return {
          href: resolvePath(navPath, withoutHashOrQuery(href)),
          fullHref: resolvePath(navPath, href),
          level: 0,
          title
        };
      })
      .filter((entry): entry is TocEntry => Boolean(entry));
  }

  const entries: TocEntry[] = [];
  const visitList = (list: Element, level: number) => {
    for (const li of Array.from(list.children).filter((el) => el.tagName.toLowerCase() === "li")) {
      const link = li.querySelector(":scope > a");
      const title = normaliseSpace(link?.textContent ?? "");
      const href = link?.getAttribute("href");
      if (title && href) {
        entries.push({
          href: resolvePath(navPath, withoutHashOrQuery(href)),
          fullHref: resolvePath(navPath, href),
          level,
          title
        });
      }
      const nested = li.querySelector(":scope > ol, :scope > ul");
      if (nested) visitList(nested, level + 1);
    }
  };

  visitList(rootList, 0);
  return entries;
};

export const parseEpub = async (file: File): Promise<ReaderBook> => {
  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("This file could not be read as an EPUB. It may be an incomplete download or a web page instead of an ebook file.");
  }

  const opfPath = await getRootFilePath(zip);
  const opfText = await zip.file(opfPath)?.async("text");

  if (!opfText) throw new Error("The EPUB package file could not be read.");

  const opf = parseXml(opfText);
  const manifest = new Map<string, string>();
  const assetMimeByPath = new Map<string, string>();

  const items = Array.from(opf.getElementsByTagNameNS("*", "item"));
  items.forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type");
    if (id && href) {
      const path = resolvePath(opfPath, href);
      manifest.set(id, path);
      if (mediaType?.startsWith("image/")) assetMimeByPath.set(path, mediaType);
    }
  });

  const getMetadataValue = (opfDoc: Document, name: string) => {
    const elements = Array.from(opfDoc.getElementsByTagNameNS("*", name));
    if (elements.length > 0) {
      return normaliseSpace(elements[0].textContent ?? "");
    }
    return "";
  };

  const title = getMetadataValue(opf, "title") || file.name;
  const author = getMetadataValue(opf, "creator");
  const coverPath = getCoverPath(opfPath, opf, manifest);
  const coverUrl = coverPath ? await readImageAsDataUrl(zip, coverPath, assetMimeByPath) : "";

  const spineEl = opf.getElementsByTagNameNS("*", "spine")[0];
  const spineIds = spineEl
    ? Array.from(spineEl.getElementsByTagNameNS("*", "itemref"))
        .map((item) => item.getAttribute("idref"))
        .filter((idref): idref is string => Boolean(idref))
    : [];

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

  const paragraphs: ReaderParagraph[] = [];
  const chapters: string[] = [];
  const chapterLevels: number[] = [];

  const tocIndicesBySpine = new Map<number, number[]>();
  tocBySpine.forEach((entry, tocPosition) => {
    const list = tocIndicesBySpine.get(entry.spineIndex) ?? [];
    list.push(tocPosition);
    tocIndicesBySpine.set(entry.spineIndex, list);
  });

  const fragmentOf = (fullHref: string) => {
    const hash = fullHref.indexOf("#");
    if (hash < 0) return "";
    try {
      return decodeURIComponent(fullHref.slice(hash + 1));
    } catch {
      return fullHref.slice(hash + 1);
    }
  };

  const blockIndexForFragment = (doc: Document, blocks: Element[], fragment: string) => {
    if (!fragment) return -1;
    const target = doc.getElementById(fragment) ?? doc.querySelector(`[id="${fragment.replace(/"/g, "")}"]`);
    if (!target) return -1;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      if (block === target || block.contains(target) || target.contains(block)) return blockIndex;
    }
    let walker: Node | null = target;
    while (walker) {
      const next: Node | null = walker.nextSibling ?? walker.parentElement;
      if (next instanceof Element) {
        const idx = blocks.indexOf(next.closest("h1, h2, h3, h4, h5, h6, p, li") as Element);
        if (idx >= 0) return idx;
      }
      walker = walker.parentElement;
    }
    return -1;
  };

  for (let spineIndex = 0; spineIndex < spineIds.length; spineIndex += 1) {
    const path = manifest.get(spineIds[spineIndex]);
    if (!path) continue;

    const html = await zip.file(path)?.async("text");
    if (!html) continue;

    const doc = parseXml(html, "text/html");
    const chapterParagraphs = await collectParagraphs(zip, path, doc, assetMimeByPath);

    if (!chapterParagraphs.length) continue;

    const tocPositions = tocIndicesBySpine.get(spineIndex) ?? [];
    const blockNodes = Array.from(
      doc.body?.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li") ?? []
    );

    if (!tocPositions.length) {
      if (chapters.length > 0) {
        const chapterIndex = chapters.length - 1;
        const chapterTitle = chapters[chapterIndex];
        chapterParagraphs.forEach((paragraph, paragraphIndex) => {
          paragraphs.push({
            id: `${chapterIndex}-${paragraphs.length}-${paragraphIndex}`,
            chapterIndex,
            chapterTitle,
            kind: paragraph.kind,
            text: paragraph.text,
            image: paragraph.image
          });
        });
        continue;
      }
      const fallbackTitle = getChapterTitle(doc, `Chapter ${chapters.length + 1}`);
      const chapterTitle =
        fallbackTitle === title ? `Chapter ${chapters.length + 1}` : fallbackTitle;
      const chapterIndex = chapters.length;
      chapters.push(chapterTitle);
      chapterLevels.push(0);
      chapterParagraphs.forEach((paragraph, paragraphIndex) => {
        paragraphs.push({
          id: `${chapterIndex}-${paragraphs.length}-${paragraphIndex}`,
          chapterIndex,
          chapterTitle,
          kind: paragraph.kind,
          text: paragraph.text,
          image: paragraph.image
        });
      });
      continue;
    }

    if (tocPositions.length === 1) {
      const tocEntry = tocBySpine[tocPositions[0]];
      const fallbackTitle = getChapterTitle(doc, `Chapter ${chapters.length + 1}`);
      const chapterTitle = tocEntry.title || fallbackTitle;
      const chapterIndex = chapters.length;
      chapters.push(chapterTitle);
      chapterLevels.push(tocEntry.level);
      chapterParagraphs.forEach((paragraph, paragraphIndex) => {
        paragraphs.push({
          id: `${chapterIndex}-${paragraphs.length}-${paragraphIndex}`,
          chapterIndex,
          chapterTitle,
          kind: paragraph.kind,
          text: paragraph.text,
          image: paragraph.image
        });
      });
      continue;
    }

    const starts: number[] = [];
    tocPositions.forEach((tocPosition, order) => {
      if (order === 0) {
        starts.push(0);
        return;
      }
      const fragment = fragmentOf(tocBySpine[tocPosition].fullHref);
      const blockIndex = fragment ? blockIndexForFragment(doc, blockNodes, fragment) : -1;
      starts.push(blockIndex >= 0 ? blockIndex : -1);
    });

    let lastValidStart = 0;
    starts.forEach((start, order) => {
      if (start < 0) {
        starts[order] = lastValidStart;
      } else {
        if (start < lastValidStart) starts[order] = lastValidStart;
        else lastValidStart = start;
      }
    });

    tocPositions.forEach((tocPosition, order) => {
      const tocEntry = tocBySpine[tocPosition];
      const start = starts[order];
      const nextStart =
        order + 1 < starts.length && starts[order + 1] > start
          ? starts[order + 1]
          : order + 1 === starts.length
            ? chapterParagraphs.length
            : start;
      const chapterIndex = chapters.length;
      chapters.push(tocEntry.title);
      chapterLevels.push(tocEntry.level);
      if (nextStart > start) {
        chapterParagraphs.slice(start, nextStart).forEach((paragraph, paragraphIndex) => {
          paragraphs.push({
            id: `${chapterIndex}-${paragraphs.length}-${paragraphIndex}`,
            chapterIndex,
            chapterTitle: tocEntry.title,
            kind: paragraph.kind,
            text: paragraph.text,
            image: paragraph.image
          });
        });
      } else {
        paragraphs.push({
          id: `${chapterIndex}-${paragraphs.length}-heading`,
          chapterIndex,
          chapterTitle: tocEntry.title,
          kind: "heading",
          text: tocEntry.title
        });
      }
    });
  }

  if (!paragraphs.length) {
    throw new Error("No readable paragraphs were found in this EPUB.");
  }

  return {
    title,
    author,
    coverUrl,
    fileName: file.name,
    format: "epub",
    chapterLevels,
    paragraphs,
    chapters
  };
};
