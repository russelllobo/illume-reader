#if os(iOS)
import Foundation

struct ClassicBook: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let author: String
    let coverResourceName: String
    let downloadUrl: URL
    let summary: String

    var fileName: String {
        "\(Self.safeFileName(title)).epub"
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

enum ClassicCatalog {
    static let books: [ClassicBook] = [
        ClassicBook(
            id: "jane-austen-pride-and-prejudice",
            title: "Pride and Prejudice",
            author: "Jane Austen",
            coverResourceName: "jane-austen-pride-and-prejudice",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub")!,
            summary: "A classic romantic novel of manners following Elizabeth Bennet through questions of family, pride, reputation, and marriage."
        ),
        ClassicBook(
            id: "mary-shelley-frankenstein",
            title: "Frankenstein",
            author: "Mary Shelley",
            coverResourceName: "mary-shelley-frankenstein",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub")!,
            summary: "The Gothic story of Victor Frankenstein, the creature he brings to life, and the tragedy that follows."
        ),
        ClassicBook(
            id: "bram-stoker-dracula",
            title: "Dracula",
            author: "Bram Stoker",
            coverResourceName: "bram-stoker-dracula",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.epub")!,
            summary: "An epistolary vampire novel that established Count Dracula as one of literature's enduring horrors."
        ),
        ClassicBook(
            id: "lewis-carroll-alices-adventures-in-wonderland",
            title: "Alice's Adventures in Wonderland",
            author: "Lewis Carroll",
            coverResourceName: "lewis-carroll-alices-adventures-in-wonderland",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub")!,
            summary: "A fantastical journey through Wonderland with the original John Tenniel illustrations."
        ),
        ClassicBook(
            id: "arthur-conan-doyle-the-adventures-of-sherlock-holmes",
            title: "The Adventures of Sherlock Holmes",
            author: "Arthur Conan Doyle",
            coverResourceName: "arthur-conan-doyle-the-adventures-of-sherlock-holmes",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-adventures-of-sherlock-holmes/downloads/arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub")!,
            summary: "Twelve stories featuring Sherlock Holmes and Dr. Watson at the height of their deductive powers."
        ),
        ClassicBook(
            id: "f-scott-fitzgerald-the-great-gatsby",
            title: "The Great Gatsby",
            author: "F. Scott Fitzgerald",
            coverResourceName: "f-scott-fitzgerald-the-great-gatsby",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/f-scott-fitzgerald_the-great-gatsby.epub")!,
            summary: "A Jazz Age novel about longing, reinvention, and the shimmer of wealth around Jay Gatsby."
        ),
        ClassicBook(
            id: "oscar-wilde-the-picture-of-dorian-gray",
            title: "The Picture of Dorian Gray",
            author: "Oscar Wilde",
            coverResourceName: "oscar-wilde-the-picture-of-dorian-gray",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/oscar-wilde_the-picture-of-dorian-gray.epub")!,
            summary: "A philosophical novel about beauty, corruption, and a portrait that bears the cost of its subject's sins."
        ),
        ClassicBook(
            id: "herman-melville-moby-dick",
            title: "Moby-Dick",
            author: "Herman Melville",
            coverResourceName: "herman-melville-moby-dick",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/herman-melville_moby-dick.epub")!,
            summary: "Ishmael's account of Captain Ahab's obsessive hunt for the white whale."
        ),
        ClassicBook(
            id: "charles-dickens-a-tale-of-two-cities",
            title: "A Tale of Two Cities",
            author: "Charles Dickens",
            coverResourceName: "charles-dickens-a-tale-of-two-cities",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/charles-dickens_a-tale-of-two-cities.epub")!,
            summary: "A story of sacrifice, revolution, and divided lives in London and Paris."
        ),
        ClassicBook(
            id: "joseph-conrad-heart-of-darkness",
            title: "Heart of Darkness",
            author: "Joseph Conrad",
            coverResourceName: "joseph-conrad-heart-of-darkness",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/joseph-conrad/heart-of-darkness/downloads/joseph-conrad_heart-of-darkness.epub")!,
            summary: "Marlow's journey up the Congo River into imperial hypocrisy and human darkness."
        ),
        ClassicBook(
            id: "h-g-wells-the-time-machine",
            title: "The Time Machine",
            author: "H. G. Wells",
            coverResourceName: "h-g-wells-the-time-machine",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/h-g-wells_the-time-machine.epub")!,
            summary: "A Victorian inventor travels into the far future and discovers a divided humanity."
        ),
        ClassicBook(
            id: "h-g-wells-the-war-of-the-worlds",
            title: "The War of the Worlds",
            author: "H. G. Wells",
            coverResourceName: "h-g-wells-the-war-of-the-worlds",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/h-g-wells_the-war-of-the-worlds.epub")!,
            summary: "One of the earliest alien invasion novels, following Martian attacks on Victorian England."
        ),
        ClassicBook(
            id: "charlotte-bronte-jane-eyre",
            title: "Jane Eyre",
            author: "Charlotte Bronte",
            coverResourceName: "charlotte-bronte-jane-eyre",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/charlotte-bronte_jane-eyre.epub")!,
            summary: "Jane's growth from orphaned child to self-possessed woman, and her complicated love for Rochester."
        ),
        ClassicBook(
            id: "emily-bronte-wuthering-heights",
            title: "Wuthering Heights",
            author: "Emily Bronte",
            coverResourceName: "emily-bronte-wuthering-heights",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/emily-bronte_wuthering-heights.epub")!,
            summary: "A fierce story of obsessive love, revenge, and inheritance on the Yorkshire moors."
        ),
        ClassicBook(
            id: "fyodor-dostoevsky-crime-and-punishment",
            title: "Crime and Punishment",
            author: "Fyodor Dostoevsky",
            coverResourceName: "fyodor-dostoevsky-crime-and-punishment",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/fyodor-dostoevsky_crime-and-punishment_constance-garnett.epub")!,
            summary: "Raskolnikov's crime, guilt, and moral reckoning in Saint Petersburg."
        ),
        ClassicBook(
            id: "alexandre-dumas-the-count-of-monte-cristo",
            title: "The Count of Monte Cristo",
            author: "Alexandre Dumas",
            coverResourceName: "alexandre-dumas-the-count-of-monte-cristo",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall/downloads/alexandre-dumas_the-count-of-monte-cristo_chapman-and-hall.epub")!,
            summary: "Edmond Dantes escapes imprisonment and returns with wealth, patience, and revenge."
        ),
        ClassicBook(
            id: "charles-dickens-great-expectations",
            title: "Great Expectations",
            author: "Charles Dickens",
            coverResourceName: "charles-dickens-great-expectations",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/charles-dickens/great-expectations/downloads/charles-dickens_great-expectations.epub")!,
            summary: "Pip's rise into gentility and the difficult education of his heart."
        ),
        ClassicBook(
            id: "jane-austen-emma",
            title: "Emma",
            author: "Jane Austen",
            coverResourceName: "jane-austen-emma",
            downloadUrl: URL(string: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/jane-austen_emma.epub")!,
            summary: "Emma Woodhouse's confident matchmaking collides with the limits of her own insight."
        )
    ]
}
#endif
