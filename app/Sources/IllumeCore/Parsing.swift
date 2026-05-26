import Foundation

public enum TextCleaning {
    public static func normaliseSpace(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func stripTags(_ html: String) -> String {
        normaliseSpace(
            html
                .replacingOccurrences(of: #"<[^>]+>"#, with: " ", options: .regularExpression)
                .replacingOccurrences(of: "&nbsp;", with: " ")
                .replacingOccurrences(of: "&amp;", with: "&")
                .replacingOccurrences(of: "&quot;", with: "\"")
                .replacingOccurrences(of: "&#39;", with: "'")
        )
    }
}

public enum EpubMetadataExtractor {
    public static func metadata(opfXML: String, fileName: String) -> ReaderBook {
        let title = capture(opfXML, pattern: #"<[^>]*title[^>]*>(.*?)</[^>]*title>"#)
        let creator = capture(opfXML, pattern: #"<[^>]*creator[^>]*>(.*?)</[^>]*creator>"#)
        return ReaderBook(
            title: TextCleaning.stripTags(title).isEmpty ? fallbackTitle(fileName) : TextCleaning.stripTags(title),
            author: TextCleaning.stripTags(creator),
            fileName: fileName,
            format: .epub
        )
    }

    public static func paragraphs(fromHTML html: String, chapterTitle: String = "Chapter") -> [ReaderParagraph] {
        let pattern = #"<(h[1-6]|p|li|blockquote)\b[^>]*>(.*?)</\1>"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else {
            return []
        }

        let nsrange = NSRange(html.startIndex..<html.endIndex, in: html)
        return regex.matches(in: html, range: nsrange).enumerated().compactMap { index, match in
            guard let tagRange = Range(match.range(at: 1), in: html),
                  let bodyRange = Range(match.range(at: 2), in: html) else {
                return nil
            }

            let tag = html[tagRange].lowercased()
            let text = TextCleaning.stripTags(String(html[bodyRange]))
            let kind: ReaderParagraph.Kind
            if tag.hasPrefix("h") {
                kind = .heading
            } else if tag == "li" {
                kind = .list
            } else if tag == "blockquote" {
                kind = .quote
            } else {
                kind = .paragraph
            }

            guard kind == .heading ? !text.isEmpty : text.count > 35 else {
                return nil
            }

            return ReaderParagraph(
                id: "epub-\(index)",
                chapterTitle: chapterTitle,
                kind: kind,
                text: text
            )
        }
    }

    private static func fallbackTitle(_ fileName: String) -> String {
        fileName
            .replacingOccurrences(of: #"\.epub$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"[-_]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func capture(_ text: String, pattern: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else {
            return ""
        }
        let nsrange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: nsrange),
              let range = Range(match.range(at: 1), in: text) else {
            return ""
        }
        return String(text[range])
    }
}

public enum PdfTextMapper {
    public static func readerBook(
        title: String,
        author: String = "",
        fileName: String,
        pageCount: Int,
        toc: [PdfTocEntry],
        pages: [BookPage]
    ) -> ReaderBook {
        let sortedPages = pages.sorted { $0.pageNumber < $1.pageNumber }
        let chapters = toc.map(\.title)
        var paragraphs: [ReaderParagraph] = []

        for page in sortedPages {
            let chapterIndex = chapterIndex(forPage: page.pageNumber, toc: toc)
            let chapterTitle = toc.indices.contains(chapterIndex) ? toc[chapterIndex].title : title
            let chunks = splitPageText(page.text)
            for (offset, text) in chunks.enumerated() {
                paragraphs.append(
                    ReaderParagraph(
                        id: "pdf-\(page.pageNumber)-\(offset)",
                        chapterIndex: chapterIndex,
                        chapterTitle: chapterTitle,
                        kind: .paragraph,
                        pageNumber: page.pageNumber,
                        text: text
                    )
                )
            }
        }

        return ReaderBook(
            title: title,
            author: author,
            fileName: fileName,
            format: .pdf,
            pageCount: pageCount,
            chapterPageNumbers: toc.map(\.pageNumber),
            chapterPageOffsets: toc.map(\.pageOffsetRatio),
            paragraphs: paragraphs,
            chapters: chapters
        )
    }

    public static func chapterIndex(forPage pageNumber: Int, toc: [PdfTocEntry]) -> Int {
        guard !toc.isEmpty else { return 0 }
        var index = 0
        for (entryIndex, entry) in toc.enumerated() {
            if entry.pageNumber <= pageNumber {
                index = entryIndex
            } else {
                break
            }
        }
        return index
    }

    public static func splitPageText(_ text: String) -> [String] {
        text
            .components(separatedBy: CharacterSet.newlines)
            .map(TextCleaning.normaliseSpace)
            .filter { $0.count > 35 }
    }
}

public enum IllumeJSON {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = makeISO8601Formatter(fractionalSeconds: true).date(from: value)
                ?? makeISO8601Formatter(fractionalSeconds: false).date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date: \(value)")
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static func makeISO8601Formatter(fractionalSeconds: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter
    }
}
