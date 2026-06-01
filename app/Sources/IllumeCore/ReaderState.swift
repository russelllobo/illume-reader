import Foundation

public enum IllumeLimits {
    public static let freeReaderImageLifetimeLimit = 25
    public static let proReaderImageMonthlyLimit = 1_000
    public static let freeUserStorageQuotaBytes = 104_857_600
    public static let proUserStorageQuotaBytes = 5_368_709_120
    public static let defaultUserStorageQuotaBytes = freeUserStorageQuotaBytes
}

public struct ReadingProgress: Codable, Equatable, Sendable {
    public var currentIndex: Int
    public var currentPage: Int
    public var lastOpenedAt: Date

    public init(currentIndex: Int, currentPage: Int, lastOpenedAt: Date = Date()) {
        self.currentIndex = max(0, currentIndex)
        self.currentPage = max(1, currentPage)
        self.lastOpenedAt = lastOpenedAt
    }
}

public struct ReadingProgressPayload: Codable, Equatable, Sendable {
    public var currentIndex: Int
    public var currentPage: Int
    public var lastOpenedAt: Date

    public init(_ progress: ReadingProgress) {
        self.currentIndex = progress.currentIndex
        self.currentPage = progress.currentPage
        self.lastOpenedAt = progress.lastOpenedAt
    }
}

public enum LibrarySort {
    public static func byRecentActivity(_ books: [BookRow]) -> [BookRow] {
        books.sorted { left, right in
            let leftActivity = left.lastOpenedAt ?? left.createdAt
            let rightActivity = right.lastOpenedAt ?? right.createdAt
            if leftActivity != rightActivity {
                return leftActivity > rightActivity
            }
            return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
        }
    }
}

public enum BillingAccess {
    public static let appleProductId = "illume.pro.monthly"

    public static func hasProAccess(profile: BillingProfile?, now: Date = Date()) -> Bool {
        guard let profile else { return false }
        let plan = profile.plan.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let status = profile.status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if plan == "pro", ["active", "trialing"].contains(status) {
            if let end = profile.currentPeriodEnd {
                return end > now
            }
            return true
        }

        if profile.appleProductId?.lowercased() == appleProductId,
           profile.appleRevocationDate == nil,
           let expires = profile.appleExpiresAt {
            return expires > now
        }

        return false
    }

    public static func imageLimit(isPro: Bool) -> Int {
        isPro ? IllumeLimits.proReaderImageMonthlyLimit : IllumeLimits.freeReaderImageLifetimeLimit
    }

    public static func storageQuotaBytes(isPro: Bool) -> Int {
        isPro ? IllumeLimits.proUserStorageQuotaBytes : IllumeLimits.freeUserStorageQuotaBytes
    }

    public static func imageUsageCount(usage: ReaderImageUsage?, rowCount: Int, isPro: Bool, now: Date = Date()) -> Int {
        guard let usage else { return rowCount }
        if isPro {
            let usageCount = isSameMonth(usage.monthlyPeriodStart, as: now) ? usage.monthlyGeneratedCount : 0
            return max(usageCount, rowCount)
        }
        return max(usage.generatedCount, rowCount)
    }

    private static func isSameMonth(_ date: Date?, as now: Date) -> Bool {
        guard let date else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        let dateComponents = calendar.dateComponents([.year, .month], from: date)
        let nowComponents = calendar.dateComponents([.year, .month], from: now)
        return dateComponents.year == nowComponents.year && dateComponents.month == nowComponents.month
    }
}

public enum StoragePath {
    public static func safeDocumentFileName(_ name: String, type: DocumentType) -> String {
        let fallback = type == .pdf ? "document.pdf" : "book.epub"
        let stem = name
            .split(separator: "/")
            .last
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            ?? fallback
        let sanitized = stem
            .replacingOccurrences(of: #"[^\w.\- ]+"#, with: "-", options: .regularExpression)
            .replacingOccurrences(of: #"[\s]+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        let ext = type == .pdf ? "pdf" : "epub"
        let withoutExistingExtension = sanitized.replacingOccurrences(
            of: #"\.(epub|pdf)$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        ).trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        let base = withoutExistingExtension.isEmpty ? fallback.replacingOccurrences(of: ".\(ext)", with: "") : withoutExistingExtension
        return "\(base).\(ext)"
    }

    public static func documentPath(userId: UUID, bookId: UUID, originalFileName: String, type: DocumentType) -> String {
        "\(userId.uuidString.lowercased())/\(bookId.uuidString.lowercased())/\(safeDocumentFileName(originalFileName, type: type))"
    }

    public static func readerImagePath(
        userId: UUID,
        bookId: UUID,
        style: ReaderImageStyle,
        startWord: Int,
        endWord: Int
    ) -> String {
        "\(userId.uuidString.lowercased())/\(bookId.uuidString.lowercased())/\(style.rawValue)/\(max(1, startWord))-\(max(startWord, endWord)).webp"
    }
}
