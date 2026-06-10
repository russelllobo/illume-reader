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
    private struct FormattedText {
        var text: String
        var inlineStyles: [ReaderInlineStyle]
    }

    private struct ActiveInlineStyle: Equatable {
        var bold = false
        var italic = false
        var underline = false
        var strikethrough = false
        var monospace = false
        var superscript = false
        var isSubscript = false
        var smallCaps = false
        var highlighted = false

        var hasFormatting: Bool {
            bold || italic || underline || strikethrough || monospace || superscript || isSubscript || smallCaps || highlighted
        }

        func applying(tag: String) -> ActiveInlineStyle {
            var copy = self
            switch tag {
            case "b", "strong":
                copy.bold = true
            case "i", "em", "cite", "dfn", "var":
                copy.italic = true
            case "u", "ins":
                copy.underline = true
            case "s", "strike", "del":
                copy.strikethrough = true
            case "code", "kbd", "samp", "tt":
                copy.monospace = true
            case "sup":
                copy.superscript = true
                copy.isSubscript = false
            case "sub":
                copy.isSubscript = true
                copy.superscript = false
            case "small":
                copy.smallCaps = true
            case "mark":
                copy.highlighted = true
            default:
                break
            }
            return copy
        }
    }

    private struct StyledCharacter {
        var character: Character
        var style: ActiveInlineStyle
    }

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
        let pattern = #"<(h[1-6]|p|li|blockquote|pre)\b[^>]*>(.*?)</\1>"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else {
            return []
        }

        let nsrange = NSRange(html.startIndex..<html.endIndex, in: html)
        var seenTexts = Set<String>()
        return regex.matches(in: html, range: nsrange).enumerated().compactMap { index, match in
            guard let tagRange = Range(match.range(at: 1), in: html),
                  let bodyRange = Range(match.range(at: 2), in: html) else {
                return nil
            }

            let tag = html[tagRange].lowercased()
            var formatted = formattedText(fromHTMLFragment: String(html[bodyRange]), preservesWhitespace: tag == "pre")
            if tag == "li", !formatted.text.isEmpty {
                formatted.text = "• \(formatted.text)"
                formatted.inlineStyles = formatted.inlineStyles.map { style in
                    var copy = style
                    copy.location += 2
                    return copy
                }
            }
            let text = formatted.text
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
            guard seenTexts.insert(text).inserted else {
                return nil
            }

            return ReaderParagraph(
                id: "epub-\(index)",
                chapterTitle: chapterTitle,
                kind: kind,
                text: text,
                inlineStyles: formatted.inlineStyles
            )
        }
    }

    private static func formattedText(fromHTMLFragment html: String, preservesWhitespace: Bool) -> FormattedText {
        var stack = [ActiveInlineStyle()]
        var characters: [StyledCharacter] = []
        var index = html.startIndex

        func append(_ text: String, style: ActiveInlineStyle) {
            characters.append(contentsOf: text.map { StyledCharacter(character: $0, style: style) })
        }

        while index < html.endIndex {
            guard html[index] == "<",
                  let tagEnd = html[index...].firstIndex(of: ">") else {
                let nextTag = html[index...].firstIndex(of: "<") ?? html.endIndex
                append(decodeHTMLEntities(String(html[index..<nextTag])), style: stack.last ?? ActiveInlineStyle())
                index = nextTag
                continue
            }

            let rawTag = String(html[html.index(after: index)..<tagEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
            let tagName = tagName(from: rawTag)
            if tagName == "br" {
                append("\n", style: stack.last ?? ActiveInlineStyle())
            } else if rawTag.hasPrefix("/") {
                if stack.count > 1 {
                    _ = stack.popLast()
                }
            } else if !rawTag.hasPrefix("!") && !rawTag.hasPrefix("?") && !rawTag.hasSuffix("/") {
                stack.append((stack.last ?? ActiveInlineStyle()).applying(tag: tagName))
            }
            index = html.index(after: tagEnd)
        }

        return normalizedFormattedText(from: characters, preservesWhitespace: preservesWhitespace)
    }

    private static func normalizedFormattedText(from input: [StyledCharacter], preservesWhitespace: Bool) -> FormattedText {
        var output: [StyledCharacter] = []
        var previousWasWhitespace = true

        for item in input {
            if item.character.isWhitespace {
                if preservesWhitespace && item.character == "\n" {
                    if !output.isEmpty, output.last?.character != "\n" {
                        output.append(StyledCharacter(character: "\n", style: item.style))
                    }
                    previousWasWhitespace = true
                } else if !previousWasWhitespace {
                    output.append(StyledCharacter(character: " ", style: item.style))
                    previousWasWhitespace = true
                }
            } else {
                output.append(item)
                previousWasWhitespace = false
            }
        }

        while output.last?.character.isWhitespace == true {
            _ = output.popLast()
        }

        let text = String(output.map(\.character))
        var styles: [ReaderInlineStyle] = []
        var runStart = 0
        var runStyle: ActiveInlineStyle?
        var utf16Offset = 0

        for item in output {
            let length = String(item.character).utf16.count
            if item.style != runStyle {
                appendStyleRun(style: runStyle, start: runStart, end: utf16Offset, to: &styles)
                runStart = utf16Offset
                runStyle = item.style
            }
            utf16Offset += length
        }
        appendStyleRun(style: runStyle, start: runStart, end: utf16Offset, to: &styles)

        return FormattedText(text: text, inlineStyles: styles)
    }

    private static func appendStyleRun(style: ActiveInlineStyle?, start: Int, end: Int, to styles: inout [ReaderInlineStyle]) {
        guard let style, style.hasFormatting, end > start else { return }
        styles.append(
            ReaderInlineStyle(
                location: start,
                length: end - start,
                bold: style.bold,
                italic: style.italic,
                underline: style.underline,
                strikethrough: style.strikethrough,
                monospace: style.monospace,
                superscript: style.superscript,
                isSubscript: style.isSubscript,
                smallCaps: style.smallCaps,
                highlighted: style.highlighted
            )
        )
    }

    private static func tagName(from rawTag: String) -> String {
        let tag = rawTag.hasPrefix("/") ? String(rawTag.dropFirst()) : rawTag
        return tag
            .split(whereSeparator: \.isWhitespace)
            .first?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased() ?? ""
    }

    private static func decodeHTMLEntities(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&rsquo;", with: "'")
            .replacingOccurrences(of: "&lsquo;", with: "'")
            .replacingOccurrences(of: "&rdquo;", with: "\"")
            .replacingOccurrences(of: "&ldquo;", with: "\"")
            .replacingOccurrences(of: "&mdash;", with: "-")
            .replacingOccurrences(of: "&ndash;", with: "-")
            .replacingOccurrences(of: "&hellip;", with: "...")
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
                ?? makeISO8601Formatter(fractionalSeconds: false).date(from: value)
                ?? makeDateOnlyFormatter().date(from: value) {
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

    private static func makeDateOnlyFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}
