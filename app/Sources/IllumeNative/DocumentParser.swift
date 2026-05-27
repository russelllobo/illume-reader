#if os(iOS)
import Foundation
import IllumeCore
import PDFKit
import UIKit
import ZIPFoundation

struct ParsedDocument {
    let book: ReaderBook
    let coverDataURL: String?
}

enum DocumentParser {
    static func parse(data: Data, fileName: String, type: DocumentType) throws -> ParsedDocument {
        switch type {
        case .epub:
            return try parseEpub(data: data, fileName: fileName)
        case .pdf:
            return parsePdf(data: data, fileName: fileName)
        }
    }

    private static func parseEpub(data: Data, fileName: String) throws -> ParsedDocument {
        let archive = try Archive(data: data, accessMode: .read)
        let container = try string(named: "META-INF/container.xml", in: archive)
        let opfPath = captureAttribute("full-path", in: container)
        let opf = try string(named: opfPath, in: archive)
        var book = EpubMetadataExtractor.metadata(opfXML: opf, fileName: fileName)

        let chapterPaths = manifestItemPaths(opf: opf, opfPath: opfPath)
        var paragraphs: [ReaderParagraph] = []
        var chapters: [String] = []

        for chapterPath in chapterPaths {
            guard let html = try? string(named: chapterPath, in: archive) else { continue }
            let extracted = EpubMetadataExtractor.paragraphs(fromHTML: html, chapterTitle: book.title)
            let chapterTitle = extracted.first(where: { $0.kind == .heading })?.text ?? chapterTitle(from: chapterPath, fallback: book.title)
            chapters.append(chapterTitle)
            paragraphs.append(contentsOf: extracted.map { paragraph in
                var copy = paragraph
                copy.id = "epub-\(paragraphs.count)-\(copy.id)"
                copy.chapterIndex = max(0, chapters.count - 1)
                copy.chapterTitle = chapterTitle
                return copy
            })
        }

        book.paragraphs = paragraphs
        book.chapters = chapters.isEmpty ? [book.title] : chapters
        return ParsedDocument(book: book, coverDataURL: coverDataURL(opf: opf, opfPath: opfPath, in: archive))
    }

    private static func chapterTitle(from path: String, fallback: String) -> String {
        let title = URL(fileURLWithPath: path)
            .deletingPathExtension()
            .lastPathComponent
            .replacingOccurrences(of: #"[_-]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return title.isEmpty ? fallback : title.capitalized
    }

    private static func parsePdf(data: Data, fileName: String) -> ParsedDocument {
        guard let pdf = PDFDocument(data: data) else {
            let fallback = ReaderBook(title: fallbackTitle(fileName), fileName: fileName, format: .pdf, paragraphs: [], chapters: [])
            return ParsedDocument(book: fallback, coverDataURL: nil)
        }

        let title = TextCleaning.normaliseSpace(pdf.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String ?? "") == ""
            ? fallbackTitle(fileName)
            : TextCleaning.normaliseSpace(pdf.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String ?? "")
        let author = TextCleaning.normaliseSpace(pdf.documentAttributes?[PDFDocumentAttribute.authorAttribute] as? String ?? "")
        let pageCount = pdf.pageCount
        var pages: [BookPage] = []
        let bookId = UUID()
        let userId = UUID()

        for index in 0..<pageCount {
            guard let page = pdf.page(at: index) else { continue }
            let text = TextCleaning.normaliseSpace(page.string ?? "")
            pages.append(BookPage(bookId: bookId, userId: userId, pageNumber: index + 1, text: text, wordCount: text.split(separator: " ").count))
        }

        let book = PdfTextMapper.readerBook(
            title: title,
            author: author,
            fileName: fileName,
            pageCount: pageCount,
            toc: [],
            pages: pages
        )
        return ParsedDocument(book: book, coverDataURL: pdfCoverDataURL(pdf))
    }

    private static func string(named path: String, in archive: Archive) throws -> String {
        guard let entry = archive[path] else {
            throw CocoaError(.fileNoSuchFile)
        }
        var data = Data()
        _ = try archive.extract(entry) { chunk in
            data.append(chunk)
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func data(named path: String, in archive: Archive) throws -> Data {
        guard let entry = archive[path] else {
            throw CocoaError(.fileNoSuchFile)
        }
        var data = Data()
        _ = try archive.extract(entry) { chunk in
            data.append(chunk)
        }
        return data
    }

    private static func coverDataURL(opf: String, opfPath: String, in archive: Archive) -> String? {
        let items = manifestItems(opf: opf)
        let coverId = capture(opf, pattern: #"<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["'][^>]*/?>"#)
        let coverItem = items.first { item in
            (!coverId.isEmpty && item["id"] == coverId)
                || item["properties"]?.split(separator: " ").contains("cover-image") == true
                || (item["id"]?.localizedCaseInsensitiveContains("cover") == true && item["media-type"]?.hasPrefix("image/") == true)
        }

        guard let href = coverItem?["href"],
              let path = resolvedPath(href: href, relativeTo: opfPath),
              let imageData = try? data(named: path, in: archive) else {
            return nil
        }

        let mimeType = coverItem?["media-type"] ?? imageMimeType(for: path)
        return "data:\(mimeType);base64,\(imageData.base64EncodedString())"
    }

    private static func pdfCoverDataURL(_ pdf: PDFDocument) -> String? {
        guard let firstPage = pdf.page(at: 0) else { return nil }
        let image = firstPage.thumbnail(of: CGSize(width: 420, height: 600), for: .mediaBox)
        guard let data = image.jpegData(compressionQuality: 0.82) else { return nil }
        return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    private static func manifestItemPaths(opf: String, opfPath: String) -> [String] {
        manifestItems(opf: opf).compactMap { item in
            guard let href = item["href"] else {
                return nil
            }
            let mediaType = item["media-type"]?.lowercased()
            guard mediaType == "application/xhtml+xml" || href.range(of: #"\.(xhtml|html|htm)$"#, options: [.regularExpression, .caseInsensitive]) != nil else {
                return nil
            }
            return resolvedPath(href: href, relativeTo: opfPath)
        }
    }

    private static func manifestItems(opf: String) -> [[String: String]] {
        guard let itemRegex = try? NSRegularExpression(pattern: #"<item\b[^>]*/?>"#, options: [.caseInsensitive]),
              let attrRegex = try? NSRegularExpression(pattern: #"([\w:-]+)\s*=\s*["']([^"']*)["']"#, options: [.caseInsensitive]) else {
            return []
        }

        let range = NSRange(opf.startIndex..<opf.endIndex, in: opf)
        return itemRegex.matches(in: opf, range: range).compactMap { itemMatch in
            guard let itemRange = Range(itemMatch.range, in: opf) else { return nil }
            let item = String(opf[itemRange])
            let attrRange = NSRange(item.startIndex..<item.endIndex, in: item)
            return attrRegex.matches(in: item, range: attrRange).reduce(into: [String: String]()) { attrs, attrMatch in
                guard let keyRange = Range(attrMatch.range(at: 1), in: item),
                      let valueRange = Range(attrMatch.range(at: 2), in: item) else {
                    return
                }
                attrs[String(item[keyRange]).lowercased()] = String(item[valueRange])
            }
        }
    }

    private static func resolvedPath(href: String, relativeTo opfPath: String) -> String? {
        let decodedHref = href.removingPercentEncoding ?? href
        guard !decodedHref.isEmpty else { return nil }
        if decodedHref.hasPrefix("/") {
            return String(decodedHref.dropFirst())
        }
        let base = opfPath.split(separator: "/").dropLast().joined(separator: "/")
        return base.isEmpty ? decodedHref : "\(base)/\(decodedHref)"
    }

    private static func imageMimeType(for path: String) -> String {
        switch path.split(separator: ".").last?.lowercased() {
        case "jpg", "jpeg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "gif":
            return "image/gif"
        case "webp":
            return "image/webp"
        default:
            return "image/jpeg"
        }
    }

    private static func capture(_ text: String, pattern: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)),
              let range = Range(match.range(at: 1), in: text) else {
            return ""
        }
        return String(text[range])
    }

    private static func captureAttribute(_ name: String, in text: String) -> String {
        let escaped = NSRegularExpression.escapedPattern(for: name)
        return capture(text, pattern: #"\b\#(escaped)\s*=\s*["']([^"']+)["']"#)
    }

    private static func fallbackTitle(_ fileName: String) -> String {
        fileName
            .replacingOccurrences(of: #"\.(epub|pdf)$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"[-_]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
#endif
