#if os(iOS)
import IllumeCore
import SwiftUI
import UIKit

private let readerImageChunkWords = 750
private let readerOverlayMinimumCharacters = 260
private let readerOverlayCompactMaximumCharacters = 520
private let readerOverlayExpandedMaximumCharacters = 900
private let readerTypographyPanelLift: CGFloat = 190
private let readerScrollSpaceName = "readerScroll"
private let readerButtonsAutohideDelay: Duration = .seconds(3)
private let readerQuickMenuOpenAnimation = Animation.spring(response: 0.18, dampingFraction: 0.66, blendDuration: 0.03)
private let readerQuickMenuCloseAnimation = Animation.easeOut(duration: 0.12)

private struct ReaderScrollOffsetPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private extension AnyTransition {
    static var readerQuickMenuBubble: AnyTransition {
        .asymmetric(
            insertion: .scale(scale: 0.82, anchor: .bottomTrailing)
                .combined(with: .offset(x: 12, y: 18))
                .combined(with: .opacity),
            removal: .scale(scale: 0.96, anchor: .bottomTrailing)
                .combined(with: .offset(x: 4, y: 8))
                .combined(with: .opacity)
        )
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

private enum ReaderSheetDestination: String, Identifiable {
    case contents
    case imageStyles
    case fontSettings

    var id: String { rawValue }
}

struct ReaderView: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var activeReaderSheet: ReaderSheetDestination?
    @State private var quickMenuOpen = false
    @State private var pendingParagraphID: String?
    @State private var scrollRequest = 0
    @State private var readerContentVisible = true
    @State private var currentIndex = 0
    @State private var imageModeEnabled = true
    @State private var imageModeTask: Task<Void, Never>?
    @State private var scheduledImageChunkIndex: Int?
    @State private var imageChunkCache = ReaderImageChunkCache.empty
    @State private var controlsCollapsed = false
    @State private var readerButtonsHidden = false
    @State private var readerButtonsAutohideTask: Task<Void, Never>?
    @State private var restoredBookID: UUID?
    @State private var initialPositionReady = false
    @State private var readerLiftedForBottomPanel = false
    @State private var speedPickerExpanded = false

    private let imageChromeToggleBottomExclusion: CGFloat = 128

    private var textColumnWidth: CGFloat {
        min(CGFloat(app.readerSettings.lineWidth) * 11, 560)
    }

    private var shouldHideReaderButtons: Bool {
        readerButtonsHidden
    }

    private var isNarrationActive: Bool {
        app.narration.isPlaying || app.narration.isPreparing
    }

    var body: some View {
        ZStack {
            if let book = app.activeBook,
               imageModeEnabled,
               imageParagraph(in: book) != nil {
                Color.black.ignoresSafeArea()
            } else {
                ReaderDefaultStyle.background.ignoresSafeArea()
            }

            VStack(spacing: 0) {
                if let book = app.activeBook {
                    let currentImageParagraph = imageParagraph(in: book)
                    let isShowingImageMode = imageModeEnabled && currentImageParagraph != nil

                    if isShowingImageMode {
                        let imageOverlay = imageOverlayNarrationText(in: book)

                        ZStack(alignment: .top) {
                            ReaderImageTopPanel(
                                urlString: app.readerImageResponse?.imageUrl,
                                phase: app.readerImagePhase,
                                overlayText: imageOverlay.text,
                                activeOverlayRange: imageOverlay.activeRange,
                                fillsReadingView: true,
                                isChromeHidden: shouldHideReaderButtons
                            )
                            .contentShape(Rectangle())
                            .gesture(
                                SpatialTapGesture()
                                    .onEnded { value in
                                        guard value.location.y < UIScreen.main.bounds.height - imageChromeToggleBottomExclusion else {
                                            return
                                        }

                                        toggleReaderButtons()
                                    }
                            )

                            ReaderToolbar(bookTitle: book.title, onDarkBackground: true) {
                                closeReader()
                            }
                            .padding(.top, 8)
                            .blurLoadIn(radius: 9)
                            .opacity(shouldHideReaderButtons ? 0 : 1)
                            .blur(radius: shouldHideReaderButtons ? 14 : 0)
                            .scaleEffect(shouldHideReaderButtons ? 0.96 : 1)
                            .allowsHitTesting(!shouldHideReaderButtons)
                            .animation(.easeOut(duration: 0.16), value: shouldHideReaderButtons)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    } else {
                        ReaderToolbar(bookTitle: book.title, onDarkBackground: false) {
                            closeReader()
                        }
                        .background(ReaderDefaultStyle.background)
                        .blurLoadIn(radius: 9)
                        .opacity(shouldHideReaderButtons ? 0 : 1)
                        .blur(radius: shouldHideReaderButtons ? 14 : 0)
                        .frame(height: shouldHideReaderButtons ? 0 : nil)
                        .clipped()
                        .allowsHitTesting(!shouldHideReaderButtons)
                        .animation(.easeOut(duration: 0.16), value: shouldHideReaderButtons)

                        GeometryReader { viewport in
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
                                                updateVisibleParagraph(index, paragraph: paragraph)
                                            }
                                                .id(paragraph.id)
                                                .onAppear {
                                                    updateVisibleParagraph(index, paragraph: paragraph)
                                                }
                                        }
                                    }
                                    .frame(maxWidth: textColumnWidth)
                                    .padding(.horizontal, 18)
                                    .padding(.top, 12)
                                    .padding(.bottom, controlsCollapsed ? 122 : 158)
                                    .frame(maxWidth: .infinity)
                                }
                                .coordinateSpace(name: readerScrollSpaceName)
                                .scrollIndicators(.hidden)
                                .opacity(readerContentVisible ? 1 : 0)
                                .blur(radius: readerContentVisible ? 0 : 10)
                                .scaleEffect(readerLiftedForBottomPanel ? 0.935 : 1, anchor: .top)
                                .offset(y: readerLiftedForBottomPanel ? -readerTypographyPanelLift : 0)
                                .padding(.bottom, readerLiftedForBottomPanel ? readerTypographyPanelLift : 0)
                                .animation(IllumeTheme.spring, value: readerLiftedForBottomPanel)
                                .animation(IllumeTheme.blurLoadIn, value: readerContentVisible)
                                .simultaneousGesture(
                                    SpatialTapGesture()
                                        .onEnded { value in
                                            handleReaderTap(
                                                value.location,
                                                viewportWidth: viewport.size.width,
                                                book: book,
                                                proxy: proxy
                                            )
                                        }
                                )
                                .simultaneousGesture(
                                    DragGesture(minimumDistance: 8)
                                        .onChanged { _ in
                                            revealReaderButtons()
                                        }
                                )
                                .onPreferenceChange(ReaderScrollOffsetPreferenceKey.self) { offset in
                                    let shouldCollapse = offset < -18
                                    guard controlsCollapsed != shouldCollapse else { return }
                                    withAnimation(IllumeTheme.spring) {
                                        controlsCollapsed = shouldCollapse
                                    }
                                }
                                .onAppear {
                                    restoreInitialPosition(in: book, proxy: proxy)
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
                                .onChange(of: app.activeBookRow?.id) {
                                    restoreInitialPosition(in: book, proxy: proxy)
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
            }

            if let book = app.activeBook {
                let isShowingImageMode = imageModeEnabled && imageParagraph(in: book) != nil
                let hideBottomControls = shouldHideReaderButtons

                VStack {
                    Spacer()
                    GeometryReader { geometry in
                        let useCompactControls = isShowingImageMode || controlsCollapsed || geometry.size.width < 430

                        VStack(spacing: speedPickerExpanded ? (useCompactControls ? 12 : 14) : (useCompactControls ? 7 : 9)) {
                            if !speedPickerExpanded {
                                ReaderProgressStrip(
                                    currentIndex: currentIndex,
                                    totalCount: book.paragraphs.count,
                                    chapterTitle: currentChapterTitle(in: book)
                                )
                                    .padding(.horizontal, useCompactControls ? 2 : 6)
                                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                            }

                            if speedPickerExpanded {
                                ReaderNarrationSpeedPickerPanel(
                                    rate: app.readerSettings.narrationRate,
                                    voiceID: app.readerSettings.narrationVoice,
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode,
                                    selectRate: { rate in
                                        app.setNarrationRate(rate)
                                        revealReaderButtons(autohide: false)
                                    },
                                    selectVoice: { voice in
                                        app.setNarrationVoice(voice.id)
                                        app.previewNarrationVoice(voice, in: book, from: currentIndex)
                                        revealReaderButtons(autohide: false)
                                    }
                                )
                                .frame(width: min(geometry.size.width - 28, useCompactControls ? 342 : 390))
                                .transition(.opacity.combined(with: .scale(scale: 0.94, anchor: .bottom)))
                            }

                            HStack(alignment: .bottom, spacing: useCompactControls ? 8 : 10) {
                                ReaderNarrationSpeedPickerButton(
                                    rate: app.readerSettings.narrationRate,
                                    voiceID: app.readerSettings.narrationVoice,
                                    isExpanded: speedPickerExpanded,
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode,
                                    toggleExpansion: {
                                        readerButtonsAutohideTask?.cancel()
                                        withAnimation(IllumeTheme.spring) {
                                            speedPickerExpanded.toggle()
                                        }
                                        revealReaderButtons(autohide: false)
                                    },
                                    selectRate: { rate in
                                        app.setNarrationRate(rate)
                                        revealReaderButtons(autohide: false)
                                    },
                                    selectVoice: { voice in
                                        app.setNarrationVoice(voice.id)
                                        app.previewNarrationVoice(voice, in: book, from: currentIndex)
                                        revealReaderButtons(autohide: false)
                                    }
                                )

                                if !speedPickerExpanded {
                                    ReaderTransportRail(
                                        book: book,
                                        currentIndex: currentIndex,
                                        isPlaying: app.narration.isPlaying,
                                        isPreparing: app.narration.isPreparing,
                                        isCollapsed: useCompactControls,
                                        onDarkBackground: isShowingImageMode,
                                        playPause: {
                                            app.toggleNarration(for: book, from: currentIndex)
                                        },
                                        moveToAndNarrate: { index in
                                            moveToAndNarrate(index, in: book)
                                        }
                                    )
                                    .transition(.opacity.combined(with: .scale(scale: 0.94, anchor: .bottom)))

                                    ReaderTypographySettingsButton(
                                        isCollapsed: useCompactControls,
                                        onDarkBackground: isShowingImageMode
                                    ) {
                                        toggleQuickMenu()
                                    }
                                    .transition(.opacity.combined(with: .scale(scale: 0.94, anchor: .bottom)))
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .center)
                            .offset(y: speedPickerExpanded ? 5 : 0)
                        }
                        .padding(.horizontal, 18)
                        .frame(width: geometry.size.width, alignment: .bottom)
                    }
                    .frame(height: readerControlsHeight(isShowingImageMode: isShowingImageMode, isExpanded: speedPickerExpanded))
                    .padding(.bottom, useCompactControlsBottomPadding(isShowingImageMode: isShowingImageMode))
                    .opacity(hideBottomControls ? 0 : 1)
                    .blur(radius: hideBottomControls ? 14 : 0)
                    .scaleEffect(hideBottomControls ? 0.96 : 1, anchor: .bottom)
                    .allowsHitTesting(!hideBottomControls)
                    .zIndex(8)
                    .animation(.easeOut(duration: 0.16), value: hideBottomControls)
                    .blurLoadIn(radius: 10)
                }
            }

            if let book = app.activeBook, quickMenuOpen {
                ZStack(alignment: .bottomTrailing) {
                    Color.black.opacity(0.001)
                        .ignoresSafeArea()
                        .onTapGesture {
                            closeQuickMenu()
                        }

                    ReaderQuickMenuOverlay(
                        progressPercent: readingProgressPercent(in: book),
                        hasTableOfContents: !tableOfContentsEntries(for: book).isEmpty,
                        imageModeEnabled: $imageModeEnabled,
                        imageModeLoading: app.readerImagePhase == .checking || app.readerImagePhase == .generating,
                        imageModeDisabled: imageParagraph(in: book) == nil,
                        openContents: {
                            closeQuickMenu()
                            activeReaderSheet = .contents
                        },
                        openImageStyles: {
                            closeQuickMenu()
                            activeReaderSheet = .imageStyles
                        },
                        openFontSettings: {
                            closeQuickMenu()
                            activeReaderSheet = .fontSettings
                        },
                        toggleImageMode: { toggleImageMode(for: book) }
                    )
                    .frame(width: min(UIScreen.main.bounds.width - 72, 304))
                    .padding(.trailing, 17)
                    .padding(.bottom, 18)
                    .transition(.readerQuickMenuBubble)
                }
                .zIndex(12)
            }
        }
        .foregroundStyle(ReaderDefaultStyle.foreground)
        .sheet(item: $activeReaderSheet) { destination in
            readerSheet(for: destination)
        }
        .onChange(of: activeReaderSheet) {
            withAnimation(IllumeTheme.spring) {
                readerLiftedForBottomPanel = activeReaderSheet != nil
            }
            if activeReaderSheet != nil {
                closeQuickMenu()
                revealReaderButtons(autohide: false)
            } else {
                scheduleReaderButtonsAutohide()
            }
        }
        .onChange(of: currentIndex) {
            if !isNarrationActive {
                revealReaderButtons()
            }
            guard imageModeEnabled, let book = app.activeBook else { return }
            scheduleImageGeneration(for: book)
        }
        .onChange(of: app.narration.isPreparing) {
            if app.narration.isPreparing {
                readerButtonsAutohideTask?.cancel()
            } else {
                scheduleReaderButtonsAutohide()
            }
        }
        .onChange(of: app.narration.paragraphID) {
            guard let book = app.activeBook,
                  let paragraphID = app.narration.paragraphID,
                  let index = book.paragraphs.firstIndex(where: { $0.id == paragraphID }) else { return }
            currentIndex = index
            app.saveProgress(index: index, page: book.paragraphs[index].pageNumber ?? 1)
        }
        .onChange(of: app.activeBookRow?.id) {
            revealReaderButtons()
            if let book = app.activeBook {
                restoreInitialIndex(in: book)
            }
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
            guard let book = app.activeBook else { return }
            restoreInitialIndex(in: book)
            revealReaderButtons()
            guard imageModeEnabled else { return }
            scheduleImageGeneration(for: book, delay: .zero)
        }
        .onDisappear {
            imageModeTask?.cancel()
            imageModeTask = nil
            readerButtonsAutohideTask?.cancel()
            readerButtonsAutohideTask = nil
        }
    }

    private func toggleImageMode(for book: ReaderBook) {
        imageModeEnabled.toggle()
        if !imageModeEnabled {
            revealReaderButtons()
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

    private func toggleReaderButtons() {
        readerButtonsAutohideTask?.cancel()
        if readerButtonsHidden {
            revealReaderButtons()
        } else {
            hideReaderButtons()
        }
    }

    private func revealReaderButtons(autohide: Bool = true) {
        readerButtonsAutohideTask?.cancel()
        if readerButtonsHidden {
            withAnimation(.easeOut(duration: 0.16)) {
                readerButtonsHidden = false
            }
        }
        if autohide {
            scheduleReaderButtonsAutohide()
        }
    }

    private func scheduleReaderButtonsAutohide() {
        readerButtonsAutohideTask?.cancel()
        guard !app.narration.isPreparing, !quickMenuOpen, !speedPickerExpanded else { return }
        readerButtonsAutohideTask = Task { @MainActor in
            try? await Task.sleep(for: readerButtonsAutohideDelay)
            guard !Task.isCancelled else { return }
            hideReaderButtons()
        }
    }

    private func hideReaderButtons() {
        guard activeReaderSheet == nil, !app.narration.isPreparing, !quickMenuOpen else { return }
        withAnimation(IllumeTheme.spring) {
            speedPickerExpanded = false
        }
        withAnimation(.easeOut(duration: 0.16)) {
            readerButtonsHidden = true
        }
    }

    private func toggleQuickMenu() {
        readerButtonsAutohideTask?.cancel()
        revealReaderButtons(autohide: false)
        withAnimation(quickMenuOpen ? readerQuickMenuCloseAnimation : readerQuickMenuOpenAnimation) {
            speedPickerExpanded = false
            quickMenuOpen.toggle()
            readerLiftedForBottomPanel = activeReaderSheet != nil
        }
    }

    private func closeQuickMenu() {
        guard quickMenuOpen else { return }
        withAnimation(readerQuickMenuCloseAnimation) {
            quickMenuOpen = false
            readerLiftedForBottomPanel = activeReaderSheet != nil
        }
    }

    @ViewBuilder
    private func readerSheet(for destination: ReaderSheetDestination) -> some View {
        if let book = app.activeBook {
            switch destination {
            case .contents:
                TableOfContentsSheet(
                    book: book,
                    entries: tableOfContentsEntries(for: book),
                    currentIndex: currentIndex,
                    progressPercent: readingProgressPercent(in: book)
                ) { entry in
                    selectTableOfContentsEntry(entry, in: book)
                }
                .presentationDetents([.medium, .large])
                .presentationCornerRadius(42)
            case .imageStyles:
                ReaderImageStyleSheet()
                    .presentationDetents([.height(360), .medium])
                    .presentationCornerRadius(42)
            case .fontSettings:
                ReaderFontSettingsSheet()
                    .presentationDetents([.medium])
                    .presentationCornerRadius(42)
            }
        } else {
            EmptyView()
        }
    }

    private func selectTableOfContentsEntry(_ entry: TableOfContentsEntry, in book: ReaderBook) {
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
        activeReaderSheet = nil
        Task { @MainActor in
            await Task.yield()
            withAnimation(IllumeTheme.blurLoadIn) {
                readerContentVisible = true
            }
        }
    }

    private func handleReaderTap(
        _ location: CGPoint,
        viewportWidth: CGFloat,
        book: ReaderBook,
        proxy: ScrollViewProxy
    ) {
        let textWidth = min(textColumnWidth + 36, viewportWidth)
        let horizontalMargin = max((viewportWidth - textWidth) / 2, 0)

        if location.x < horizontalMargin {
            blurNavigate(to: currentIndex - 1, in: book, proxy: proxy)
        } else if location.x > viewportWidth - horizontalMargin {
            blurNavigate(to: currentIndex + 1, in: book, proxy: proxy)
        } else {
            toggleReaderButtons()
        }
    }

    private func blurNavigate(to index: Int, in book: ReaderBook, proxy: ScrollViewProxy) {
        guard book.paragraphs.indices.contains(index), index != currentIndex else {
            revealReaderButtons()
            return
        }

        revealReaderButtons()
        withAnimation(.easeOut(duration: 0.1)) {
            readerContentVisible = false
        }

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(95))
            guard book.paragraphs.indices.contains(index) else { return }
            let paragraph = book.paragraphs[index]
            currentIndex = index
            app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
            proxy.scrollTo(paragraph.id, anchor: .top)
            withAnimation(IllumeTheme.blurLoadIn) {
                readerContentVisible = true
            }
        }
    }

    private func closeReader() {
        withAnimation(IllumeTheme.spring) {
            app.closeReader()
        }
        dismiss()
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

    private func restoreInitialIndex(in book: ReaderBook) {
        guard let row = app.activeBookRow else { return }
        let safeIndex = safeSavedIndex(for: row, in: book)
        guard restoredBookID != row.id || currentIndex != safeIndex else { return }
        restoredBookID = row.id
        initialPositionReady = false
        currentIndex = safeIndex
    }

    private func restoreInitialPosition(in book: ReaderBook, proxy: ScrollViewProxy) {
        guard let row = app.activeBookRow else { return }
        let safeIndex = safeSavedIndex(for: row, in: book)
        restoredBookID = row.id
        initialPositionReady = false
        currentIndex = safeIndex
        if book.paragraphs.indices.contains(safeIndex) {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                proxy.scrollTo(book.paragraphs[safeIndex].id, anchor: .top)
            }
        }

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard app.activeBookRow?.id == row.id else { return }
            initialPositionReady = true
        }
    }

    private func safeSavedIndex(for row: BookRow, in book: ReaderBook) -> Int {
        guard !book.paragraphs.isEmpty else { return 0 }
        return min(max(row.currentIndex, 0), book.paragraphs.count - 1)
    }

    private func updateVisibleParagraph(_ index: Int, paragraph: ReaderParagraph) {
        guard initialPositionReady || restoredBookID == nil else { return }
        guard currentIndex != index else { return }
        currentIndex = index
        app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
    }

    private func useCompactControlsHeight(isShowingImageMode: Bool) -> CGFloat {
        (isShowingImageMode || controlsCollapsed) ? 92 : 112
    }

    private func readerControlsHeight(isShowingImageMode: Bool, isExpanded: Bool) -> CGFloat {
        guard isExpanded else {
            return useCompactControlsHeight(isShowingImageMode: isShowingImageMode)
        }

        return (isShowingImageMode || controlsCollapsed) ? 176 : 204
    }

    private func useCompactControlsBottomPadding(isShowingImageMode: Bool) -> CGFloat {
        isShowingImageMode ? 20 : (controlsCollapsed ? 10 : 18)
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

    private func imageOverlayText(in book: ReaderBook) -> String? {
        guard let primaryParagraph = imageParagraph(in: book) else { return nil }
        let trimmedPrimary = primaryParagraph.text.trimmingCharacters(in: .whitespacesAndNewlines)
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
            if characterCount >= readerOverlayMinimumCharacters || characterCount >= readerOverlayExpandedMaximumCharacters {
                break
            }
        }

        if characterCount < readerOverlayMinimumCharacters {
            for paragraph in book.paragraphs[..<primaryIndex].reversed() where paragraph.kind != .heading {
                let trimmed = paragraph.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { continue }
                pieces.insert(trimmed, at: 0)
                characterCount += trimmed.count
                if characterCount >= readerOverlayMinimumCharacters || characterCount >= readerOverlayExpandedMaximumCharacters {
                    break
                }
            }
        }

        return pieces.joined(separator: "\n\n")
    }

    private func imageOverlayNarrationText(in book: ReaderBook) -> (text: String?, activeRange: NSRange?) {
        guard let paragraphID = app.narration.paragraphID,
              let paragraph = book.paragraphs.first(where: { $0.id == paragraphID }),
              let wordRange = app.narration.wordRange else {
            return (imageOverlayText(in: book), nil)
        }

        return narrationOverlayExcerpt(text: paragraph.text, activeRange: wordRange)
    }

    private func narrationOverlayExcerpt(text: String, activeRange: NSRange) -> (text: String, activeRange: NSRange) {
        let nsText = text as NSString
        guard activeRange.location >= 0,
              NSMaxRange(activeRange) <= nsText.length else {
            return (text, activeRange)
        }

        let chunkLength = readerOverlayCompactMaximumCharacters
        let rawStart = (activeRange.location / chunkLength) * chunkLength
        let rawEnd = min(nsText.length, rawStart + chunkLength)
        let start = adjustedOverlayStart(in: nsText, from: rawStart)
        let end = adjustedOverlayEnd(in: nsText, from: rawEnd)
        let hasPrefix = start > 0
        let hasSuffix = end < nsText.length
        let prefix = hasPrefix ? "... " : ""
        let suffix = hasSuffix ? " ..." : ""
        let excerpt = nsText.substring(with: NSRange(location: start, length: end - start))
        let adjustedRange = NSRange(
            location: prefix.utf16.count + activeRange.location - start,
            length: activeRange.length
        )

        return ("\(prefix)\(excerpt)\(suffix)", adjustedRange)
    }

    private func adjustedOverlayStart(in text: NSString, from offset: Int) -> Int {
        guard offset > 0 else { return 0 }
        var cursor = offset
        while cursor > 0 {
            let scalar = UnicodeScalar(text.character(at: cursor - 1))
            if let scalar, CharacterSet.whitespacesAndNewlines.contains(scalar) {
                return cursor
            }
            cursor -= 1
            if offset - cursor > 32 { return offset }
        }
        return 0
    }

    private func adjustedOverlayEnd(in text: NSString, from offset: Int) -> Int {
        guard offset < text.length else { return text.length }
        var cursor = offset
        while cursor < text.length {
            let scalar = UnicodeScalar(text.character(at: cursor))
            if let scalar, CharacterSet.whitespacesAndNewlines.contains(scalar) {
                return cursor
            }
            cursor += 1
            if cursor - offset > 32 { return offset }
        }
        return text.length
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

    private func readingProgressPercent(in book: ReaderBook) -> Int {
        if book.paragraphs.indices.contains(currentIndex),
           let currentPage = book.paragraphs[currentIndex].pageNumber,
           let pageCount = book.pageCount,
           pageCount > 0 {
            return min(100, max(0, Int((Double(currentPage) / Double(pageCount) * 100).rounded())))
        }

        guard book.paragraphs.count > 1 else { return book.paragraphs.isEmpty ? 0 : 100 }
        return min(100, max(0, Int((Double(currentIndex + 1) / Double(book.paragraphs.count) * 100).rounded())))
    }

    private func currentChapterTitle(in book: ReaderBook) -> String {
        guard book.paragraphs.indices.contains(currentIndex) else {
            return book.title
        }

        let paragraph = book.paragraphs[currentIndex]
        let paragraphTitle = paragraph.chapterTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !paragraphTitle.isEmpty {
            return paragraphTitle
        }

        if book.chapters.indices.contains(paragraph.chapterIndex) {
            let chapterTitle = book.chapters[paragraph.chapterIndex].trimmingCharacters(in: .whitespacesAndNewlines)
            if !chapterTitle.isEmpty {
                return chapterTitle
            }
        }

        return book.title
    }
}

struct ReaderToolbar: View {
    let bookTitle: String
    var onDarkBackground = true
    let close: () -> Void

    private var foreground: Color {
        onDarkBackground ? .white : IllumeTheme.paper
    }

    private var buttonTint: Color {
        onDarkBackground ? IllumeTheme.ink : IllumeTheme.paper
    }

    var body: some View {
        ZStack {
            Text(bookTitle)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(foreground.opacity(onDarkBackground ? 0.88 : 0.78))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .padding(.horizontal, 64)
                .frame(maxWidth: .infinity, alignment: .center)

            HStack {
                Spacer()

                Button(action: close) {
                    Image(systemName: "books.vertical.fill")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(foreground)
                        .frame(width: 40, height: 40)
                }
                .illumeNativeGlassButton(tint: buttonTint, borderShape: .circle, controlSize: .small, isProminent: true, fallback: ReaderGlassCircleButtonStyle(tint: buttonTint, pressedScale: 0.86))
                .contentShape(Circle())
                .accessibilityLabel("Back to library")
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .zIndex(4)
    }
}

private enum ReaderDefaultStyle {
    static let background = Color(red: 1.0, green: 0.972, blue: 0.914)
    static let foreground = IllumeTheme.paper
}

struct ReaderProgressStrip: View {
    let currentIndex: Int
    let totalCount: Int
    let chapterTitle: String

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

    private var progressPercent: Int {
        guard totalCount > 0 else { return 0 }
        return min(100, max(0, Int((Double(currentPosition) / Double(safeTotal) * 100).rounded())))
    }

    private var displayChapterTitle: String {
        let trimmedTitle = chapterTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedTitle.isEmpty ? "Chapter" : trimmedTitle
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

            Text("\(displayChapterTitle)  \(progressPercent)%")
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .monospacedDigit()
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 18)
            .font(.system(size: 13, weight: .bold, design: .rounded))
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
    @Environment(\.dismiss) private var dismiss

    let book: ReaderBook
    let entries: [TableOfContentsEntry]
    let currentIndex: Int
    let progressPercent: Int
    let select: (TableOfContentsEntry) -> Void

    private var currentEntryID: Int? {
        entries.last(where: { $0.paragraphIndex <= currentIndex })?.id
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                TableOfContentsHeader(book: book, progressPercent: progressPercent)

                Divider()
                    .overlay(TableOfContentsStyle.divider)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 9)

                LazyVStack(spacing: 0) {
                    ForEach(entries) { entry in
                        Button {
                            select(entry)
                        } label: {
                            TableOfContentsRow(entry: entry, isCurrent: entry.id == currentEntryID)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 28)
            }
        }
        .scrollIndicators(.hidden)
        .scrollContentBackground(.hidden)
        .background(TableOfContentsStyle.background)
        .overlay(alignment: .topTrailing) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 27, weight: .medium))
                    .foregroundStyle(TableOfContentsStyle.closeIcon)
                    .frame(width: 58, height: 58)
                    .background(.white.opacity(0.82), in: Circle())
                    .shadow(color: .black.opacity(0.08), radius: 18, y: 10)
            }
            .buttonStyle(.plain)
            .padding(.top, 38)
            .padding(.trailing, 38)
            .accessibilityLabel("Close table of contents")
        }
        .presentationCornerRadius(42)
        .presentationBackground(.clear)
    }
}

private enum TableOfContentsStyle {
    static let background = Color(red: 0.075, green: 0.073, blue: 0.068)
    static let ink = Color.white.opacity(0.94)
    static let secondaryText = Color.white.opacity(0.46)
    static let divider = Color.white.opacity(0.12)
    static let closeIcon = Color.white.opacity(0.62)
}

struct TableOfContentsHeader: View {
    let book: ReaderBook
    let progressPercent: Int

    var body: some View {
        HStack(alignment: .center, spacing: 17) {
            cover

            VStack(alignment: .leading, spacing: 12) {
                Text(book.title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(TableOfContentsStyle.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.trailing, 86)

                pageProgress
            }
        }
        .padding(.leading, 33)
        .padding(.trailing, 28)
        .padding(.top, 44)
        .padding(.bottom, 29)
    }

    @ViewBuilder
    private var cover: some View {
        ZStack(alignment: .bottomLeading) {
            if let coverUrl = book.coverUrl, !coverUrl.isEmpty {
                CoverArtwork(urlString: coverUrl)
            } else {
                fallbackCover
            }
        }
        .frame(width: 55, height: 80)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .shadow(color: .black.opacity(0.16), radius: 7, x: 0, y: 3)
    }

    private var fallbackCover: some View {
        LinearGradient(
            colors: [IllumeTheme.ink, IllumeTheme.accent, Color.black],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .bottomLeading) {
            Text(book.title.prefix(1))
                .font(.system(size: 32, weight: .black, design: .rounded))
                .foregroundStyle(.white.opacity(0.88))
                .padding(7)
        }
    }

    private var pageProgress: some View {
        HStack(spacing: 6) {
            Text("Progress")
                .foregroundStyle(TableOfContentsStyle.secondaryText)

            Text("\(progressPercent)%")
                .foregroundStyle(TableOfContentsStyle.ink)
        }
        .font(.system(size: 21, weight: .regular))
        .monospacedDigit()
        .lineLimit(1)
    }
}

struct TableOfContentsRow: View {
    let entry: TableOfContentsEntry
    let isCurrent: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(entry.title)
                .font(.system(size: isSection ? 17 : 18, weight: rowWeight))
                .foregroundStyle(TableOfContentsStyle.ink)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            if let pageNumber = entry.pageNumber {
                Text("\(pageNumber)")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(TableOfContentsStyle.secondaryText)
                    .monospacedDigit()
                    .padding(.top, 1)
            }
        }
        .padding(.leading, isSection ? 28 : 47)
        .padding(.trailing, 38)
        .padding(.vertical, isSection ? 15 : 16)
        .background(isCurrent ? Color.white.opacity(0.055) : Color.clear)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(TableOfContentsStyle.divider)
                .frame(height: 0.7)
                .padding(.leading, isSection ? 28 : 47)
                .padding(.trailing, 28)
        }
    }

    private var isSection: Bool {
        let trimmed = entry.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let firstWord = trimmed.split(separator: " ").first else { return false }
        return firstWord.trimmingCharacters(in: CharacterSet(charactersIn: ".")).allSatisfy { character in
            "IVXLCDM".contains(character)
        }
    }

    private var rowWeight: Font.Weight {
        isCurrent || isSection ? .bold : .regular
    }
}

struct ParagraphView: View {
    @EnvironmentObject private var app: IllumeAppModel
    let paragraph: ReaderParagraph
    let index: Int
    let selectParagraph: () -> Void

    var body: some View {
        let isSpeaking = app.narration.paragraphID == paragraph.id
        let activeParagraphIndex = app.activeBook?.paragraphs.firstIndex { $0.id == app.narration.paragraphID }
        let isFutureParagraph = activeParagraphIndex.map { index > $0 } ?? false

        ReaderAttributedText(
            text: paragraph.text,
            font: uiFont,
            textColor: UIColor(themeForeground.opacity(isFutureParagraph ? 0.22 : 1)),
            lineSpacing: 6 * min(app.readerSettings.lineHeight, 1.65),
            activeRange: isSpeaking ? app.narration.wordRange : nil,
            activeHighlightColor: UIColor(wordHighlightColor)
        ) {
            selectParagraph()
        } selectWord: { wordStart in
            guard let book = app.activeBook else { return }
            selectParagraph()
            app.speak(book: book, paragraphIndex: index, wordStart: wordStart)
        }
        .padding(.horizontal, 10)
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
        ReaderDefaultStyle.foreground
    }

    private var uiFont: UIFont {
        let scale = min(app.readerSettings.textScale, 1.25)
        let size = 18 * scale
        switch paragraph.kind {
        case .heading:
            return UIFont.systemSerifFont(ofSize: 25 * scale, weight: .black)
        case .quote:
            let font = UIFont.systemSerifFont(ofSize: size, weight: .medium)
            let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor
            return UIFont(descriptor: descriptor, size: size)
        default:
            return UIFont.systemSerifFont(ofSize: size, weight: .regular)
        }
    }

    private var speakingHighlightColor: Color {
        Color(red: 0.918, green: 0.961, blue: 1.0)
    }

    private var wordHighlightColor: Color {
        Color(red: 1.0, green: 0.78, blue: 0.18).opacity(0.62)
    }
}

struct ReaderAttributedText: UIViewRepresentable {
    let text: String
    let font: UIFont
    let textColor: UIColor
    let lineSpacing: CGFloat
    let activeRange: NSRange?
    let activeHighlightColor: UIColor
    var futureTextOpacity: CGFloat = 0.22
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
            activeRange: activeRange,
            activeHighlightColor: activeHighlightColor,
            futureTextOpacity: futureTextOpacity
        )
        guard context.coordinator.renderKey != renderKey else { return }
        let previousActiveRange = context.coordinator.renderKey?.activeRange
        context.coordinator.renderKey = renderKey
        let applyText = {
            textView.attributedText = attributedString
        }

        if previousActiveRange != activeRange, activeRange != nil {
            UIView.transition(
                with: textView,
                duration: 0.18,
                options: [.transitionCrossDissolve, .allowUserInteraction, .beginFromCurrentState],
                animations: applyText
            )
        } else {
            applyText()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width
        let measuringTextView = UITextView()
        measuringTextView.isScrollEnabled = false
        measuringTextView.textContainerInset = .zero
        measuringTextView.textContainer.lineFragmentPadding = 0
        measuringTextView.attributedText = baseAttributedString
        let size = measuringTextView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    private var baseAttributedString: NSAttributedString {
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = lineSpacing

        return NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle
            ]
        )
    }

    private var attributedString: NSAttributedString {
        let nsText = text as NSString
        let attributed = NSMutableAttributedString(attributedString: baseAttributedString)

        if let activeRange,
           activeRange.location >= 0,
           NSMaxRange(activeRange) <= nsText.length {
            let shadow = NSShadow()
            shadow.shadowBlurRadius = 10
            shadow.shadowColor = activeHighlightColor.withAlphaComponent(0.65)
            shadow.shadowOffset = .zero

            let futureStart = NSMaxRange(activeRange)
            if futureStart < nsText.length {
                attributed.addAttributes(
                    [
                        .foregroundColor: textColor.withAlphaComponent(futureTextOpacity)
                    ],
                    range: NSRange(location: futureStart, length: nsText.length - futureStart)
                )
            }

            attributed.addAttributes(
                [
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
        let activeHighlightColor: UIColor
        let futureTextOpacity: CGFloat

        static func == (lhs: RenderKey, rhs: RenderKey) -> Bool {
            lhs.text == rhs.text
                && lhs.fontName == rhs.fontName
                && lhs.fontSize == rhs.fontSize
                && lhs.textColor.isEqual(rhs.textColor)
                && lhs.lineSpacing == rhs.lineSpacing
                && lhs.activeRange == rhs.activeRange
                && lhs.activeHighlightColor.isEqual(rhs.activeHighlightColor)
                && lhs.futureTextOpacity == rhs.futureTextOpacity
        }
    }
}

private extension UIFont {
    static func systemSerifFont(ofSize size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let baseFont = UIFont.systemFont(ofSize: size, weight: weight)
        guard let descriptor = baseFont.fontDescriptor.withDesign(.serif) else {
            return baseFont
        }

        return UIFont(descriptor: descriptor, size: size)
    }
}

struct ReaderTransportRail: View {
    @EnvironmentObject private var app: IllumeAppModel
    @State private var voicePopoverOpen = false
    @State private var speedPopoverOpen = false

    let book: ReaderBook
    let currentIndex: Int
    let isPlaying: Bool
    let isPreparing: Bool
    let isCollapsed: Bool
    var onDarkBackground = false
    let playPause: () -> Void
    let moveToAndNarrate: (Int) -> Void

    var body: some View {
        IllumeGlassEffectGroup(spacing: railSpacing) {
            HStack(spacing: railSpacing) {
                if !isCollapsed {
                    Button {
                        voicePopoverOpen.toggle()
                        speedPopoverOpen = false
                    } label: {
                        Text(KokoroNarrationVoice.symbol(for: app.readerSettings.narrationVoice))
                            .font(.system(.subheadline, design: .rounded, weight: .black))
                            .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
                            .frame(width: compactButtonSize, height: compactButtonSize)
                    }
                    .illumeNativeGlassButton(tint: buttonTint, borderShape: .circle, controlSize: .small, fallback: ReaderGlassCircleButtonStyle(tint: buttonTint))
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
                    isPreparing: isPreparing,
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
                            .frame(width: 40, height: compactButtonSize)
                    }
                    .illumeNativeGlassButton(tint: buttonTint, controlSize: .small, fallback: ReaderGlassCapsuleButtonStyle(tint: buttonTint))
                    .accessibilityLabel("Narration speed")
                    .popover(isPresented: $speedPopoverOpen, attachmentAnchor: .point(.top), arrowEdge: .bottom) {
                        NarrationSpeedPopover()
                            .presentationCompactAdaptation(.popover)
                    }
                }
            }
        }
        .padding(.horizontal, railInset)
        .padding(.vertical, railInset)
        .illumeLiquidGlassCapsule(
            tint: railTint
        )
        .shadow(color: onDarkBackground ? .black.opacity(0.22) : .clear, radius: 20, x: 0, y: 12)
        .animation(IllumeTheme.spring, value: isCollapsed)
    }

    private var railSpacing: CGFloat {
        isCollapsed ? 6 : 8
    }

    private var railInset: CGFloat {
        isCollapsed ? 5 : 7
    }

    private var compactButtonSize: CGFloat {
        onDarkBackground ? 50 : 42
    }

    private var buttonTint: Color {
        onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper
    }

    private var railTint: Color {
        onDarkBackground ? .white.opacity(0.18) : IllumeTheme.paper
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
        IllumeGlassEffectGroup(spacing: 6) {
            VStack(spacing: 6) {
                ForEach(KokoroNarrationVoice.allCases) { option in
                    let isSelected = app.readerSettings.narrationVoice == option.id

                    Button {
                        app.setNarrationVoice(option.id)
                        dismiss()
                    } label: {
                        HStack(spacing: 10) {
                            Text(option.symbol)
                                .font(.system(.subheadline, design: .rounded, weight: .black))
                                .frame(width: 22)
                            Text(option.label)
                                .font(.system(.subheadline, design: .rounded, weight: .bold))
                            Spacer()
                            if isSelected {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 12, weight: .black))
                            }
                        }
                        .foregroundStyle(isSelected ? .white : IllumeTheme.ink.opacity(0.72))
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: IllumeTheme.minimumTouchTarget)
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .illumeNativeGlassButton(
                        tint: isSelected ? IllumeTheme.ink : IllumeTheme.paper,
                        borderShape: .roundedRectangle(radius: 12),
                        controlSize: .small,
                        isProminent: isSelected,
                        fallback: LiquidCardButtonStyle(cornerRadius: 12, tint: isSelected ? IllumeTheme.ink : IllumeTheme.paper)
                    )
                }
            }
        }
        .padding(8)
        .frame(width: 200)
        .illumeLiquidGlassRounded(cornerRadius: 18, tint: ReaderSheetGlass.panelTint)
    }
}

struct NarrationSpeedPopover: View {
    @EnvironmentObject private var app: IllumeAppModel
    private let presets = [1.0, 1.25, 1.5, 2.0]

    var body: some View {
        VStack(spacing: 14) {
            Slider(value: narrationRateBinding, in: 0.7...2.0, step: 0.05)
                .tint(IllumeTheme.ink)
                .frame(width: 190)

            HStack(spacing: 8) {
                ForEach(presets, id: \.self) { preset in
                    let isSelected = abs(app.readerSettings.narrationRate - preset) < 0.01

                    Button {
                        app.setNarrationRate(preset)
                    } label: {
                        Text(ReaderTransportRail.formatRate(preset))
                            .font(.system(.caption, design: .rounded, weight: .black))
                            .foregroundStyle(isSelected ? .white : IllumeTheme.ink.opacity(0.66))
                            .padding(.horizontal, 9)
                            .frame(minHeight: IllumeTheme.minimumTouchTarget)
                            .contentShape(Capsule())
                    }
                    .illumeNativeGlassButton(
                        tint: isSelected ? IllumeTheme.ink : IllumeTheme.paper,
                        controlSize: .small,
                        isProminent: isSelected,
                        fallback: ReaderGlassCapsuleButtonStyle(tint: isSelected ? IllumeTheme.ink : IllumeTheme.paper)
                    )
                }
            }
        }
        .padding(14)
        .illumeLiquidGlassRounded(cornerRadius: 18, tint: ReaderSheetGlass.panelTint)
    }

    private var narrationRateBinding: Binding<Double> {
        Binding(
            get: { app.readerSettings.narrationRate },
            set: { app.setNarrationRate($0) }
        )
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
                isInteractive: true,
                pressedScale: pressedScale
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
                isInteractive: true,
                pressedScale: pressedScale
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
        .illumeNativeGlassButton(tint: onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper, borderShape: .circle, controlSize: .small, fallback: ReaderGlassCircleButtonStyle(tint: onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper))
        .disabled(isDisabled)
        .opacity(isDisabled ? (onDarkBackground ? 0.42 : 0.35) : 1)
    }

    private var buttonSize: CGFloat {
        onDarkBackground ? (isCompact ? 46 : 50) : (isCompact ? 40 : 42)
    }
}

struct ReaderNarrationButton: View {
    let isPlaying: Bool
    let isPreparing: Bool
    var isCompact = false
    var onDarkBackground = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            narrationIcon
        }
        .illumeNativeGlassButton(tint: narrationTint, borderShape: .circle, controlSize: .small, fallback: ReaderGlassCircleButtonStyle(tint: narrationTint))
        .accessibilityLabel(accessibilityLabel)
    }

    private var narrationIcon: some View {
        Group {
            if isPreparing {
                ProgressView()
                    .progressViewStyle(.circular)
                    .controlSize(.small)
                    .tint(onDarkBackground ? .white : IllumeTheme.ink)
            } else {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: onDarkBackground ? 20 : (isCompact ? 17 : 20), weight: .black))
                    .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
            }
        }
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

    private var accessibilityLabel: String {
        if isPreparing {
            return "Preparing narration"
        }
        return isPlaying ? "Pause narration" : "Play narration"
    }
}

struct ReaderNarrationSpeedPickerButton: View {
    let rate: Double
    let voiceID: String
    let isExpanded: Bool
    var isCollapsed = false
    var onDarkBackground = false
    let toggleExpansion: () -> Void
    let selectRate: (Double) -> Void
    let selectVoice: (KokoroNarrationVoice) -> Void

    private let presets = [0.7, 1.0, 1.25, 1.5, 1.75, 2.0]

    var body: some View {
        Button(action: toggleExpansion) {
            speedLabel
        }
        .illumeNativeGlassButton(tint: buttonTint, borderShape: .circle, controlSize: .small, fallback: ReaderGlassCircleButtonStyle(tint: buttonTint))
        .accessibilityLabel("Narration speed")
        .accessibilityValue(ReaderTransportRail.formatRate(rate))
        .frame(width: iconSize, height: iconSize, alignment: .bottomLeading)
        .animation(IllumeTheme.spring, value: isExpanded)
    }

    private var speedLabel: some View {
        Text(ReaderTransportRail.formatRate(rate))
            .font(.system(size: onDarkBackground ? 14 : (isCollapsed ? 12 : 14), weight: .black, design: .rounded))
            .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
            .minimumScaleFactor(0.72)
            .lineLimit(1)
            .frame(width: iconSize, height: iconSize)
    }

    private var iconSize: CGFloat {
        onDarkBackground ? 50 : (isCollapsed ? 44 : 54)
    }

    private var buttonTint: Color {
        onDarkBackground ? .white.opacity(0.16) : IllumeTheme.paper
    }
}

struct ReaderNarrationSpeedPickerPanel: View {
    let rate: Double
    let voiceID: String
    var isCollapsed = false
    var onDarkBackground = false
    let selectRate: (Double) -> Void
    let selectVoice: (KokoroNarrationVoice) -> Void

    private let presets = [0.7, 1.0, 1.25, 1.5, 1.75, 2.0]

    var body: some View {
        IllumeGlassEffectGroup(spacing: 9) {
            VStack(spacing: 9) {
                speedPresetScroller
                voicePresetScroller
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .illumeLiquidGlassCapsule(tint: expandedTint)
        .shadow(color: onDarkBackground ? .black.opacity(0.36) : .black.opacity(0.18), radius: 22, x: 0, y: 12)
        .overlay {
            Capsule()
                .strokeBorder(onDarkBackground ? .white.opacity(0.18) : IllumeTheme.ink.opacity(0.08), lineWidth: 1)
        }
        .clipShape(Capsule())
    }

    private var speedPresetScroller: some View {
        HStack(spacing: 8) {
            pickerLeadLabel(
                title: ReaderTransportRail.formatRate(rate),
                accessibilityLabel: "Current narration speed"
            )

            Divider()
                .frame(height: iconSize * 0.54)
                .overlay((onDarkBackground ? Color.white : IllumeTheme.ink).opacity(0.18))

            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(presets, id: \.self) { preset in
                            let isSelected = abs(rate - preset) < 0.01

                            Button {
                                selectRate(preset)
                                withAnimation(IllumeTheme.spring) {
                                    proxy.scrollTo(preset, anchor: .center)
                                }
                            } label: {
                                Text(ReaderTransportRail.formatRate(preset))
                                    .font(.system(size: isCollapsed ? 12 : 13, weight: .black, design: .rounded))
                                    .foregroundStyle(isSelected ? selectedTextColor : pickerTextColor)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.78)
                                    .frame(width: isCollapsed ? 46 : 50, height: iconSize - 10)
                            }
                            .id(preset)
                            .illumeNativeGlassButton(
                                tint: isSelected ? selectedTint : pickerButtonTint,
                                controlSize: .small,
                                isProminent: isSelected,
                                fallback: ReaderGlassCapsuleButtonStyle(tint: isSelected ? selectedTint : pickerButtonTint)
                            )
                            .accessibilityLabel("Set narration speed")
                            .accessibilityValue(ReaderTransportRail.formatRate(preset))
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .frame(maxWidth: .infinity, minHeight: iconSize, maxHeight: iconSize)
                .clipped()
                .onAppear {
                    let selectedPreset = presets.min(by: { abs($0 - rate) < abs($1 - rate) }) ?? 1.0
                    proxy.scrollTo(selectedPreset, anchor: .center)
                }
            }
        }
    }

    private var voicePresetScroller: some View {
        HStack(spacing: 8) {
            pickerLeadLabel(
                title: KokoroNarrationVoice.symbol(for: voiceID),
                accessibilityLabel: "Current narration voice"
            )

            Divider()
                .frame(height: iconSize * 0.54)
                .overlay((onDarkBackground ? Color.white : IllumeTheme.ink).opacity(0.18))

            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(KokoroNarrationVoice.allCases) { voice in
                            let isSelected = KokoroNarrationVoice.availableVoice(for: voiceID) == voice

                            Button {
                                selectVoice(voice)
                                withAnimation(IllumeTheme.spring) {
                                    proxy.scrollTo(voice.id, anchor: .center)
                                }
                            } label: {
                                Text(voice.symbol)
                                    .font(.system(size: isCollapsed ? 12 : 13, weight: .black, design: .rounded))
                                    .foregroundStyle(isSelected ? selectedTextColor : pickerTextColor)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.68)
                                    .frame(width: isCollapsed ? 58 : 64, height: iconSize - 12)
                            }
                            .id(voice.id)
                            .illumeNativeGlassButton(
                                tint: isSelected ? selectedTint : pickerButtonTint,
                                controlSize: .small,
                                isProminent: isSelected,
                                fallback: ReaderGlassCapsuleButtonStyle(tint: isSelected ? selectedTint : pickerButtonTint)
                            )
                            .accessibilityLabel("Set narration voice")
                            .accessibilityValue(voice.label)
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .frame(maxWidth: .infinity, minHeight: iconSize, maxHeight: iconSize)
                .clipped()
                .onAppear {
                    proxy.scrollTo(KokoroNarrationVoice.availableVoice(for: voiceID).id, anchor: .center)
                }
            }
        }
    }

    private func pickerLeadLabel(title: String, accessibilityLabel: String) -> some View {
        Text(title)
            .font(.system(size: onDarkBackground ? 14 : (isCollapsed ? 12 : 14), weight: .black, design: .rounded))
            .foregroundStyle(onDarkBackground ? .white : IllumeTheme.ink)
            .minimumScaleFactor(0.72)
            .lineLimit(1)
            .frame(width: iconSize, height: iconSize)
            .accessibilityLabel(accessibilityLabel)
    }

    private var iconSize: CGFloat {
        onDarkBackground ? 50 : (isCollapsed ? 44 : 54)
    }

    private var expandedTint: Color {
        onDarkBackground ? .black.opacity(0.42) : IllumeTheme.paper.opacity(0.98)
    }

    private var pickerButtonTint: Color {
        onDarkBackground ? .white.opacity(0.14) : .white.opacity(0.58)
    }

    private var selectedTint: Color {
        onDarkBackground ? .white.opacity(0.92) : IllumeTheme.ink
    }

    private var pickerTextColor: Color {
        onDarkBackground ? .white.opacity(0.78) : IllumeTheme.ink.opacity(0.68)
    }

    private var selectedTextColor: Color {
        IllumeTheme.ink
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
        .illumeNativeGlassButton(tint: buttonTint, borderShape: .circle, controlSize: .small, fallback: ReaderGlassCircleButtonStyle(tint: buttonTint))
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

struct ReaderQuickMenuOverlay: View {
    let progressPercent: Int
    let hasTableOfContents: Bool
    @Binding var imageModeEnabled: Bool
    let imageModeLoading: Bool
    let imageModeDisabled: Bool
    let openContents: () -> Void
    let openImageStyles: () -> Void
    let openFontSettings: () -> Void
    let toggleImageMode: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            VStack(spacing: 10) {
                ReaderQuickMenuRow(
                    title: "Contents • \(progressPercent)%",
                    systemName: "list.bullet",
                    isDisabled: !hasTableOfContents,
                    action: openContents
                )

                ReaderQuickMenuRow(
                    title: "Image Styles",
                    systemName: "paintpalette.fill",
                    action: openImageStyles
                )

                ReaderQuickMenuRow(
                    title: "Font Settings",
                    systemName: "textformat.size",
                    action: openFontSettings
                )
            }

            HStack(spacing: 14) {
                ReaderQuickMenuIconButton(
                    systemName: imageModeEnabled ? "photo.fill" : "photo",
                    isSelected: imageModeEnabled,
                    isLoading: imageModeLoading && imageModeEnabled,
                    isDisabled: imageModeDisabled,
                    accessibilityLabel: "Image mode",
                    action: toggleImageMode
                )

                ReaderQuickMenuIconButton(
                    systemName: "paintpalette",
                    accessibilityLabel: "Image styles",
                    action: openImageStyles
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 16)
        .background(.clear)
        .illumeLiquidGlassRounded(cornerRadius: 28, tint: ReaderSheetGlass.menuPanelTint)
        .shadow(color: .black.opacity(0.16), radius: 28, x: 0, y: 18)
    }
}

struct ReaderQuickMenuRow: View {
    let title: String
    let systemName: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Text(title)
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(.black.opacity(isDisabled ? 0.34 : 0.88))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)

                Spacer(minLength: 12)

                Image(systemName: systemName)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.black.opacity(isDisabled ? 0.26 : 0.88))
                    .frame(width: 34)
            }
            .padding(.leading, 18)
            .padding(.trailing, 16)
            .frame(height: 56)
            .contentShape(Capsule())
        }
        .buttonStyle(ReaderGlassCapsuleButtonStyle(tint: Color.white.opacity(0.7), pressedScale: 0.965))
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.58 : 1)
    }
}

struct ReaderQuickMenuIconButton: View {
    let systemName: String
    var isSelected = false
    var isLoading = false
    var isDisabled = false
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isLoading {
                    ProgressView()
                        .controlSize(.regular)
                        .tint(isSelected ? .white : .black)
                } else {
                    Image(systemName: systemName)
                        .font(.system(size: 23, weight: .semibold))
                }
            }
            .foregroundStyle(isSelected ? .white : .black.opacity(0.9))
            .frame(width: 58, height: 52)
        }
        .buttonStyle(ReaderGlassCapsuleButtonStyle(tint: isSelected ? Color.black.opacity(0.78) : Color.white.opacity(0.72), pressedScale: 0.94))
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.42 : 1)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(isSelected ? "On" : "Off")
    }
}

struct ReaderFontSettingsSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        if #available(iOS 26.0, *) {
            ReaderFontSettingsLiquidGlassSheet()
                .presentationBackground(.clear)
        } else {
            ReaderFontSettingsFallbackSheet()
                .presentationBackground(.clear)
        }
    }
}

@available(iOS 26.0, *)
private struct ReaderFontSettingsLiquidGlassSheet: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Namespace private var glassNamespace
    @State private var isExpanded = false

    private enum GlassID: String {
        case panel
        case sliders
    }

    var body: some View {
        GlassEffectContainer(spacing: isExpanded ? 20 : 44) {
            VStack(alignment: .leading, spacing: isExpanded ? 22 : 8) {
                Capsule()
                    .fill(.secondary.opacity(0.25))
                    .frame(width: 42, height: 5)
                    .frame(maxWidth: .infinity)

                if isExpanded {
                    Text("Font Settings")
                        .font(.system(.largeTitle, design: .rounded, weight: .black))
                        .transition(
                            .scale(0.96, anchor: .top)
                                .combined(with: .blurReplace)
                        )

                    VStack(spacing: 12) {
                        SliderRow(label: "Text size", value: $app.readerSettings.textScale, range: 0.82...1.25, valueText: "\(Int(app.readerSettings.textScale * 100))%")
                        SliderRow(label: "Line height", value: $app.readerSettings.lineHeight, range: 1.0...1.65, valueText: String(format: "%.2fx", app.readerSettings.lineHeight))
                        SliderRow(label: "Column width", value: $app.readerSettings.lineWidth, range: 32...52, valueText: "\(Int(app.readerSettings.lineWidth))")
                    }
                    .glassEffectID(GlassID.sliders, in: glassNamespace)
                    .transition(
                        .scale(scale: 0.72, anchor: .top)
                            .combined(with: .offset(y: -18))
                            .combined(with: .opacity)
                    )

                    Spacer()
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.clear)
            .glassEffect(.regular.tint(ReaderSheetGlass.panelTint), in: RoundedRectangle(cornerRadius: 30, style: .continuous))
            .glassEffectID(GlassID.panel, in: glassNamespace)
        }
        .animation(readerTypographyPanelAnimation, value: isExpanded)
        .onAppear {
            isExpanded = false
            Task { @MainActor in
                await Task.yield()
                withAnimation(readerTypographyPanelAnimation) {
                    isExpanded = true
                }
            }
        }
    }
}

private let readerTypographyPanelAnimation = Animation.spring(response: 0.44, dampingFraction: 0.78, blendDuration: 0.08)

private struct ReaderFontSettingsFallbackSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Capsule()
                .fill(.secondary.opacity(0.25))
                .frame(width: 42, height: 5)
                .frame(maxWidth: .infinity)

            Text("Font Settings")
                .font(.system(.largeTitle, design: .rounded, weight: .black))

            VStack(spacing: 12) {
                SliderRow(label: "Text size", value: $app.readerSettings.textScale, range: 0.82...1.25, valueText: "\(Int(app.readerSettings.textScale * 100))%")
                SliderRow(label: "Line height", value: $app.readerSettings.lineHeight, range: 1.0...1.65, valueText: String(format: "%.2fx", app.readerSettings.lineHeight))
                SliderRow(label: "Column width", value: $app.readerSettings.lineWidth, range: 32...52, valueText: "\(Int(app.readerSettings.lineWidth))")
            }

            Spacer()
        }
        .padding(24)
        .background(.clear)
        .illumeLiquidGlassRounded(cornerRadius: 30, tint: ReaderSheetGlass.panelTint)
    }
}

struct ReaderImageStyleSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Capsule()
                .fill(.secondary.opacity(0.25))
                .frame(width: 42, height: 5)
                .frame(maxWidth: .infinity)

            Text("Image Styles")
                .font(.system(.largeTitle, design: .rounded, weight: .black))

            VStack(spacing: 12) {
                ForEach(ReaderImageStyle.allCases, id: \.self) { style in
                    ReaderImageStyleOption(
                        style: style,
                        isSelected: app.readerSettings.imageStyle == style
                    ) {
                        app.readerSettings.imageStyle = style
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(24)
        .background(.clear)
        .illumeLiquidGlassRounded(cornerRadius: 30, tint: ReaderSheetGlass.panelTint)
        .presentationBackground(.clear)
    }
}

struct ReaderImageStyleOption: View {
    let style: ReaderImageStyle
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(style.previewResourceName, bundle: .module)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 96, height: 82)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(.black.opacity(0.1), lineWidth: 1)
                    )

                VStack(alignment: .leading, spacing: 5) {
                    Text(style.label)
                        .font(.system(.headline, design: .rounded, weight: .black))
                    Text(style.summary)
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(IllumeTheme.accent)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(LiquidCardButtonStyle(cornerRadius: 14, tint: isSelected ? Color.white.opacity(0.28) : ReaderSheetGlass.tint))
        .accessibilityLabel(style.label)
        .accessibilityValue(isSelected ? "Selected" : "")
    }
}

private enum ReaderSheetGlass {
    static let panelTint = Color.white.opacity(0.08)
    static let menuPanelTint = Color.white.opacity(0.38)
    static let tint = Color.white.opacity(0.16)
    static let selectedTint = Color.white.opacity(0.28)
}

private extension ReaderImageStyle {
    var label: String {
        switch self {
        case .cartoon: "Cartoon"
        case .cute: "Cute"
        }
    }

    var summary: String {
        switch self {
        case .cartoon: "Bold Sunday funnies look with bright 1980s color."
        case .cute: "Kawaii anime feel with pastel modern colors."
        }
    }

    var previewResourceName: String {
        switch self {
        case .cartoon: "cartoon"
        case .cute: "cute"
        }
    }
}

struct SliderRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let valueText: String

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .sliderRowGlass()
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text(label)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(valueText)
                    .font(.system(.caption, design: .rounded, weight: .black))
                    .monospacedDigit()
                    .foregroundStyle(IllumeTheme.ink.opacity(0.78))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.white.opacity(0.12), in: Capsule())
            }

            Slider(value: $value, in: range)
                .tint(IllumeTheme.accent)
                .controlSize(.large)
        }
    }
}

private extension View {
    @ViewBuilder
    func sliderRowGlass() -> some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)

        if #available(iOS 26.0, *) {
            self
                .glassEffect(.regular.tint(ReaderSheetGlass.tint).interactive(), in: shape)
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .overlay {
                    shape.strokeBorder(.white.opacity(0.12), lineWidth: 1)
                }
        }
    }
}

struct ReaderImageTopPanel: View {
    let urlString: String?
    let phase: ReaderImagePhase
    let overlayText: String?
    var activeOverlayRange: NSRange?
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
        fillsReadingView ? 17 : 21
    }

    private var overlayLineLimit: Int {
        if fillsReadingView {
            return isChromeHidden ? 10 : 5
        }
        return 6
    }

    private var overlayBottomPadding: CGFloat {
        if fillsReadingView {
            return isChromeHidden ? 34 : 156
        }
        return 28
    }

    private var overlayTextBlockHeight: CGFloat? {
        guard fillsReadingView else { return nil }
        return CGFloat(overlayLineLimit) * (overlayFontSize + 7)
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Color(red: 0.015, green: 0.017, blue: 0.022))

            if phase == .checking {
                ReaderImageCheckingView(
                    urlString: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView
                )
            } else if phase == .generating {
                ReaderImageGeneratingView(
                    backdropURLString: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView
                )
            } else if let urlString, Self.isDataImageURL(urlString) {
                ReaderImageDataURLView(
                    dataURL: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView,
                    animatesImageIn: phase == .ready
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
                        .blurLoadIn(radius: 13)
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(.white.opacity(0.48))
                    default:
                        ReaderImagePendingView()
                    }
                }
            } else {
                ReaderImagePendingView()
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

            if phase == .ready, let overlayText, !overlayText.isEmpty {
                VStack {
                    Spacer()
                    Group {
                        if activeOverlayRange != nil {
                            ReaderAttributedText(
                                text: overlayText,
                                font: overlayUIFont,
                                textColor: .white,
                                lineSpacing: fillsReadingView ? 3 : 4,
                                activeRange: activeOverlayRange,
                                activeHighlightColor: UIColor(Color(red: 1.0, green: 0.78, blue: 0.18).opacity(0.72)),
                                selectParagraph: {},
                                selectWord: { _ in }
                            )
                            .shadow(color: .black.opacity(0.55), radius: 10, x: 0, y: 3)
                        } else {
                            Text(overlayText)
                                .font(.system(size: overlayFontSize, weight: .semibold, design: .serif))
                                .lineSpacing(fillsReadingView ? 3 : 4)
                                .foregroundStyle(.white)
                                .shadow(color: .black.opacity(0.55), radius: 10, x: 0, y: 3)
                                .lineLimit(overlayLineLimit)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: fillsReadingView ? 620 : .infinity, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: overlayTextBlockHeight, alignment: .topLeading)
                    .clipped()
                    .padding(.horizontal, fillsReadingView ? 18 : 22)
                    .padding(.bottom, overlayBottomPadding)
                    .blurLoadIn(radius: 11)
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

    private var overlayUIFont: UIFont {
        UIFont.systemSerifFont(ofSize: overlayFontSize, weight: .semibold)
    }

    private static func isDataImageURL(_ value: String) -> Bool {
        value.lowercased().hasPrefix("data:image/")
    }
}

struct ReaderImageCheckingView: View {
    let urlString: String?
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.08)

            if let urlString, ReaderImageURL.isDataImageURL(urlString) {
                ReaderImageDataURLView(
                    dataURL: urlString,
                    contentMode: contentMode,
                    addsBottomBlur: addsBottomBlur
                )
                .checkingImageEffect()
            } else if let urlString, let url = URL(string: urlString) {
                AsyncImage(url: url) { imagePhase in
                    switch imagePhase {
                    case .success(let image):
                        ReaderDisplayedImage(
                            image: image,
                            contentMode: contentMode,
                            addsBottomBlur: addsBottomBlur
                        )
                        .checkingImageEffect()
                    default:
                        Color.clear
                    }
                }
            }
        }
    }
}

struct ReaderImagePendingView: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color(red: 0.045, green: 0.052, blue: 0.064),
                Color(red: 0.08, green: 0.075, blue: 0.092),
                Color(red: 0.035, green: 0.055, blue: 0.052)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay {
            Rectangle()
                .fill(.ultraThinMaterial.opacity(0.72))
        }
        .blur(radius: 12)
        .scaleEffect(1.04)
    }
}

struct ReaderImageDataURLView: View {
    let dataURL: String
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false
    var animatesImageIn = false
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ReaderDisplayedImage(
                    image: Image(uiImage: image),
                    contentMode: contentMode,
                    addsBottomBlur: addsBottomBlur
                )
                .blurLoadIn(radius: animatesImageIn ? 13 : 0)
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
    var backdropURLString: String?
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false

    var body: some View {
        ZStack {
            ReaderImagePendingView()

            if let backdropURLString, ReaderImageURL.isDataImageURL(backdropURLString) {
                ReaderImageDataURLView(dataURL: backdropURLString, contentMode: contentMode, addsBottomBlur: addsBottomBlur)
                    .generatingBackdropEffect()
            } else if let backdropURLString, let url = URL(string: backdropURLString) {
                AsyncImage(url: url) { imagePhase in
                    if case .success(let image) = imagePhase {
                        ReaderDisplayedImage(image: image, contentMode: contentMode, addsBottomBlur: addsBottomBlur)
                            .generatingBackdropEffect()
                    }
                }
            }
        }
    }
}

private enum ReaderImageURL {
    static func isDataImageURL(_ value: String) -> Bool {
        value.lowercased().hasPrefix("data:image/")
    }
}

private struct ReaderCheckingImageEffect: ViewModifier {
    func body(content: Content) -> some View {
        content
            .opacity(0.46)
            .blur(radius: 10)
            .saturation(0.88)
            .brightness(-0.06)
            .scaleEffect(1.045)
    }
}

private struct ReaderGeneratingBackdropEffect: ViewModifier {
    func body(content: Content) -> some View {
        content
            .opacity(0.7)
            .blur(radius: 16)
            .saturation(1.18)
            .brightness(-0.34)
            .scaleEffect(1.075)
    }
}

private extension View {
    func checkingImageEffect() -> some View {
        modifier(ReaderCheckingImageEffect())
    }

    func generatingBackdropEffect() -> some View {
        modifier(ReaderGeneratingBackdropEffect())
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
            .illumeNativeGlassButton(tint: IllumeTheme.paper, controlSize: .small, fallback: MiniGlassButtonStyle())
    }
}
#endif
