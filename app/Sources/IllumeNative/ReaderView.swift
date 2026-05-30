#if os(iOS)
import IllumeCore
import SwiftUI
import UIKit

private let readerImageChunkWords = 750

private struct ReaderImageChunk {
    let endWord: Int
    let index: Int
    let startWord: Int
    let text: String
}

private struct ReaderImageChunkCache {
    let bookID: UUID?
    let firstParagraphID: String?
    let lastParagraphID: String?
    let paragraphCount: Int
    let paragraphWordStarts: [Int]
    let chunks: [ReaderImageChunk]

    static let empty = ReaderImageChunkCache(
        bookID: nil,
        firstParagraphID: nil,
        lastParagraphID: nil,
        paragraphCount: 0,
        paragraphWordStarts: [],
        chunks: []
    )

    func matches(bookID: UUID?, book: ReaderBook) -> Bool {
        self.bookID == bookID
            && paragraphCount == book.paragraphs.count
            && firstParagraphID == book.paragraphs.first?.id
            && lastParagraphID == book.paragraphs.last?.id
    }

    static func build(bookID: UUID?, book: ReaderBook) -> ReaderImageChunkCache {
        var paragraphWordStarts = Array(repeating: 0, count: book.paragraphs.count)
        var chunks: [ReaderImageChunk] = []
        var chunkWords: [String] = []
        var chunkStartWord = 1
        var totalWords = 0

        for (index, paragraph) in book.paragraphs.enumerated() {
            paragraphWordStarts[index] = totalWords
            guard paragraph.kind != .heading else { continue }

            let words = paragraph.text.split(whereSeparator: \.isWhitespace).map(String.init)
            for word in words {
                if chunkWords.count == readerImageChunkWords {
                    let chunkIndex = chunks.count
                    chunks.append(
                        ReaderImageChunk(
                            endWord: chunkStartWord + chunkWords.count - 1,
                            index: chunkIndex,
                            startWord: chunkStartWord,
                            text: chunkWords.joined(separator: " ")
                        )
                    )
                    chunkStartWord += chunkWords.count
                    chunkWords.removeAll(keepingCapacity: true)
                }
                chunkWords.append(word)
                totalWords += 1
            }
        }

        if !chunkWords.isEmpty {
            let chunkIndex = chunks.count
            chunks.append(
                ReaderImageChunk(
                    endWord: chunkStartWord + chunkWords.count - 1,
                    index: chunkIndex,
                    startWord: chunkStartWord,
                    text: chunkWords.joined(separator: " ")
                )
            )
        }

        return ReaderImageChunkCache(
            bookID: bookID,
            firstParagraphID: book.paragraphs.first?.id,
            lastParagraphID: book.paragraphs.last?.id,
            paragraphCount: book.paragraphs.count,
            paragraphWordStarts: paragraphWordStarts,
            chunks: chunks
        )
    }
}

struct ReaderView: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var settingsOpen = false
    @State private var tableOfContentsOpen = false
    @State private var pendingParagraphID: String?
    @State private var scrollRequest = 0
    @State private var readerContentVisible = true
    @State private var currentIndex = 0
    @State private var imageModeEnabled = true
    @State private var imageModeTask: Task<Void, Never>?
    @State private var scheduledImageChunkIndex: Int?
    @State private var imageChunkCache = ReaderImageChunkCache.empty

    var body: some View {
        let theme = app.readerSettings.theme

        ZStack {
            theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                if let book = app.activeBook {
                    let isShowingImageMode = imageModeEnabled && imageParagraph(in: book) != nil

                    if isShowingImageMode {
                        ZStack(alignment: .top) {
                            ReaderImageTopPanel(
                                urlString: app.readerImageResponse?.imageUrl,
                                phase: app.readerImagePhase
                            )

                            ReaderToolbar(
                                settingsOpen: $settingsOpen
                            ) {
                                app.closeReader()
                                dismiss()
                            }
                            .padding(.top, 8)
                        }
                        .padding(.horizontal, 8)
                        .padding(.top, 6)
                    } else {
                        ReaderToolbar(
                            settingsOpen: $settingsOpen
                        ) {
                            app.closeReader()
                            dismiss()
                        }
                        .background(theme.background)
                    }

                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 18) {
                                ForEach(Array(book.paragraphs.enumerated()), id: \.element.id) { index, paragraph in
                                    ParagraphView(paragraph: paragraph, index: index) {
                                        currentIndex = index
                                        app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
                                    }
                                        .id(paragraph.id)
                                        .onAppear {
                                            currentIndex = index
                                            app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
                                        }
                                }
                            }
                            .frame(maxWidth: app.readerSettings.lineWidth * 12)
                            .padding(.horizontal, 24)
                            .padding(.top, 16)
                            .padding(.bottom, 120)
                            .frame(maxWidth: .infinity)
                        }
                        .scrollIndicators(.hidden)
                        .opacity(readerContentVisible ? 1 : 0)
                        .onAppear {
                            if let row = app.activeBookRow,
                               book.paragraphs.indices.contains(row.currentIndex) {
                                proxy.scrollTo(book.paragraphs[row.currentIndex].id, anchor: .top)
                            }
                        }
                        .onChange(of: scrollRequest) {
                            guard let paragraphID = pendingParagraphID else { return }
                            var transaction = Transaction()
                            transaction.disablesAnimations = true
                            withTransaction(transaction) {
                                proxy.scrollTo(paragraphID, anchor: .top)
                            }
                            pendingParagraphID = nil
                        }
                        .onChange(of: app.narration.paragraphID) {
                            guard let paragraphID = app.narration.paragraphID,
                                  let index = book.paragraphs.firstIndex(where: { $0.id == paragraphID }) else { return }
                            currentIndex = index
                            app.saveProgress(index: index, page: book.paragraphs[index].pageNumber ?? 1)
                            withAnimation(IllumeTheme.spring) {
                                proxy.scrollTo(paragraphID, anchor: .center)
                            }
                        }
                    }
                }
            }

            if let book = app.activeBook {
                VStack {
                    Spacer()
                    HStack(spacing: 12) {
                        ReaderNarrationButton(isPlaying: app.narration.isPlaying) {
                            app.toggleNarration(for: book, from: currentIndex)
                        }

                        ReaderTableOfContentsButton(
                            hasTableOfContents: !tableOfContentsEntries(for: book).isEmpty
                        ) {
                            tableOfContentsOpen = true
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 20)
                }
            }
        }
        .foregroundStyle(theme.foreground)
        .sheet(isPresented: $settingsOpen) {
            ReaderSettingsSheet(
                imageModeEnabled: $imageModeEnabled,
                imageModeLoading: app.readerImagePhase == .checking || app.readerImagePhase == .generating,
                imageModeDisabled: app.activeBook.map { imageParagraph(in: $0) == nil } ?? true
            ) {
                guard let book = app.activeBook else { return }
                toggleImageMode(for: book)
            }
                .presentationDetents([.medium])
                .presentationCornerRadius(30)
        }
        .sheet(isPresented: $tableOfContentsOpen) {
            if let book = app.activeBook {
                TableOfContentsSheet(
                    entries: tableOfContentsEntries(for: book),
                    currentIndex: currentIndex
                ) { entry in
                    readerContentVisible = false
                    pendingParagraphID = entry.paragraphID
                    scrollRequest += 1
                    tableOfContentsOpen = false
                    Task { @MainActor in
                        await Task.yield()
                        withAnimation(IllumeTheme.blurLoadIn) {
                            readerContentVisible = true
                        }
                    }
                }
                .presentationDetents([.medium, .large])
                .presentationCornerRadius(30)
            }
        }
        .onChange(of: currentIndex) {
            guard imageModeEnabled, let book = app.activeBook else { return }
            scheduleImageGeneration(for: book)
        }
        .onChange(of: app.activeBookRow?.id) {
            guard imageModeEnabled, let book = app.activeBook else { return }
            scheduledImageChunkIndex = nil
            scheduleImageGeneration(for: book, delay: .zero)
        }
        .onChange(of: app.readerSettings.imageStyle) {
            guard imageModeEnabled, let book = app.activeBook else { return }
            scheduledImageChunkIndex = nil
            scheduleImageGeneration(for: book, delay: .zero)
        }
        .onAppear {
            guard imageModeEnabled, let book = app.activeBook else { return }
            scheduleImageGeneration(for: book, delay: .zero)
        }
        .onDisappear {
            imageModeTask?.cancel()
            imageModeTask = nil
        }
    }

    private func toggleImageMode(for book: ReaderBook) {
        imageModeEnabled.toggle()
        if !imageModeEnabled {
            app.readerImageResponse = nil
            app.readerImagePhase = .idle
            scheduledImageChunkIndex = nil
        }

        if imageModeEnabled {
            scheduleImageGeneration(for: book, delay: .zero)
        } else {
            imageModeTask?.cancel()
            imageModeTask = nil
        }
    }

    private func scheduleImageGeneration(for book: ReaderBook, delay: Duration = .milliseconds(520)) {
        guard let chunk = imageChunk(in: book) else { return }
        guard scheduledImageChunkIndex != chunk.index else { return }
        scheduledImageChunkIndex = chunk.index
        imageModeTask?.cancel()
        imageModeTask = Task {
            if delay > .zero {
                try? await Task.sleep(for: delay)
            }
            guard !Task.isCancelled else { return }
            await app.generateImage(text: chunk.text, chunkIndex: chunk.index, startWord: chunk.startWord, endWord: chunk.endWord)
        }
    }

    private func imageParagraph(in book: ReaderBook) -> ReaderParagraph? {
        guard !book.paragraphs.isEmpty else { return nil }
        let start = min(max(currentIndex, 0), book.paragraphs.count - 1)
        if book.paragraphs[start].kind != .heading {
            return book.paragraphs[start]
        }

        let next = book.paragraphs.indices.dropFirst(start + 1).first { book.paragraphs[$0].kind != .heading }
        if let next {
            return book.paragraphs[next]
        }
        let previous = book.paragraphs.indices.prefix(start).reversed().first { book.paragraphs[$0].kind != .heading }
        return previous.map { book.paragraphs[$0] }
    }

    private func imageChunk(in book: ReaderBook) -> ReaderImageChunk? {
        guard !book.paragraphs.isEmpty else { return nil }
        let bookID = app.activeBookRow?.id
        if !imageChunkCache.matches(bookID: bookID, book: book) {
            imageChunkCache = ReaderImageChunkCache.build(bookID: bookID, book: book)
        }

        let target = min(max(currentIndex, 0), book.paragraphs.count - 1)
        guard imageChunkCache.paragraphWordStarts.indices.contains(target),
              !imageChunkCache.chunks.isEmpty else { return nil }
        let wordsBeforeTarget = imageChunkCache.paragraphWordStarts[target]
        let chunkIndex = wordsBeforeTarget / readerImageChunkWords
        guard imageChunkCache.chunks.indices.contains(chunkIndex) else { return nil }
        return imageChunkCache.chunks[chunkIndex]
    }

    private func tableOfContentsEntries(for book: ReaderBook) -> [TableOfContentsEntry] {
        book.chapters.enumerated().compactMap { chapterIndex, title in
            let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedTitle.isEmpty else { return nil }
            guard let paragraphIndex = book.paragraphs.firstIndex(where: { $0.chapterIndex == chapterIndex }) else {
                return nil
            }

            return TableOfContentsEntry(
                title: trimmedTitle,
                paragraphIndex: paragraphIndex,
                paragraphID: book.paragraphs[paragraphIndex].id,
                pageNumber: book.paragraphs[paragraphIndex].pageNumber
            )
        }
    }
}

struct ReaderToolbar: View {
    @Binding var settingsOpen: Bool
    let close: () -> Void

    var body: some View {
        HStack {
            SoftIconButton(systemName: "chevron.down", action: close)
            Spacer()
            SoftIconButton(systemName: "textformat.size") { settingsOpen = true }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }
}

struct TableOfContentsEntry: Identifiable, Equatable {
    let title: String
    let paragraphIndex: Int
    let paragraphID: String
    let pageNumber: Int?

    var id: Int { paragraphIndex }
}

struct TableOfContentsSheet: View {
    let entries: [TableOfContentsEntry]
    let currentIndex: Int
    let select: (TableOfContentsEntry) -> Void

    private var currentEntryID: Int? {
        entries.last(where: { $0.paragraphIndex <= currentIndex })?.id
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Contents")
                            .font(IllumeTypography.heading(34, weight: .bold))
                            .foregroundStyle(IllumeTheme.ink)
                        Text("\(entries.count) \(entries.count == 1 ? "chapter" : "chapters")")
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 4)

                    LazyVStack(spacing: 10) {
                        ForEach(entries) { entry in
                            Button {
                                select(entry)
                            } label: {
                                TableOfContentsRow(entry: entry, isCurrent: entry.id == currentEntryID)
                            }
                            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .buttonStyle(LiquidCardButtonStyle(cornerRadius: 20, tint: entry.id == currentEntryID ? IllumeTheme.mist : IllumeTheme.paper))
                        }
                    }
                }
                .padding(22)
            }
            .scrollIndicators(.hidden)
            .background(IllumeTheme.paper)
        }
        .background(IllumeTheme.paper)
    }
}

struct TableOfContentsRow: View {
    let entry: TableOfContentsEntry
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.title)
                    .font(.system(.body, design: .rounded, weight: .bold))
                    .foregroundStyle(IllumeTheme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if entry.pageNumber != nil || isCurrent {
                    HStack(spacing: 8) {
                        if let pageNumber = entry.pageNumber {
                            Label("Page \(pageNumber)", systemImage: "doc.text")
                        }

                        if isCurrent {
                            Text("Current")
                                .font(.system(.caption2, design: .rounded, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(IllumeTheme.coral, in: Capsule())
                        }
                    }
                    .font(.system(.caption, design: .rounded, weight: .semibold))
                    .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

struct ParagraphView: View {
    @EnvironmentObject private var app: IllumeAppModel
    let paragraph: ReaderParagraph
    let index: Int
    let selectParagraph: () -> Void

    var body: some View {
        ReaderAttributedText(
            text: paragraph.text,
            font: uiFont,
            textColor: UIColor(themeForeground),
            lineSpacing: 9 * app.readerSettings.lineHeight,
            activeRange: app.narration.paragraphID == paragraph.id ? app.narration.wordRange : nil
        ) {
            selectParagraph()
        } selectWord: { wordStart in
            guard let book = app.activeBook else { return }
            selectParagraph()
            app.speak(book: book, paragraphIndex: index, wordStart: wordStart)
        }
        .padding(.vertical, paragraph.kind == .heading ? 22 : 2)
    }

    private var themeForeground: Color {
        app.readerSettings.theme.foreground
    }

    private var uiFont: UIFont {
        let size = 20 * app.readerSettings.textScale
        switch paragraph.kind {
        case .heading:
            return .systemFont(ofSize: 30 * app.readerSettings.textScale, weight: .black)
        case .quote:
            let font = UIFont.systemFont(ofSize: size, weight: .medium)
            let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor
            return UIFont(descriptor: descriptor, size: size)
        default:
            return .systemFont(ofSize: size, weight: .regular)
        }
    }
}

struct ReaderAttributedText: UIViewRepresentable {
    let text: String
    let font: UIFont
    let textColor: UIColor
    let lineSpacing: CGFloat
    let activeRange: NSRange?
    let selectParagraph: () -> Void
    let selectWord: (Int) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(selectParagraph: selectParagraph, selectWord: selectWord)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.delegate = context.coordinator
        textView.isEditable = false
        textView.isScrollEnabled = false
        textView.isSelectable = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.adjustsFontForContentSizeCategory = true
        textView.dataDetectorTypes = []
        textView.addGestureRecognizer(context.coordinator.tapRecognizer)
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.selectParagraph = selectParagraph
        context.coordinator.selectWord = selectWord
        if context.coordinator.cachedText != text {
            context.coordinator.cachedText = text
            context.coordinator.wordRanges = IllumeAppModel.wordRanges(in: text)
        }

        textView.linkTextAttributes = [
            .foregroundColor: textColor,
            .underlineStyle: 0
        ]

        let renderKey = RenderKey(
            text: text,
            fontName: font.fontName,
            fontSize: font.pointSize,
            textColor: textColor,
            lineSpacing: lineSpacing,
            activeRange: activeRange
        )
        guard context.coordinator.renderKey != renderKey else { return }
        context.coordinator.renderKey = renderKey
        textView.attributedText = attributedString
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width
        let fittingSize = CGSize(width: width, height: .greatestFiniteMagnitude)
        let size = uiView.sizeThatFits(fittingSize)
        return CGSize(width: width, height: size.height)
    }

    private var attributedString: NSAttributedString {
        let nsText = text as NSString
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = lineSpacing

        let attributed = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle
            ]
        )

        if let activeRange,
           activeRange.location >= 0,
           NSMaxRange(activeRange) <= nsText.length {
            let shadow = NSShadow()
            shadow.shadowBlurRadius = 8
            shadow.shadowColor = UIColor.white.withAlphaComponent(0.42)
            shadow.shadowOffset = .zero
            attributed.addAttributes(
                [
                    .backgroundColor: UIColor.white.withAlphaComponent(0.34),
                    .foregroundColor: textColor,
                    .shadow: shadow
                ],
                range: activeRange
            )
        }

        return attributed
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var selectParagraph: () -> Void
        var selectWord: (Int) -> Void
        var cachedText = ""
        var renderKey: RenderKey?
        var wordRanges: [NSRange] = []

        lazy var tapRecognizer: UITapGestureRecognizer = {
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
            recognizer.cancelsTouchesInView = false
            return recognizer
        }()

        init(selectParagraph: @escaping () -> Void, selectWord: @escaping (Int) -> Void) {
            self.selectParagraph = selectParagraph
            self.selectWord = selectWord
        }

        @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended,
                  let textView = recognizer.view as? UITextView else { return }

            let point = recognizer.location(in: textView)
            guard let characterIndex = characterIndex(at: point, in: textView) else {
                selectParagraph()
                return
            }

            if let range = wordRanges.first(where: { NSLocationInRange(characterIndex, $0) }) {
                selectWord(range.location)
            } else {
                selectParagraph()
            }
        }

        private func characterIndex(at point: CGPoint, in textView: UITextView) -> Int? {
            let layoutManager = textView.layoutManager
            let textContainer = textView.textContainer
            var location = point
            location.x -= textView.textContainerInset.left
            location.y -= textView.textContainerInset.top

            let glyphRange = layoutManager.glyphRange(for: textContainer)
            guard glyphRange.length > 0 else { return nil }

            let usedRect = layoutManager.usedRect(for: textContainer)
            guard usedRect.insetBy(dx: -8, dy: -8).contains(location) else { return nil }

            let glyphIndex = layoutManager.glyphIndex(for: location, in: textContainer)
            guard NSLocationInRange(glyphIndex, glyphRange) else { return nil }

            let characterIndex = layoutManager.characterIndexForGlyph(at: glyphIndex)
            guard characterIndex < textView.attributedText.length else { return nil }
            return characterIndex
        }
    }

    struct RenderKey: Equatable {
        let text: String
        let fontName: String
        let fontSize: CGFloat
        let textColor: UIColor
        let lineSpacing: CGFloat
        let activeRange: NSRange?

        static func == (lhs: RenderKey, rhs: RenderKey) -> Bool {
            lhs.text == rhs.text
                && lhs.fontName == rhs.fontName
                && lhs.fontSize == rhs.fontSize
                && lhs.textColor.isEqual(rhs.textColor)
                && lhs.lineSpacing == rhs.lineSpacing
                && lhs.activeRange == rhs.activeRange
        }
    }
}

struct ReaderNarrationButton: View {
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            Button(action: action) {
                narrationIcon
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(isPlaying ? IllumeTheme.mist : IllumeTheme.paper)
            .accessibilityLabel(isPlaying ? "Stop narration" : "Play narration")
        } else {
            Button(action: action) {
                narrationIcon
                    .illumeLiquidGlassCircle(
                        tint: isPlaying ? IllumeTheme.mist : IllumeTheme.paper,
                        isInteractive: true
                    )
            }
            .buttonStyle(LiquidLiftButtonStyle())
            .accessibilityLabel(isPlaying ? "Stop narration" : "Play narration")
        }
    }

    private var narrationIcon: some View {
        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
            .font(.system(size: 22, weight: .black))
            .foregroundStyle(IllumeTheme.ink)
            .frame(width: 58, height: 58)
    }
}

struct ReaderTableOfContentsButton: View {
    let hasTableOfContents: Bool
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            Button(action: action) {
                contentsIcon
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(IllumeTheme.paper)
            .disabled(!hasTableOfContents)
            .opacity(hasTableOfContents ? 1 : 0.5)
            .accessibilityLabel("Open table of contents")
        } else {
            Button(action: action) {
                contentsIcon
                    .illumeLiquidGlassCircle(
                        tint: IllumeTheme.paper,
                        isInteractive: true
                    )
            }
            .buttonStyle(LiquidLiftButtonStyle())
            .disabled(!hasTableOfContents)
            .opacity(hasTableOfContents ? 1 : 0.5)
            .accessibilityLabel("Open table of contents")
        }
    }

    private var contentsIcon: some View {
        Image(systemName: "list.bullet")
            .font(.system(size: 21, weight: .black))
            .foregroundStyle(IllumeTheme.ink)
            .frame(width: 58, height: 58)
    }
}

struct ReaderImageModeButton: View {
    let isEnabled: Bool
    let isLoading: Bool
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            if isEnabled {
                Button(action: action) {
                    imageModeLabel
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.capsule)
                .tint(IllumeTheme.coral)
                .disabled(isDisabled)
                .opacity(isDisabled ? 0.5 : 1)
            } else {
                Button(action: action) {
                    imageModeLabel
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.capsule)
                .tint(IllumeTheme.paper)
                .disabled(isDisabled)
                .opacity(isDisabled ? 0.5 : 1)
            }
        } else {
            Button(action: action) {
                imageModeLabel
                    .illumeLiquidGlassCapsule(
                        tint: isEnabled ? IllumeTheme.coral : IllumeTheme.paper,
                        isInteractive: true
                    )
                    .scaleEffect(isEnabled ? 1.02 : 1)
            }
            .buttonStyle(LiquidLiftButtonStyle())
            .disabled(isDisabled)
            .opacity(isDisabled ? 0.5 : 1)
        }
    }

    private var imageModeLabel: some View {
        HStack(spacing: 10) {
            if isLoading && isEnabled {
                ProgressView()
                    .controlSize(.small)
                    .tint(IllumeTheme.ink)
            } else {
                Image(systemName: isEnabled ? "photo.stack.fill" : "photo.stack")
                    .font(.system(size: 17, weight: .bold))
            }

            Text("Image mode")
                .font(.system(.subheadline, design: .rounded, weight: .bold))

            Text(isEnabled ? "On" : "Off")
                .font(.system(.caption, design: .rounded, weight: .black))
                .foregroundStyle(.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(isEnabled ? IllumeTheme.coral : IllumeTheme.ink.opacity(0.42), in: Capsule())
        }
        .foregroundStyle(IllumeTheme.ink)
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .frame(height: 54)
    }
}

struct ReaderSettingsSheet: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Binding var imageModeEnabled: Bool
    let imageModeLoading: Bool
    let imageModeDisabled: Bool
    let toggleImageMode: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Capsule()
                .fill(.secondary.opacity(0.25))
                .frame(width: 42, height: 5)
                .frame(maxWidth: .infinity)

            Text("Reading")
                .font(.system(.largeTitle, design: .rounded, weight: .black))

            Picker("Theme", selection: $app.readerSettings.theme) {
                ForEach(ReaderThemeChoice.allCases, id: \.self) { theme in
                    Text(theme.rawValue).tag(theme)
                }
            }
            .pickerStyle(.segmented)
            .illumeLiquidGlassRounded(cornerRadius: 12, tint: IllumeTheme.paper)

            VStack(spacing: 18) {
                SliderRow(label: "Text", value: $app.readerSettings.textScale, range: 0.82...1.42)
                SliderRow(label: "Line", value: $app.readerSettings.lineHeight, range: 1.0...2.0)
                SliderRow(label: "Voice", value: $app.readerSettings.narrationRate, range: 0.7...2.0)
            }
            .padding(16)
            .illumeLiquidGlassRounded(cornerRadius: 22, tint: IllumeTheme.paper)

            ReaderImageModeButton(
                isEnabled: imageModeEnabled,
                isLoading: imageModeLoading,
                isDisabled: imageModeDisabled,
                action: toggleImageMode
            )

            Picker("Image style", selection: $app.readerSettings.imageStyle) {
                Text("Cartoon").tag(ReaderImageStyle.cartoon)
                Text("Cute").tag(ReaderImageStyle.cute)
            }
            .pickerStyle(.segmented)
            .illumeLiquidGlassRounded(cornerRadius: 12, tint: IllumeTheme.paper)

            Spacer()
        }
        .padding(24)
        .background(IllumeTheme.paper)
    }
}

struct SliderRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
            Slider(value: $value, in: range)
                .tint(IllumeTheme.accent)
        }
    }
}

struct ReaderImageTopPanel: View {
    let urlString: String?
    let phase: ReaderImagePhase

    private var panelHeight: CGFloat {
        min(max(UIScreen.main.bounds.height * 0.52, 380), 520)
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(IllumeTheme.paper.opacity(0.72))

            if let urlString, Self.isDataImageURL(urlString) {
                ReaderImageDataURLView(dataURL: urlString)
            } else if let urlString, let url = URL(string: urlString) {
                AsyncImage(url: url) { imagePhase in
                    switch imagePhase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(IllumeTheme.ink.opacity(0.45))
                    default:
                        ProgressView()
                            .controlSize(.large)
                    }
                }
            } else if phase == .checking || phase == .generating {
                ReaderImageGeneratingView(isFreshGeneration: phase == .generating)
            } else {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(IllumeTheme.ink.opacity(0.34))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: panelHeight)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [
                            .white.opacity(0.46),
                            IllumeTheme.ink.opacity(0.12)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        }
        .accessibilityLabel("Generated scene image")
    }

    private static func isDataImageURL(_ value: String) -> Bool {
        value.lowercased().hasPrefix("data:image/")
    }
}

struct ReaderImageDataURLView: View {
    let dataURL: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ProgressView()
                    .controlSize(.large)
            }
        }
        .task(id: dataURL) {
            image = nil
            let source = dataURL
            let decodedImage = await Task.detached(priority: .utility) {
                Self.decodeDataURL(source)
            }.value
            guard !Task.isCancelled else { return }
            image = decodedImage
        }
    }

    nonisolated private static func decodeDataURL(_ source: String) -> UIImage? {
        guard let commaIndex = source.firstIndex(of: ",") else { return nil }
        let base64Start = source.index(after: commaIndex)
        let base64 = String(source[base64Start...])
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            return nil
        }
        return UIImage(data: data)
    }
}

struct ReaderImageGeneratingView: View {
    let isFreshGeneration: Bool

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.03, green: 0.04, blue: 0.06),
                    Color(red: 0.05, green: 0.07, blue: 0.11),
                    Color(red: 0.04, green: 0.08, blue: 0.06)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            ReaderImageLight(color: Color(red: 0.55, green: 0.50, blue: 1.0), size: 250)
                .offset(x: -92, y: -78)
                .opacity(0.52)

            ReaderImageLight(color: Color(red: 0.15, green: 0.9, blue: 0.78), size: 270)
                .offset(x: 104, y: 80)
                .opacity(0.74)

            ReaderImageLight(color: Color(red: 1.0, green: 0.63, blue: 0.42), size: 150)
                .offset(x: -18, y: 36)
                .opacity(0.38)

            HStack(spacing: 9) {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
                Text(isFreshGeneration ? "Generating" : "Checking")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .textCase(.uppercase)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(.black.opacity(0.42), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.26), lineWidth: 1))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(16)
        }
    }
}

private struct ReaderImageLight: View {
    let color: Color
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [
                        color.opacity(0.82),
                        color.opacity(0.34),
                        color.opacity(0)
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: size * 0.5
                )
            )
            .frame(width: size, height: size)
            .blur(radius: 28)
            .blendMode(.screen)
    }
}

private extension Button {
    @MainActor
    func miniReaderButton() -> some View {
        self
            .buttonStyle(MiniGlassButtonStyle())
    }
}
#endif
