#if os(iOS)
import IllumeCore
import SwiftUI
import UIKit

private let readerImageChunkWords = 750
private let readerScrollSpaceName = "readerScroll"

private struct ReaderScrollOffsetPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

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
    @State private var controlsCollapsed = false
    @State private var imageChromeHidden = false

    private let imageChromeToggleBottomExclusion: CGFloat = 128

    var body: some View {
        let theme = app.readerSettings.theme

        ZStack {
            if let book = app.activeBook,
               imageModeEnabled,
               imageParagraph(in: book) != nil {
                Color.black.ignoresSafeArea()
            } else {
                theme.background.ignoresSafeArea()
            }

            VStack(spacing: 0) {
                if let book = app.activeBook {
                    let currentImageParagraph = imageParagraph(in: book)
                    let isShowingImageMode = imageModeEnabled && currentImageParagraph != nil

                    if isShowingImageMode {
                        let imageOverlayText = imageOverlayText(in: book, expandsBeyondCurrentParagraph: imageChromeHidden)

                        ZStack(alignment: .top) {
                            ReaderImageTopPanel(
                                urlString: app.readerImageResponse?.imageUrl,
                                phase: app.readerImagePhase,
                                overlayText: imageOverlayText,
                                fillsReadingView: true,
                                isChromeHidden: imageChromeHidden
                            )
                            .contentShape(Rectangle())
                            .gesture(
                                SpatialTapGesture()
                                    .onEnded { value in
                                        guard value.location.y < UIScreen.main.bounds.height - imageChromeToggleBottomExclusion else {
                                            return
                                        }

                                        withAnimation(.easeOut(duration: 0.16)) {
                                            imageChromeHidden.toggle()
                                        }
                                    }
                            )

                            ReaderToolbar {
                                app.closeReader()
                                dismiss()
                            }
                            .padding(.top, 8)
                            .opacity(imageChromeHidden ? 0 : 1)
                            .blur(radius: imageChromeHidden ? 14 : 0)
                            .scaleEffect(imageChromeHidden ? 0.96 : 1)
                            .allowsHitTesting(!imageChromeHidden)
                            .animation(.easeOut(duration: 0.16), value: imageChromeHidden)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    } else {
                        ReaderToolbar {
                            app.closeReader()
                            dismiss()
                        }
                        .background(theme.background)

                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 18) {
                                    GeometryReader { geometry in
                                        Color.clear.preference(
                                            key: ReaderScrollOffsetPreferenceKey.self,
                                            value: geometry.frame(in: .named(readerScrollSpaceName)).minY
                                        )
                                    }
                                    .frame(height: 0)

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
                                .frame(maxWidth: min(CGFloat(app.readerSettings.lineWidth) * 11, 560))
                                .padding(.horizontal, 18)
                                .padding(.top, 12)
                                .padding(.bottom, controlsCollapsed ? 122 : 158)
                                .frame(maxWidth: .infinity)
                            }
                            .coordinateSpace(name: readerScrollSpaceName)
                            .scrollIndicators(.hidden)
                            .opacity(readerContentVisible ? 1 : 0)
                            .onPreferenceChange(ReaderScrollOffsetPreferenceKey.self) { offset in
                                let shouldCollapse = offset < -18
                                guard controlsCollapsed != shouldCollapse else { return }
                                withAnimation(IllumeTheme.spring) {
                                    controlsCollapsed = shouldCollapse
                                }
                            }
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
            }

            if let book = app.activeBook {
                let isShowingImageMode = imageModeEnabled && imageParagraph(in: book) != nil
                let hideBottomControls = isShowingImageMode && imageChromeHidden

                VStack {
                    Spacer()
                    GeometryReader { geometry in
                        let useCompactControls = isShowingImageMode || controlsCollapsed || geometry.size.width < 430

                        VStack(spacing: useCompactControls ? 8 : 10) {
                            ReaderProgressStrip(currentIndex: currentIndex, totalCount: book.paragraphs.count)
                                .padding(.horizontal, useCompactControls ? 2 : 6)

                            HStack(spacing: useCompactControls ? 10 : 12) {
                                ReaderTableOfContentsButton(
                                    hasTableOfContents: !tableOfContentsEntries(for: book).isEmpty,
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode
                                ) {
                                    tableOfContentsOpen = true
                                }

                                Spacer(minLength: 0)

                                ReaderTransportRail(
                                    book: book,
                                    currentIndex: currentIndex,
                                    isPlaying: app.narration.isPlaying,
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode,
                                    playPause: {
                                        app.toggleNarration(for: book, from: currentIndex)
                                    },
                                    moveToAndNarrate: { index in
                                        moveToAndNarrate(index, in: book)
                                    }
                                )

                                Spacer(minLength: 0)

                                ReaderTypographySettingsButton(
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode
                                ) {
                                    settingsOpen = true
                                }
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .frame(height: useCompactControlsHeight(isShowingImageMode: isShowingImageMode))
                    .padding(.horizontal, 12)
                    .padding(.bottom, useCompactControlsBottomPadding(isShowingImageMode: isShowingImageMode))
                    .opacity(hideBottomControls ? 0 : 1)
                    .blur(radius: hideBottomControls ? 14 : 0)
                    .scaleEffect(hideBottomControls ? 0.96 : 1, anchor: .bottom)
                    .allowsHitTesting(!hideBottomControls)
                    .zIndex(8)
                    .animation(.easeOut(duration: 0.16), value: hideBottomControls)
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
                    currentIndex = entry.paragraphIndex
                    if book.paragraphs.indices.contains(entry.paragraphIndex) {
                        app.saveProgress(
                            index: entry.paragraphIndex,
                            page: book.paragraphs[entry.paragraphIndex].pageNumber ?? 1
                        )
                    }
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
            imageChromeHidden = false
            app.readerImageResponse = nil
            app.readerImagePhase = .idle
            app.readerImageStyle = nil
            scheduledImageChunkIndex = nil
        }

        if imageModeEnabled {
            scheduleImageGeneration(for: book, delay: .zero)
        } else {
            imageModeTask?.cancel()
            imageModeTask = nil
        }
    }

    private func moveToAndNarrate(_ index: Int, in book: ReaderBook) {
        guard book.paragraphs.indices.contains(index) else { return }
        currentIndex = index
        let paragraph = book.paragraphs[index]
        app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
        pendingParagraphID = paragraph.id
        scrollRequest += 1
        app.speak(book: book, paragraphIndex: index)
    }

    private func useCompactControlsHeight(isShowingImageMode: Bool) -> CGFloat {
        (isShowingImageMode || controlsCollapsed) ? 92 : 112
    }

    private func useCompactControlsBottomPadding(isShowingImageMode: Bool) -> CGFloat {
        (isShowingImageMode || controlsCollapsed) ? 10 : 18
    }

    private func scheduleImageGeneration(for book: ReaderBook, delay: Duration = .milliseconds(520)) {
        guard let chunk = imageChunk(in: book) else { return }
        if app.readerImageChunkIndex == chunk.index,
           app.readerImageStyle == app.readerSettings.imageStyle,
           app.readerImagePhase == .checking || app.readerImagePhase == .generating || app.readerImagePhase == .ready {
            scheduledImageChunkIndex = chunk.index
            return
        }
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

    private func imageOverlayText(in book: ReaderBook, expandsBeyondCurrentParagraph: Bool) -> String? {
        guard let primaryParagraph = imageParagraph(in: book) else { return nil }
        let trimmedPrimary = primaryParagraph.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard expandsBeyondCurrentParagraph else { return trimmedPrimary }
        guard let primaryIndex = book.paragraphs.firstIndex(where: { $0.id == primaryParagraph.id }) else {
            return trimmedPrimary
        }

        var pieces: [String] = []
        var characterCount = 0
        for paragraph in book.paragraphs[primaryIndex...] where paragraph.kind != .heading {
            let trimmed = paragraph.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            pieces.append(trimmed)
            characterCount += trimmed.count
            if pieces.count >= 4 || characterCount >= 900 {
                break
            }
        }

        return pieces.joined(separator: "\n\n")
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
    let close: () -> Void

    var body: some View {
        HStack {
            Button(action: close) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(IllumeTheme.ink)
                    .frame(width: 48, height: 48)
            }
            .buttonStyle(ReaderGlassCircleButtonStyle(tint: .white.opacity(0.12), pressedScale: 0.86))
            .contentShape(Circle())
            .accessibilityLabel("Back to library")
            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .zIndex(4)
    }
}

struct ReaderProgressStrip: View {
    let currentIndex: Int
    let totalCount: Int

    private var safeTotal: Int {
        max(totalCount, 1)
    }

    private var currentPosition: Int {
        min(max(currentIndex + 1, 1), safeTotal)
    }

    private var progress: CGFloat {
        guard totalCount > 1 else { return totalCount == 1 ? 1 : 0 }
        return CGFloat(currentPosition - 1) / CGFloat(totalCount - 1)
    }

    private var remainingCount: Int {
        max(safeTotal - currentPosition, 0)
    }

    var body: some View {
        VStack(spacing: 7) {
            GeometryReader { geometry in
                let width = max(geometry.size.width * progress, 10)

                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(.white.opacity(0.28))
                    Capsule()
                        .fill(.white)
                        .frame(width: width)
                }
            }
            .frame(height: 7)
            .clipShape(Capsule())

            HStack {
                Text("\(currentPosition)")
                Spacer()
                Text("\(remainingCount) left")
                Spacer()
                Text("\(safeTotal)")
            }
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(.white.opacity(0.74))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.black.opacity(0.58), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(.white.opacity(0.14), lineWidth: 1)
        )
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
        let isSpeaking = app.narration.paragraphID == paragraph.id

        ReaderAttributedText(
            text: paragraph.text,
            font: uiFont,
            textColor: UIColor(themeForeground),
            lineSpacing: 6 * min(app.readerSettings.lineHeight, 1.65),
            activeRange: isSpeaking ? app.narration.wordRange : nil
        ) {
            selectParagraph()
        } selectWord: { wordStart in
            guard let book = app.activeBook else { return }
            selectParagraph()
            app.speak(book: book, paragraphIndex: index, wordStart: wordStart)
        }
        .padding(.horizontal, isSpeaking ? 10 : 0)
        .padding(.vertical, paragraph.kind == .heading ? 22 : 2)
        .background {
            if isSpeaking {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(speakingHighlightColor)
                    .shadow(color: speakingHighlightColor.opacity(0.7), radius: 0, x: 0, y: 0)
            }
        }
        .animation(IllumeTheme.blurLoadIn, value: isSpeaking)
    }

    private var themeForeground: Color {
        app.readerSettings.theme.foreground
    }

    private var uiFont: UIFont {
        let scale = min(app.readerSettings.textScale, 1.25)
        let size = 18 * scale
        switch paragraph.kind {
        case .heading:
            return .systemFont(ofSize: 25 * scale, weight: .black)
        case .quote:
            let font = UIFont.systemFont(ofSize: size, weight: .medium)
            let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor
            return UIFont(descriptor: descriptor, size: size)
        default:
            return .systemFont(ofSize: size, weight: .regular)
        }
    }

    private var speakingHighlightColor: Color {
        switch app.readerSettings.theme {
        case .night:
            return Color.white.opacity(0.12)
        default:
            return Color(red: 0.918, green: 0.961, blue: 1.0)
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

struct ReaderTransportRail: View {
    @EnvironmentObject private var app: IllumeAppModel
    @State private var voicePopoverOpen = false
    @State private var speedPopoverOpen = false

    let book: ReaderBook
    let currentIndex: Int
    let isPlaying: Bool
    let isCollapsed: Bool
    var onDarkBackground = false
    let playPause: () -> Void
    let moveToAndNarrate: (Int) -> Void

    var body: some View {
        HStack(spacing: isCollapsed ? 8 : 14) {
            if !isCollapsed {
                Button {
                    voicePopoverOpen.toggle()
                    speedPopoverOpen = false
                } label: {
                    Text(EdgeNarrationVoice.flag(for: app.readerSettings.narrationVoice))
                        .font(.system(size: 18))
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(ReaderGlassCircleButtonStyle(tint: onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper))
                .accessibilityLabel("Narration voice")
                .popover(isPresented: $voicePopoverOpen, attachmentAnchor: .point(.top), arrowEdge: .bottom) {
                    NarrationVoicePopover {
                        voicePopoverOpen = false
                    }
                    .presentationCompactAdaptation(.popover)
                }
            }

            ReaderRailIconButton(
                systemName: "arrow.counterclockwise",
                isDisabled: currentIndex <= 0,
                onDarkBackground: onDarkBackground,
                isCompact: isCollapsed
            ) {
                moveToAndNarrate(currentIndex - 1)
            }
            .accessibilityLabel("Previous paragraph")

            ReaderNarrationButton(
                isPlaying: isPlaying,
                isCompact: isCollapsed,
                onDarkBackground: onDarkBackground,
                action: playPause
            )

            ReaderRailIconButton(
                systemName: "arrow.clockwise",
                isDisabled: currentIndex >= book.paragraphs.count - 1,
                onDarkBackground: onDarkBackground,
                isCompact: isCollapsed
            ) {
                moveToAndNarrate(currentIndex + 1)
            }
            .accessibilityLabel("Next paragraph")

            if !isCollapsed {
                Button {
                    speedPopoverOpen.toggle()
                    voicePopoverOpen = false
                } label: {
                    Text(Self.formatRate(app.readerSettings.narrationRate))
                        .font(.system(.caption, design: .rounded, weight: .black))
                        .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
                        .frame(width: 40, height: 32)
                }
                .buttonStyle(ReaderGlassCapsuleButtonStyle(tint: onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper))
                .accessibilityLabel("Narration speed")
                .popover(isPresented: $speedPopoverOpen, attachmentAnchor: .point(.top), arrowEdge: .bottom) {
                    NarrationSpeedPopover()
                        .presentationCompactAdaptation(.popover)
                }
            }
        }
        .padding(.horizontal, isCollapsed ? 6 : 12)
        .padding(.vertical, isCollapsed ? 5 : 8)
        .illumeLiquidGlassCapsule(
            tint: onDarkBackground ? .white.opacity(0.18) : IllumeTheme.paper,
            isInteractive: true
        )
        .shadow(color: onDarkBackground ? .black.opacity(0.22) : .clear, radius: 20, x: 0, y: 12)
        .animation(IllumeTheme.spring, value: isCollapsed)
    }

    static func formatRate(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == floor(rounded) {
            return "\(Int(rounded))x"
        }
        return String(format: "%.2fx", rounded).replacingOccurrences(of: "0x", with: "x")
    }
}

struct NarrationVoicePopover: View {
    @EnvironmentObject private var app: IllumeAppModel
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            ForEach(EdgeNarrationVoice.allCases) { option in
                Button {
                    app.readerSettings.narrationVoice = option.id
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        Text(option.flag)
                            .font(.system(size: 18))
                        Text(option.label)
                            .font(.system(.subheadline, design: .rounded, weight: .bold))
                        Spacer()
                    }
                    .foregroundStyle(app.readerSettings.narrationVoice == option.id ? .white : IllumeTheme.ink.opacity(0.72))
                    .padding(.horizontal, 10)
                    .frame(height: 40)
                    .background(
                        app.readerSettings.narrationVoice == option.id ? IllumeTheme.ink : Color.clear,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .frame(width: 200)
        .background(.regularMaterial)
    }
}

struct NarrationSpeedPopover: View {
    @EnvironmentObject private var app: IllumeAppModel
    private let presets = [1.0, 1.25, 1.5, 2.0]

    var body: some View {
        VStack(spacing: 14) {
            Slider(value: $app.readerSettings.narrationRate, in: 0.7...2.0, step: 0.05)
                .tint(IllumeTheme.ink)
                .frame(width: 190)

            HStack(spacing: 8) {
                ForEach(presets, id: \.self) { preset in
                    Button {
                        app.readerSettings.narrationRate = preset
                    } label: {
                        Text(ReaderTransportRail.formatRate(preset))
                            .font(.system(.caption, design: .rounded, weight: .black))
                            .foregroundStyle(abs(app.readerSettings.narrationRate - preset) < 0.01 ? .white : IllumeTheme.ink.opacity(0.66))
                            .padding(.horizontal, 9)
                            .frame(height: 30)
                            .background(
                                abs(app.readerSettings.narrationRate - preset) < 0.01 ? IllumeTheme.ink : Color.clear,
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(.regularMaterial)
    }
}

struct ReaderGlassCircleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var tint: Color
    var pressedScale: CGFloat = 0.9

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .illumeLiquidGlassCircle(
                tint: tint,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true
            )
            .overlay {
                Circle()
                    .strokeBorder(.white.opacity(configuration.isPressed ? 0.68 : 0.2), lineWidth: configuration.isPressed ? 2 : 1)
                    .scaleEffect(configuration.isPressed ? 1.1 : 1)
                    .opacity(isEnabled ? 1 : 0.35)
            }
            .brightness(configuration.isPressed ? 0.12 : 0)
            .shadow(
                color: .white.opacity(configuration.isPressed ? 0.3 : 0),
                radius: configuration.isPressed ? 14 : 0,
                x: 0,
                y: 0
            )
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .animation(IllumeTheme.spring, value: configuration.isPressed)
            .animation(IllumeTheme.spring, value: isEnabled)
    }
}

struct ReaderGlassCapsuleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var tint: Color
    var pressedScale: CGFloat = 0.94

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .illumeLiquidGlassCapsule(
                tint: tint,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true
            )
            .overlay {
                Capsule()
                    .strokeBorder(.white.opacity(configuration.isPressed ? 0.64 : 0.18), lineWidth: configuration.isPressed ? 2 : 1)
                    .scaleEffect(configuration.isPressed ? 1.035 : 1)
                    .opacity(isEnabled ? 1 : 0.35)
            }
            .brightness(configuration.isPressed ? 0.1 : 0)
            .shadow(
                color: .white.opacity(configuration.isPressed ? 0.24 : 0),
                radius: configuration.isPressed ? 18 : 0,
                x: 0,
                y: 0
            )
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .animation(IllumeTheme.spring, value: configuration.isPressed)
            .animation(IllumeTheme.spring, value: isEnabled)
    }
}

struct ReaderRailIconButton: View {
    let systemName: String
    let isDisabled: Bool
    var onDarkBackground = false
    var isCompact = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: onDarkBackground ? 21 : 19, weight: .black))
                .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
                .frame(width: buttonSize, height: buttonSize)
        }
        .buttonStyle(ReaderGlassCircleButtonStyle(tint: onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper))
        .disabled(isDisabled)
        .opacity(isDisabled ? (onDarkBackground ? 0.42 : 0.35) : 1)
    }

    private var buttonSize: CGFloat {
        onDarkBackground ? (isCompact ? 42 : 46) : 34
    }
}

struct ReaderNarrationButton: View {
    let isPlaying: Bool
    var isCompact = false
    var onDarkBackground = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            narrationIcon
        }
        .buttonStyle(ReaderGlassCircleButtonStyle(tint: narrationTint))
        .accessibilityLabel(isPlaying ? "Stop narration" : "Play narration")
    }

    private var narrationIcon: some View {
        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
            .font(.system(size: onDarkBackground ? 20 : (isCompact ? 17 : 20), weight: .black))
            .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
            .frame(width: narrationSize, height: narrationSize)
    }

    private var narrationSize: CGFloat {
        onDarkBackground ? 50 : (isCompact ? 44 : 54)
    }

    private var narrationTint: Color {
        if onDarkBackground {
            return .white.opacity(0.16)
        }
        return IllumeTheme.paper
    }
}

struct ReaderTableOfContentsButton: View {
    let hasTableOfContents: Bool
    var isCollapsed = false
    var onDarkBackground = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            contentsIcon
        }
        .buttonStyle(ReaderGlassCircleButtonStyle(tint: buttonTint))
        .disabled(!hasTableOfContents)
        .opacity(hasTableOfContents ? 1 : 0.5)
        .accessibilityLabel("Open table of contents")
    }

    private var contentsIcon: some View {
        Image(systemName: "list.bullet")
            .font(.system(size: onDarkBackground ? 20 : (isCollapsed ? 17 : 20), weight: .black))
            .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
            .frame(width: iconSize, height: iconSize)
    }

    private var iconSize: CGFloat {
        onDarkBackground ? 50 : (isCollapsed ? 44 : 54)
    }

    private var buttonTint: Color {
        onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper
    }
}

struct ReaderTypographySettingsButton: View {
    var isCollapsed = false
    var onDarkBackground = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            settingsIcon
        }
        .buttonStyle(ReaderGlassCircleButtonStyle(tint: buttonTint))
        .accessibilityLabel("Open typography settings")
    }

    private var settingsIcon: some View {
        Image(systemName: "textformat.size")
            .font(.system(size: onDarkBackground ? 20 : (isCollapsed ? 17 : 20), weight: .black))
            .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
            .frame(width: iconSize, height: iconSize)
    }

    private var iconSize: CGFloat {
        onDarkBackground ? 50 : (isCollapsed ? 44 : 54)
    }

    private var buttonTint: Color {
        onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper
    }
}

struct ReaderImageModeButton: View {
    let isEnabled: Bool
    let isLoading: Bool
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            imageModeLabel
                .scaleEffect(isEnabled ? 1.02 : 1)
        }
        .buttonStyle(ReaderGlassCapsuleButtonStyle(tint: isEnabled ? IllumeTheme.coral : IllumeTheme.paper))
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.5 : 1)
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
                SliderRow(label: "Text", value: $app.readerSettings.textScale, range: 0.82...1.25)
                SliderRow(label: "Line", value: $app.readerSettings.lineHeight, range: 1.0...1.65)
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
    let overlayText: String?
    var fillsReadingView = false
    var isChromeHidden = false

    private var panelHeight: CGFloat {
        min(max(UIScreen.main.bounds.height * 0.68, 440), 680)
    }

    private var gradientHeight: CGFloat {
        let baseHeight = fillsReadingView ? UIScreen.main.bounds.height : panelHeight
        return min(baseHeight * 0.48, fillsReadingView ? 420 : 300)
    }

    private var imageContentMode: ContentMode {
        fillsReadingView ? .fit : .fill
    }

    private var overlayFontSize: CGFloat {
        fillsReadingView ? 18 : 21
    }

    private var overlayLineLimit: Int {
        if fillsReadingView {
            return isChromeHidden ? 10 : 7
        }
        return 6
    }

    private var overlayBottomPadding: CGFloat {
        if fillsReadingView {
            return isChromeHidden ? 34 : 118
        }
        return 28
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Color(red: 0.015, green: 0.017, blue: 0.022))

            if let urlString, Self.isDataImageURL(urlString) {
                ReaderImageDataURLView(
                    dataURL: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView
                )
            } else if let urlString, let url = URL(string: urlString) {
                AsyncImage(url: url) { imagePhase in
                    switch imagePhase {
                    case .success(let image):
                        ReaderDisplayedImage(
                            image: image,
                            contentMode: imageContentMode,
                            addsBottomBlur: fillsReadingView
                        )
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(.white.opacity(0.48))
                    default:
                        ProgressView()
                            .controlSize(.large)
                            .tint(.white)
                    }
                }
            } else if phase == .checking || phase == .generating {
                ReaderImageGeneratingView(isFreshGeneration: phase == .generating)
            } else {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.36))
            }

            VStack {
                Spacer()
                LinearGradient(
                    colors: [
                        .clear,
                        .black.opacity(0.62),
                        .black.opacity(0.88)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: gradientHeight)
            }

            if let overlayText, !overlayText.isEmpty {
                VStack {
                    Spacer()
                    Text(overlayText)
                        .font(.system(size: overlayFontSize, weight: .semibold, design: .serif))
                        .lineSpacing(fillsReadingView ? 3 : 4)
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.55), radius: 10, x: 0, y: 3)
                        .lineLimit(overlayLineLimit)
                        .multilineTextAlignment(.leading)
                        .minimumScaleFactor(0.88)
                        .frame(maxWidth: fillsReadingView ? 620 : .infinity, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, fillsReadingView ? 18 : 22)
                        .padding(.bottom, overlayBottomPadding)
                        .animation(.easeOut(duration: 0.16), value: isChromeHidden)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: fillsReadingView ? nil : panelHeight)
        .frame(maxHeight: fillsReadingView ? .infinity : nil)
        .clipShape(panelShape)
        .overlay {
            if !fillsReadingView {
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
        }
        .accessibilityLabel("Generated scene image")
    }

    private var panelShape: some Shape {
        RoundedRectangle(cornerRadius: fillsReadingView ? 0 : 24, style: .continuous)
    }

    private static func isDataImageURL(_ value: String) -> Bool {
        value.lowercased().hasPrefix("data:image/")
    }
}

struct ReaderImageDataURLView: View {
    let dataURL: String
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ReaderDisplayedImage(
                    image: Image(uiImage: image),
                    contentMode: contentMode,
                    addsBottomBlur: addsBottomBlur
                )
            } else {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
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

struct ReaderDisplayedImage: View {
    let image: Image
    let contentMode: ContentMode
    let addsBottomBlur: Bool

    var body: some View {
        if addsBottomBlur && contentMode == .fit {
            VStack(spacing: 0) {
                imageView
                    .overlay(alignment: .bottom) {
                        ReaderImageBottomFeather()
                            .allowsHitTesting(false)
                    }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            imageView
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var imageView: some View {
        image
            .resizable()
            .aspectRatio(contentMode: contentMode)
    }
}

struct ReaderImageBottomFeather: View {
    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask(
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.86), .white],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .blur(radius: 12)

            LinearGradient(
                colors: [
                    .clear,
                    .black.opacity(0.36),
                    .black.opacity(0.86)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(height: 96)
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
