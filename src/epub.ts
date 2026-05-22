import JSZip from "jszip";

export type ReaderParagraph = {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  kind?: "heading" | "paragraph" | "quote" | "list" | "image";
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

  return Array.from(ncx.getElementsByTagNameNS("*", "navPoint"))
    .map((point): TocEntry | null => {
      const title = getElementTextNS(point, ["navLabel", "text"]);
      const src = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");

      if (!title || !src) return null;

      return {
        href: resolvePath(resolvedNcxPath, withoutHashOrQuery(src)),
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
  const links = Array.from(nav.querySelectorAll("nav a, nav li a"));

  return links
    .map((link): TocEntry | null => {
      const title = normaliseSpace(link.textContent ?? "");
      const href = link.getAttribute("href");

      if (!title || !href) return null;

      return {
        href: resolvePath(navPath, withoutHashOrQuery(href)),
        title
      };
    })
    .filter((entry): entry is TocEntry => Boolean(entry));
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
  const paragraphs: ReaderParagraph[] = [];
  const chapters: string[] = [];

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
    const chapterParagraphs = await collectParagraphs(zip, path, doc, assetMimeByPath);

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
        text: paragraph.text,
        image: paragraph.image
      });
    });
  }

  if (!paragraphs.length) {
    throw new Error("No readable paragraphs were found in this EPUB.");
  }

  return {
    title,
    author,
    coverUrl,
    paragraphs,
    chapters
  };
};
