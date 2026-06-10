import Foundation

public enum DocumentType: String, Codable, Sendable {
    case epub
    case pdf
}

public enum ProcessingStatus: String, Codable, Sendable {
    case ready
    case queued
    case processing
    case processed
    case failed
}

public enum ReaderImageStyle: String, Codable, CaseIterable, Sendable {
    case cartoon
    case cute
}

public struct PdfTocEntry: Codable, Equatable, Sendable {
    public var pageNumber: Int
    public var pageOffsetRatio: Double
    public var title: String

    public init(pageNumber: Int, pageOffsetRatio: Double = 0, title: String) {
        self.pageNumber = pageNumber
        self.pageOffsetRatio = pageOffsetRatio
        self.title = title
    }
}

public struct PdfPageMetric: Codable, Equatable, Sendable {
    public var height: Double
    public var width: Double

    public init(height: Double, width: Double) {
        self.height = height
        self.width = width
    }
}

public struct BookRow: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var userId: UUID
    public var title: String
    public var author: String
    public var coverUrl: String?
    public var documentType: DocumentType
    public var storagePath: String
    public var fileName: String
    public var fileSize: Int
    public var mimeType: String
    public var pageCount: Int?
    public var paragraphCount: Int
    public var chapterCount: Int
    public var pdfPageMetrics: [PdfPageMetric]
    public var pdfToc: [PdfTocEntry]
    public var processingStatus: ProcessingStatus
    public var processingError: String?
    public var currentIndex: Int
    public var currentPage: Int?
    public var lastOpenedAt: Date?
    public var createdAt: Date
    public var updatedAt: Date

    private enum CodingKeys: String, CodingKey {
        case id
        case userId
        case title
        case author
        case coverUrl
        case documentType
        case storagePath
        case fileName
        case fileSize
        case mimeType
        case pageCount
        case paragraphCount
        case chapterCount
        case pdfPageMetrics
        case pdfToc
        case processingStatus
        case processingError
        case currentIndex
        case currentPage
        case lastOpenedAt
        case createdAt
        case updatedAt
    }

    public init(
        id: UUID,
        userId: UUID,
        title: String,
        author: String = "",
        coverUrl: String? = nil,
        documentType: DocumentType = .epub,
        storagePath: String,
        fileName: String,
        fileSize: Int,
        mimeType: String,
        pageCount: Int? = nil,
        paragraphCount: Int,
        chapterCount: Int,
        pdfPageMetrics: [PdfPageMetric] = [],
        pdfToc: [PdfTocEntry] = [],
        processingStatus: ProcessingStatus = .ready,
        processingError: String? = nil,
        currentIndex: Int = 0,
        currentPage: Int? = 1,
        lastOpenedAt: Date? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.title = title
        self.author = author
        self.coverUrl = coverUrl
        self.documentType = documentType
        self.storagePath = storagePath
        self.fileName = fileName
        self.fileSize = fileSize
        self.mimeType = mimeType
        self.pageCount = pageCount
        self.paragraphCount = paragraphCount
        self.chapterCount = chapterCount
        self.pdfPageMetrics = pdfPageMetrics
        self.pdfToc = pdfToc
        self.processingStatus = processingStatus
        self.processingError = processingError
        self.currentIndex = currentIndex
        self.currentPage = currentPage
        self.lastOpenedAt = lastOpenedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let documentType = container.decodeEnumIfPresent(DocumentType.self, forKey: .documentType) ?? .epub
        let fileName = container.decodeStringIfPresent(forKey: .fileName) ?? (documentType == .pdf ? "document.pdf" : "book.epub")
        let now = Date()

        id = try container.decode(UUID.self, forKey: .id)
        userId = try container.decode(UUID.self, forKey: .userId)
        title = container.decodeStringIfPresent(forKey: .title) ?? fileName
        author = container.decodeStringIfPresent(forKey: .author) ?? ""
        coverUrl = container.decodeStringIfPresent(forKey: .coverUrl)
        self.documentType = documentType
        storagePath = container.decodeStringIfPresent(forKey: .storagePath) ?? ""
        self.fileName = fileName
        fileSize = container.decodeIntIfPresent(forKey: .fileSize) ?? 0
        mimeType = container.decodeStringIfPresent(forKey: .mimeType) ?? (documentType == .pdf ? "application/pdf" : "application/epub+zip")
        pageCount = container.decodeIntIfPresent(forKey: .pageCount)
        paragraphCount = container.decodeIntIfPresent(forKey: .paragraphCount) ?? 0
        chapterCount = container.decodeIntIfPresent(forKey: .chapterCount) ?? 0
        pdfPageMetrics = container.decodeJSONBackedArrayIfPresent(PdfPageMetric.self, forKey: .pdfPageMetrics) ?? []
        pdfToc = container.decodeJSONBackedArrayIfPresent(PdfTocEntry.self, forKey: .pdfToc) ?? []
        processingStatus = container.decodeEnumIfPresent(ProcessingStatus.self, forKey: .processingStatus) ?? .ready
        processingError = container.decodeStringIfPresent(forKey: .processingError)
        currentIndex = container.decodeIntIfPresent(forKey: .currentIndex) ?? 0
        currentPage = container.decodeIntIfPresent(forKey: .currentPage)
        lastOpenedAt = try container.decodeIfPresent(Date.self, forKey: .lastOpenedAt)
        createdAt = (try container.decodeIfPresent(Date.self, forKey: .createdAt)) ?? now
        updatedAt = (try container.decodeIfPresent(Date.self, forKey: .updatedAt)) ?? createdAt
    }
}

private extension KeyedDecodingContainer {
    func decodeStringIfPresent(forKey key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            return value
        }
        return nil
    }

    func decodeIntIfPresent(forKey key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) {
            return value
        }
        if let value = try? decodeIfPresent(Double.self, forKey: key) {
            return Int(value)
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            return Int(value)
        }
        return nil
    }

    func decodeEnumIfPresent<Value: RawRepresentable & Decodable>(_ type: Value.Type, forKey key: Key) -> Value? where Value.RawValue == String {
        if let value = try? decodeIfPresent(type, forKey: key) {
            return value
        }
        if let rawValue = try? decodeIfPresent(String.self, forKey: key) {
            return Value(rawValue: rawValue.lowercased())
        }
        return nil
    }

    func decodeJSONBackedArrayIfPresent<Value: Decodable>(_ type: Value.Type, forKey key: Key) -> [Value]? {
        if let value = try? decodeIfPresent([Value].self, forKey: key) {
            return value
        }
        guard let json = try? decodeIfPresent(String.self, forKey: key),
              let data = json.data(using: .utf8) else {
            return nil
        }
        return try? IllumeJSON.decoder().decode([Value].self, from: data)
    }
}

public struct BookPage: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID?
    public var bookId: UUID
    public var userId: UUID
    public var pageNumber: Int
    public var text: String
    public var wordCount: Int

    public init(id: UUID? = nil, bookId: UUID, userId: UUID, pageNumber: Int, text: String, wordCount: Int) {
        self.id = id
        self.bookId = bookId
        self.userId = userId
        self.pageNumber = pageNumber
        self.text = text
        self.wordCount = wordCount
    }
}

public struct BillingProfile: Codable, Equatable, Sendable {
    public var userId: UUID
    public var stripeCustomerId: String?
    public var stripeSubscriptionId: String?
    public var stripePriceId: String?
    public var plan: String
    public var status: String
    public var currentPeriodEnd: Date?
    public var cancelAtPeriodEnd: Bool
    public var appleOriginalTransactionId: String?
    public var appleProductId: String?
    public var appleEnvironment: String?
    public var appleExpiresAt: Date?
    public var appleRevocationDate: Date?

    public init(
        userId: UUID,
        stripeCustomerId: String? = nil,
        stripeSubscriptionId: String? = nil,
        stripePriceId: String? = nil,
        plan: String = "free",
        status: String = "inactive",
        currentPeriodEnd: Date? = nil,
        cancelAtPeriodEnd: Bool = false,
        appleOriginalTransactionId: String? = nil,
        appleProductId: String? = nil,
        appleEnvironment: String? = nil,
        appleExpiresAt: Date? = nil,
        appleRevocationDate: Date? = nil
    ) {
        self.userId = userId
        self.stripeCustomerId = stripeCustomerId
        self.stripeSubscriptionId = stripeSubscriptionId
        self.stripePriceId = stripePriceId
        self.plan = plan
        self.status = status
        self.currentPeriodEnd = currentPeriodEnd
        self.cancelAtPeriodEnd = cancelAtPeriodEnd
        self.appleOriginalTransactionId = appleOriginalTransactionId
        self.appleProductId = appleProductId
        self.appleEnvironment = appleEnvironment
        self.appleExpiresAt = appleExpiresAt
        self.appleRevocationDate = appleRevocationDate
    }
}

public struct ReaderImageUsage: Codable, Equatable, Sendable {
    public var userId: UUID?
    public var generatedCount: Int
    public var monthlyGeneratedCount: Int
    public var monthlyPeriodStart: Date?

    public init(
        userId: UUID? = nil,
        generatedCount: Int = 0,
        monthlyGeneratedCount: Int = 0,
        monthlyPeriodStart: Date? = nil
    ) {
        self.userId = userId
        self.generatedCount = generatedCount
        self.monthlyGeneratedCount = monthlyGeneratedCount
        self.monthlyPeriodStart = monthlyPeriodStart
    }
}

public struct ReaderImage: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID?
    public var userId: UUID
    public var bookId: UUID
    public var startWord: Int
    public var endWord: Int
    public var storagePath: String
    public var prompt: String?
    public var style: ReaderImageStyle
    public var createdAt: Date?

    public init(
        id: UUID? = nil,
        userId: UUID,
        bookId: UUID,
        startWord: Int,
        endWord: Int,
        storagePath: String,
        prompt: String? = nil,
        style: ReaderImageStyle = .cartoon,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.userId = userId
        self.bookId = bookId
        self.startWord = startWord
        self.endWord = endWord
        self.storagePath = storagePath
        self.prompt = prompt
        self.style = style
        self.createdAt = createdAt
    }
}

public struct ReaderParagraph: Codable, Equatable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case heading
        case paragraph
        case quote
        case list
        case image
    }

    public var id: String
    public var chapterIndex: Int
    public var chapterTitle: String
    public var kind: Kind
    public var pageNumber: Int?
    public var text: String
    public var inlineStyles: [ReaderInlineStyle]

    private enum CodingKeys: String, CodingKey {
        case id
        case chapterIndex
        case chapterTitle
        case kind
        case pageNumber
        case text
        case inlineStyles
    }

    public init(
        id: String,
        chapterIndex: Int = 0,
        chapterTitle: String,
        kind: Kind = .paragraph,
        pageNumber: Int? = nil,
        text: String,
        inlineStyles: [ReaderInlineStyle] = []
    ) {
        self.id = id
        self.chapterIndex = chapterIndex
        self.chapterTitle = chapterTitle
        self.kind = kind
        self.pageNumber = pageNumber
        self.text = text
        self.inlineStyles = inlineStyles
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        chapterIndex = try container.decodeIfPresent(Int.self, forKey: .chapterIndex) ?? 0
        chapterTitle = try container.decodeIfPresent(String.self, forKey: .chapterTitle) ?? ""
        kind = try container.decodeIfPresent(Kind.self, forKey: .kind) ?? .paragraph
        pageNumber = try container.decodeIfPresent(Int.self, forKey: .pageNumber)
        text = try container.decode(String.self, forKey: .text)
        inlineStyles = try container.decodeIfPresent([ReaderInlineStyle].self, forKey: .inlineStyles) ?? []
    }
}

public struct ReaderInlineStyle: Codable, Equatable, Sendable {
    public var location: Int
    public var length: Int
    public var bold: Bool
    public var italic: Bool
    public var underline: Bool
    public var strikethrough: Bool
    public var monospace: Bool
    public var superscript: Bool
    public var isSubscript: Bool
    public var smallCaps: Bool
    public var highlighted: Bool

    public init(
        location: Int,
        length: Int,
        bold: Bool = false,
        italic: Bool = false,
        underline: Bool = false,
        strikethrough: Bool = false,
        monospace: Bool = false,
        superscript: Bool = false,
        isSubscript: Bool = false,
        smallCaps: Bool = false,
        highlighted: Bool = false
    ) {
        self.location = location
        self.length = length
        self.bold = bold
        self.italic = italic
        self.underline = underline
        self.strikethrough = strikethrough
        self.monospace = monospace
        self.superscript = superscript
        self.isSubscript = isSubscript
        self.smallCaps = smallCaps
        self.highlighted = highlighted
    }
}

public struct ReaderBook: Codable, Equatable, Sendable {
    public var title: String
    public var author: String
    public var coverUrl: String?
    public var fileName: String?
    public var format: DocumentType
    public var pageCount: Int?
    public var chapterPageNumbers: [Int]
    public var chapterPageOffsets: [Double]
    public var paragraphs: [ReaderParagraph]
    public var chapters: [String]

    public init(
        title: String,
        author: String = "",
        coverUrl: String? = nil,
        fileName: String? = nil,
        format: DocumentType,
        pageCount: Int? = nil,
        chapterPageNumbers: [Int] = [],
        chapterPageOffsets: [Double] = [],
        paragraphs: [ReaderParagraph] = [],
        chapters: [String] = []
    ) {
        self.title = title
        self.author = author
        self.coverUrl = coverUrl
        self.fileName = fileName
        self.format = format
        self.pageCount = pageCount
        self.chapterPageNumbers = chapterPageNumbers
        self.chapterPageOffsets = chapterPageOffsets
        self.paragraphs = paragraphs
        self.chapters = chapters
    }
}
