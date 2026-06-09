#if os(iOS)
import Foundation

struct ClassicBook: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let author: String
    let coverResourceName: String
    let coverUrl: URL?
    let downloadUrl: URL
    let sourcePageUrl: URL
    let genres: [String]
    let summary: String

    var fileName: String {
        guard let downloadFileName = downloadUrl.pathComponents.last, downloadFileName.hasSuffix(".epub") else {
            return "\(Self.safeFileName(title)).epub"
        }
        return downloadFileName
    }

    var standardEbooksDownloadUrl: URL {
        guard downloadUrl.host == "standardebooks.org",
              var components = URLComponents(url: downloadUrl, resolvingAgainstBaseURL: false) else {
            return downloadUrl
        }

        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "source" }
        queryItems.append(URLQueryItem(name: "source", value: "download"))
        components.queryItems = queryItems
        return components.url ?? downloadUrl
    }

    private static func safeFileName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        let scalars = name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        let collapsed = String(scalars)
            .replacingOccurrences(of: #"-+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return collapsed.isEmpty ? "document" : collapsed
    }
}

struct ClassicGenreShelf: Identifiable, Equatable {
    let id: String
    let title: String
    let books: [ClassicBook]
}

enum ClassicCatalog {
    static let genreOrder: [String] = [
        "Adventure",
        "Autobiography",
        "Biography",
        "Children's",
        "Comedy",
        "Drama",
        "Fantasy",
        "Fiction",
        "Horror",
        "Memoir",
        "Mystery",
        "Nonfiction",
        "Philosophy",
        "Poetry",
        "Satire",
        "Science Fiction",
        "Shorts",
        "Spirituality",
        "Travel"
    ]

    static func shelves(from books: [ClassicBook] = Self.books) -> [ClassicGenreShelf] {
        genreOrder.compactMap { genre in
            let shelfBooks = books.filter { $0.genres.contains(genre) }
            guard !shelfBooks.isEmpty else { return nil }
            return ClassicGenreShelf(
                id: Self.safeShelfID(genre),
                title: genre,
                books: shelfBooks.sorted {
                    if $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedSame {
                        return $0.author.localizedCaseInsensitiveCompare($1.author) == .orderedAscending
                    }
                    return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
                }
            )
        }
    }

    static func invariantsHold(for books: [ClassicBook] = Self.books) -> Bool {
        let ids = Set(books.map(\.id))
        return ids.count == books.count && books.allSatisfy { book in
            !book.id.isEmpty &&
            !book.title.isEmpty &&
            !book.author.isEmpty &&
            !book.genres.isEmpty &&
            book.downloadUrl.scheme?.hasPrefix("http") == true &&
            book.downloadUrl.pathExtension == "epub" &&
            book.sourcePageUrl.scheme?.hasPrefix("http") == true
        }
    }

    private static func safeShelfID(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
}
#endif
