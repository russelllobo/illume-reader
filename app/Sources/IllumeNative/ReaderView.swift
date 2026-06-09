#if os(iOS)
import IllumeCore
import SwiftUI
import UIKit

private let readerImageChunkWords = 100
private let readerTypographyPanelLift: CGFloat = 190
private let readerScrollSpaceName = "readerScroll"
private let readerNarrationActiveWordTopBand: CGFloat = 0.30
private let readerNarrationActiveWordBottomBand: CGFloat = 0.68
private let readerNarrationTargetViewportPosition: CGFloat = 0.46
private let readerButtonsAutohideDelay: Duration = .seconds(3)
private let readerImageTextCollapsedHeight: CGFloat = 78
private let readerImageTextVisibleControlsBottomPadding: CGFloat = 118
private let readerImageTextHiddenControlsBottomPadding: CGFloat = 26
private let readerImageTextHiddenControlsHeight: CGFloat = readerImageTextCollapsedHeight
    + readerImageTextVisibleControlsBottomPadding
    - readerImageTextHiddenControlsBottomPadding
private let readerImageTextReturnDelay: Duration = .seconds(2)
private let readerMiniplayerDismissTranslation: CGFloat = 34
private let readerMiniplayerDismissPredictedTranslation: CGFloat = 68
private let readerNarrationPreviewMinimumCharacters = 96
private let readerNarrationPreviewMaximumCharacters = 180
private let readerQuickMenuOpenAnimation = Animation.spring(response: 0.18, dampingFraction: 0.66, blendDuration: 0.03)
private let readerQuickMenuCloseAnimation = Animation.easeOut(duration: 0.12)

private struct ReaderScrollOffsetPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private extension AnyTransition {
    static var readerTextBlurIn: AnyTransition {
        .asymmetric(
            insertion: .modifier(
                active: ReaderBlurTransitionModifier(opacity: 0, blurRadius: 12),
                identity: ReaderBlurTransitionModifier(opacity: 1, blurRadius: 0)
            ),
            removal: .opacity
        )
    }

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

private struct ReaderBlurTransitionModifier: ViewModifier {
    let opacity: Double
    let blurRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .opacity(opacity)
            .blur(radius: blurRadius)
    }
}

private struct ReaderImageChunk {
    let endWord: Int
    let index: Int
    let startWord: Int
    let text: String
}

private struct ReaderNarrationPreviewSnippet {
    let activeRange: NSRange?
    let paragraph: ReaderParagraph
    let paragraphIndex: Int
    let text: String
    let visibleWordStart: Int
}

private struct ReaderNarrationPreviewAnchor: Equatable {
    let paragraphID: String
    let wordStart: Int
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
        let contentStart = IllumeAppModel.meaningfulContentStartIndex(in: book)

        for (index, paragraph) in book.paragraphs.enumerated() {
            paragraphWordStarts[index] = totalWords
            guard paragraph.kind != .heading else { continue }

            let words = paragraph.text.split(whereSeparator: \.isWhitespace).map(String.init)
            guard index >= contentStart else {
                totalWords += words.count
                chunkStartWord += words.count
                continue
            }
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

fileprivate enum ReaderSheetDestination: String, Identifiable {
    case contents
    case imageStyles
    case fontSettings
    case voices

    var id: String { rawValue }

    var menuTitle: String {
        switch self {
        case .contents:
            return "Contents"
        case .imageStyles:
            return "Image Styles"
        case .fontSettings:
            return "Font Settings"
        case .voices:
            return "Voices"
        }
    }

    var menuIconName: String {
        switch self {
        case .contents:
            return "list.bullet"
        case .imageStyles:
            return "paintpalette.fill"
        case .fontSettings:
            return "textformat.size"
        case .voices:
            return "waveform"
        }
    }

    var menuExpansionAnchor: UnitPoint {
        switch self {
        case .contents:
            return UnitPoint(x: 0.5, y: 0.12)
        case .imageStyles:
            return UnitPoint(x: 0.5, y: 0.34)
        case .fontSettings:
            return UnitPoint(x: 0.5, y: 0.52)
        case .voices:
            return UnitPoint(x: 0.5, y: 0.7)
        }
    }
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
    @State private var imageReaderTextExpanded = false
    @State private var imageReaderTextReturnTask: Task<Void, Never>?
    @State private var suppressNextImageReaderTextCollapse = false
    @State private var suppressNextImageReaderTextReturn = false
    @State private var imageNarrationPreviewAnchor: ReaderNarrationPreviewAnchor?

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
                        ZStack(alignment: .top) {
                            ReaderImageTopPanel(
                                urlString: app.readerImageResponse?.imageUrl,
                                phase: app.readerImagePhase,
                                fillsReadingView: true,
                                fullTextModeEnabled: imageReaderTextExpanded
                            )
                            .allowsHitTesting(false)

                            GeometryReader { viewport in
                                ScrollViewReader { proxy in
                                    readerScrollView(
                                        book: book,
                                        viewport: viewport,
                                        proxy: proxy,
                                        onImageBackground: true
                                    )
                                }
                            }

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
                        .allowsHitTesting(!shouldHideReaderButtons)
                        .animation(.easeOut(duration: 0.16), value: shouldHideReaderButtons)

                        GeometryReader { viewport in
                            ScrollViewReader { proxy in
                                readerScrollView(
                                    book: book,
                                    viewport: viewport,
                                    proxy: proxy,
                                    onImageBackground: false
                                )
                            }
                        }
                    }
                }
            }

            if quickMenuOpen {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        closeQuickMenu()
                    }
                    .zIndex(7)
            }

            if let book = app.activeBook {
                let isShowingImageMode = imageModeEnabled && imageParagraph(in: book) != nil
                let hideBottomControls = shouldHideReaderButtons

                VStack {
                    Spacer()
                    GeometryReader { geometry in
                        let useCompactControls = isShowingImageMode || controlsCollapsed || geometry.size.width < 430

                        VStack(spacing: (speedPickerExpanded || quickMenuOpen) ? (useCompactControls ? 12 : 14) : (useCompactControls ? 7 : 9)) {
                            if !speedPickerExpanded && !quickMenuOpen {
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
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode,
                                    selectRate: { rate in
                                        app.setNarrationRate(rate)
                                        revealReaderButtons(autohide: false)
                                    }
                                )
                                .frame(width: min(geometry.size.width - 28, useCompactControls ? 336 : 386))
                                .transition(.opacity.combined(with: .scale(scale: 0.94, anchor: .bottom)))
                            }

                            if quickMenuOpen {
                                ReaderQuickMenuOverlay(
                                    progressPercent: readingProgressPercent(in: book),
                                    hasTableOfContents: !tableOfContentsEntries(for: book).isEmpty,
                                    imageModeEnabled: $imageModeEnabled,
                                    imageModeLoading: app.readerImagePhase == .checking || app.readerImagePhase == .generating,
                                    imageModeDisabled: imageParagraph(in: book) == nil,
                                    activeDestination: activeReaderSheet,
                                    isCollapsed: useCompactControls,
                                    onDarkBackground: isShowingImageMode,
                                    openContents: {
                                        openQuickMenuDestination(.contents)
                                    },
                                    openImageStyles: {
                                        openQuickMenuDestination(.imageStyles)
                                    },
                                    openFontSettings: {
                                        openQuickMenuDestination(.fontSettings)
                                    },
                                    openVoices: {
                                        openQuickMenuDestination(.voices)
                                    },
                                    toggleImageMode: { toggleImageMode(for: book) },
                                    closeDestination: {
                                        closeQuickMenuDestination()
                                    },
                                    destinationContent: { destination in
                                        readerMenuPanel(for: destination)
                                    }
                                )
                                .frame(width: min(geometry.size.width - 28, useCompactControls ? 336 : 386))
                                .transition(.readerQuickMenuBubble)
                            }

                            if !speedPickerExpanded && !quickMenuOpen {
                                HStack(alignment: .bottom, spacing: useCompactControls ? 8 : 10) {
                                    ReaderNarrationSpeedPickerButton(
                                        rate: app.readerSettings.narrationRate,
                                        isExpanded: speedPickerExpanded,
                                        isCollapsed: useCompactControls,
                                        onDarkBackground: isShowingImageMode,
                                        toggleExpansion: {
                                            readerButtonsAutohideTask?.cancel()
                                            withAnimation(IllumeTheme.spring) {
                                                quickMenuOpen = false
                                                speedPickerExpanded.toggle()
                                            }
                                            revealReaderButtons(autohide: false)
                                        }
                                    )

                                    ReaderTransportRail(
                                        book: book,
                                        currentIndex: currentIndex,
                                        isPlaying: app.narration.isPlaying,
                                        isPreparing: app.narration.isPreparing,
                                        isCollapsed: useCompactControls,
                                        onDarkBackground: isShowingImageMode,
                                        playPause: {
                                            let wordStart = isShowingImageMode ? narrationPreviewSnippet(in: book)?.visibleWordStart ?? 0 : 0
                                            app.toggleNarration(for: book, from: currentIndex, wordStart: wordStart)
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
                                .frame(maxWidth: .infinity, alignment: .center)
                            }
                        }
                        .padding(.horizontal, 18)
                        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .bottom)
                    }
                    .frame(height: readerControlsHeight(isShowingImageMode: isShowingImageMode, speedPickerExpanded: speedPickerExpanded, quickMenuOpen: quickMenuOpen, activeMenuDestination: activeReaderSheet))
                    .padding(.bottom, useCompactControlsBottomPadding(isShowingImageMode: isShowingImageMode))
                    .opacity(hideBottomControls ? 0 : 1)
                    .blur(radius: hideBottomControls ? 14 : 0)
                    .scaleEffect(hideBottomControls ? 0.96 : 1, anchor: .bottom)
                    .allowsHitTesting(!hideBottomControls)
                    .zIndex(8)
                    .animation(.easeOut(duration: 0.16), value: hideBottomControls)
                    .blurLoadIn(radius: 10)
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 14)
                            .onEnded { value in
                                hideReaderButtonsIfDismissSwipe(value)
                        }
                    )
                }
                .zIndex(8)
            }

        }
        .foregroundStyle(ReaderDefaultStyle.foreground)
        .onChange(of: activeReaderSheet) {
            withAnimation(IllumeTheme.spring) {
                readerLiftedForBottomPanel = false
            }
            if activeReaderSheet != nil {
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
            imageReaderTextReturnTask?.cancel()
            imageReaderTextReturnTask = nil
            imageReaderTextExpanded = false
            imageNarrationPreviewAnchor = nil
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
            app.cancelReaderImagePrefetching()
            scheduledImageChunkIndex = nil
            scheduleImageGeneration(for: book, delay: .zero)
        }
        .onChange(of: app.readerImagePhase) {
            guard app.readerImagePhase == .ready,
                  imageModeEnabled,
                  let book = app.activeBook else { return }
            scheduleNextImagePrefetch(for: book)
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
            imageReaderTextReturnTask?.cancel()
            imageReaderTextReturnTask = nil
            imageNarrationPreviewAnchor = nil
        }
    }

    private func readerScrollView(
        book: ReaderBook,
        viewport: GeometryProxy,
        proxy: ScrollViewProxy,
        onImageBackground: Bool
    ) -> some View {
        Group {
            if onImageBackground && !imageReaderTextExpanded {
                let previewHeight = shouldHideReaderButtons ? readerImageTextHiddenControlsHeight : readerImageTextCollapsedHeight
                let previewBottomPadding = shouldHideReaderButtons
                    ? readerImageTextHiddenControlsBottomPadding
                    : readerImageTextVisibleControlsBottomPadding
                let previewCharacters = narrationPreviewCharacterLimit(
                    for: readerImageTextCollapsedHeight,
                    viewportWidth: viewport.size.width
                )
                let previewSnippet = narrationPreviewSnippet(in: book, previewCharacters: previewCharacters)
                ZStack(alignment: .bottom) {
                    VStack(spacing: 0) {
                        Color.black.opacity(0.001)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                toggleReaderButtons(allowDuringPreparation: true)
                            }

                        Spacer()
                            .frame(height: previewHeight + previewBottomPadding)
                    }

                    ReaderNarrationPreviewPanel(
                        snippet: previewSnippet,
                        textColor: .white,
                        height: previewHeight
                    ) { snippet, wordStart in
                        imageNarrationPreviewAnchor = ReaderNarrationPreviewAnchor(
                            paragraphID: snippet.paragraph.id,
                            wordStart: snippet.visibleWordStart
                        )
                        startNarrationFromWord(
                            snippet.visibleWordStart + wordStart,
                            paragraphIndex: snippet.paragraphIndex,
                            paragraph: snippet.paragraph,
                            book: book,
                            onImageBackground: onImageBackground
                        )
                    } expand: {
                        expandImageReaderTextIfNeeded(onImageBackground: onImageBackground)
                        scrollImageReaderTextToExcerpt(book: book, proxy: proxy)
                        revealReaderButtons()
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, previewBottomPadding)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .transition(.readerTextBlurIn)
            } else {
                fullReaderScrollView(
                    book: book,
                    viewport: viewport,
                    proxy: proxy,
                    onImageBackground: onImageBackground
                )
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
            scheduleImageReaderTextReturnIfNeeded(
                book: book,
                proxy: proxy,
                onImageBackground: onImageBackground,
                delay: .milliseconds(250)
            )
        }
    }

    private func fullReaderScrollView(
        book: ReaderBook,
        viewport: GeometryProxy,
        proxy: ScrollViewProxy,
        onImageBackground: Bool
    ) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: onImageBackground ? 20 : 18) {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: ReaderScrollOffsetPreferenceKey.self,
                        value: geometry.frame(in: .named(readerScrollSpaceName)).minY
                    )
                }
                .frame(height: 0)

                ForEach(Array(book.paragraphs.enumerated()), id: \.element.id) { index, paragraph in
                    ParagraphView(
                        paragraph: paragraph,
                        index: index,
                        textColor: onImageBackground ? .white : ReaderDefaultStyle.foreground,
                        futureTextOpacity: onImageBackground ? 0.46 : 0.22,
                        speakingHighlightColor: onImageBackground ? nil : Color(red: 0.918, green: 0.961, blue: 1.0),
                        scrollsActiveRange: !onImageBackground
                    ) {
                        selectParagraph(index, paragraph: paragraph)
                    } selectWord: { wordStart in
                        startNarrationFromWord(
                            wordStart,
                            paragraphIndex: index,
                            paragraph: paragraph,
                            book: book,
                            onImageBackground: onImageBackground
                        )
                    }
                    .shadow(
                        color: onImageBackground ? .black.opacity(0.82) : .clear,
                        radius: onImageBackground ? 11 : 0,
                        x: 0,
                        y: onImageBackground ? 3 : 0
                    )
                    .id(paragraph.id)
                    .onAppear {
                        updateVisibleParagraph(index, paragraph: paragraph)
                    }
                }
            }
            .frame(maxWidth: textColumnWidth)
            .padding(.horizontal, onImageBackground ? 24 : 18)
            .padding(.top, onImageBackground ? 104 : 12)
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .clipped()
        .contentShape(Rectangle())
        .animation(IllumeTheme.spring, value: readerLiftedForBottomPanel)
        .animation(IllumeTheme.blurLoadIn, value: readerContentVisible)
        .animation(IllumeTheme.spring, value: imageReaderTextExpanded)
        .simultaneousGesture(
            SpatialTapGesture()
                .onEnded { value in
                    guard !onImageBackground || value.location.y < UIScreen.main.bounds.height - imageChromeToggleBottomExclusion else {
                        return
                    }

                    if onImageBackground && imageReaderTextExpanded {
                        collapseImageReaderTextAfterTapIfAllowed()
                        return
                    }

                    handleReaderTap(
                        value.location,
                        viewportWidth: viewport.size.width,
                        book: book,
                        proxy: proxy,
                        onImageBackground: onImageBackground
                    )
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 8)
                .onChanged { _ in
                    expandImageReaderTextIfNeeded(onImageBackground: onImageBackground)
                    revealReaderButtons()
                }
                .onEnded { _ in
                    scheduleImageReaderTextReturnIfNeeded(
                        book: book,
                        proxy: proxy,
                        onImageBackground: onImageBackground
                    )
                }
        )
        .onPreferenceChange(ReaderScrollOffsetPreferenceKey.self) { offset in
            let shouldCollapse = offset < -18
            guard controlsCollapsed != shouldCollapse else { return }
            withAnimation(IllumeTheme.spring) {
                controlsCollapsed = shouldCollapse
            }
        }
    }

    private func toggleImageMode(for book: ReaderBook) {
        imageModeEnabled.toggle()
        if !imageModeEnabled {
            imageReaderTextReturnTask?.cancel()
            imageReaderTextReturnTask = nil
            imageReaderTextExpanded = false
            imageNarrationPreviewAnchor = nil
            revealReaderButtons()
            app.readerImageResponse = nil
            app.readerImagePhase = .idle
            app.readerImageStyle = nil
            app.cancelReaderImagePrefetching()
            scheduledImageChunkIndex = nil
        }

        if imageModeEnabled {
            scheduleImageGeneration(for: book, delay: .zero)
        } else {
            imageModeTask?.cancel()
            imageModeTask = nil
        }
    }

    private func toggleReaderButtons(allowDuringPreparation: Bool = false) {
        readerButtonsAutohideTask?.cancel()
        if quickMenuOpen {
            closeQuickMenu()
            return
        }
        if readerButtonsHidden {
            revealReaderButtons()
        } else {
            hideReaderButtons(allowDuringPreparation: allowDuringPreparation)
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

    private func hideReaderButtons(allowDuringPreparation: Bool = false) {
        guard activeReaderSheet == nil,
              (allowDuringPreparation || !app.narration.isPreparing) else { return }
        withAnimation(IllumeTheme.spring) {
            speedPickerExpanded = false
            quickMenuOpen = false
        }
        withAnimation(.easeOut(duration: 0.16)) {
            readerButtonsHidden = true
        }
    }

    private func hideReaderButtonsIfDismissSwipe(_ value: DragGesture.Value) {
        let translation = value.translation
        let predictedTranslation = value.predictedEndTranslation
        let isMostlyVertical = translation.height > abs(translation.width)
        let passedDistance = translation.height >= readerMiniplayerDismissTranslation
        let passedFlickDistance = predictedTranslation.height >= readerMiniplayerDismissPredictedTranslation

        guard isMostlyVertical, passedDistance || passedFlickDistance else { return }
        readerButtonsAutohideTask?.cancel()
        hideReaderButtons(allowDuringPreparation: true)
    }

    private func toggleQuickMenu() {
        readerButtonsAutohideTask?.cancel()
        revealReaderButtons(autohide: false)
        withAnimation(IllumeTheme.spring) {
            speedPickerExpanded = false
            quickMenuOpen.toggle()
            readerLiftedForBottomPanel = activeReaderSheet != nil
        }
    }

    private func closeQuickMenu() {
        guard quickMenuOpen else { return }
        withAnimation(IllumeTheme.spring) {
            quickMenuOpen = false
            activeReaderSheet = nil
            readerLiftedForBottomPanel = activeReaderSheet != nil
        }
    }

    @ViewBuilder
    private func readerMenuPanel(for destination: ReaderSheetDestination) -> some View {
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
            case .imageStyles:
                ReaderImageStyleSheet()
            case .fontSettings:
                ReaderFontSettingsSheet()
            case .voices:
                ReaderVoiceSettingsSheet()
            }
        } else {
            EmptyView()
        }
    }

    private func openQuickMenuDestination(_ destination: ReaderSheetDestination) {
        readerButtonsAutohideTask?.cancel()
        withAnimation(readerTypographyPanelAnimation) {
            activeReaderSheet = destination
        }
        revealReaderButtons(autohide: false)
    }

    private func closeQuickMenuDestination() {
        withAnimation(readerTypographyPanelAnimation) {
            activeReaderSheet = nil
        }
        revealReaderButtons(autohide: false)
    }

    private func selectTableOfContentsEntry(_ entry: TableOfContentsEntry, in book: ReaderBook) {
        withAnimation(IllumeTheme.spring) {
            quickMenuOpen = false
            activeReaderSheet = nil
            readerLiftedForBottomPanel = false
        }
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
        Task { @MainActor in
            await Task.yield()
            if book.paragraphs.indices.contains(entry.paragraphIndex) {
                app.speak(book: book, paragraphIndex: entry.paragraphIndex)
            }
            withAnimation(IllumeTheme.blurLoadIn) {
                readerContentVisible = true
            }
        }
    }

    private func handleReaderTap(
        _ location: CGPoint,
        viewportWidth: CGFloat,
        book: ReaderBook,
        proxy: ScrollViewProxy,
        onImageBackground: Bool
    ) {
        if quickMenuOpen {
            closeQuickMenu()
            return
        }

        let textWidth = min(textColumnWidth + 36, viewportWidth)
        let horizontalMargin = max((viewportWidth - textWidth) / 2, 0)

        if location.x < horizontalMargin {
            blurNavigate(to: currentIndex - 1, in: book, proxy: proxy)
        } else if location.x > viewportWidth - horizontalMargin {
            blurNavigate(to: currentIndex + 1, in: book, proxy: proxy)
        } else {
            toggleReaderButtons(allowDuringPreparation: onImageBackground)
        }
    }

    private func blurNavigate(to index: Int, in book: ReaderBook, proxy: ScrollViewProxy) {
        guard book.paragraphs.indices.contains(index), index != currentIndex else {
            revealReaderButtons()
            return
        }

        imageReaderTextReturnTask?.cancel()
        revealReaderButtons()
        withAnimation(.easeOut(duration: 0.1)) {
            readerContentVisible = false
            imageReaderTextExpanded = false
        }
        imageNarrationPreviewAnchor = nil

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
        imageReaderTextReturnTask?.cancel()
        withAnimation(IllumeTheme.spring) {
            imageReaderTextExpanded = false
        }
        imageNarrationPreviewAnchor = nil
        currentIndex = index
        let paragraph = book.paragraphs[index]
        app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
        pendingParagraphID = paragraph.id
        scrollRequest += 1
        app.speak(book: book, paragraphIndex: index, wordStart: 0)
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
        guard !shouldHoldPositionForNarrationPreview else { return }
        guard currentIndex != index else { return }
        currentIndex = index
        app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
    }

    private func selectParagraph(_ index: Int, paragraph: ReaderParagraph) {
        imageReaderTextReturnTask?.cancel()
        withAnimation(IllumeTheme.spring) {
            imageReaderTextExpanded = false
        }
        imageNarrationPreviewAnchor = nil
        guard currentIndex != index else { return }
        currentIndex = index
        app.saveProgress(index: index, page: paragraph.pageNumber ?? 1)
    }

    private func startNarrationFromWord(
        _ wordStart: Int,
        paragraphIndex: Int,
        paragraph: ReaderParagraph,
        book: ReaderBook,
        onImageBackground: Bool
    ) {
        imageReaderTextReturnTask?.cancel()
        if onImageBackground && imageReaderTextExpanded {
            suppressNextImageReaderTextCollapse = true
            suppressNextImageReaderTextReturn = true
        }
        if currentIndex != paragraphIndex {
            currentIndex = paragraphIndex
            app.saveProgress(index: paragraphIndex, page: paragraph.pageNumber ?? 1)
        }
        app.speak(book: book, paragraphIndex: paragraphIndex, wordStart: wordStart)
    }

    private var shouldHoldPositionForNarrationPreview: Bool {
        imageModeEnabled && imageReaderTextExpanded && isNarrationActive
    }

    private func expandImageReaderTextIfNeeded(onImageBackground: Bool) {
        guard onImageBackground else { return }
        imageReaderTextReturnTask?.cancel()
        guard !imageReaderTextExpanded else { return }
        imageModeTask?.cancel()
        imageModeTask = nil
        scheduledImageChunkIndex = nil
        withAnimation(IllumeTheme.spring) {
            imageReaderTextExpanded = true
        }
    }

    private func scrollImageReaderTextToExcerpt(book: ReaderBook, proxy: ScrollViewProxy) {
        guard let targetID = narrationParagraphID(in: book) ?? currentParagraphID(in: book) else { return }
        Task { @MainActor in
            await Task.yield()
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                proxy.scrollTo(targetID, anchor: .center)
            }
        }
    }

    private func collapseImageReaderTextAndHideButtons() {
        imageReaderTextReturnTask?.cancel()
        withAnimation(IllumeTheme.blurLoadIn) {
            imageReaderTextExpanded = false
        }
        imageNarrationPreviewAnchor = nil
        if let book = app.activeBook {
            scheduleImageGeneration(for: book)
        }
        hideReaderButtons()
    }

    private func collapseImageReaderTextAfterTapIfAllowed() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(50))
            guard !Task.isCancelled else { return }
            if suppressNextImageReaderTextCollapse {
                suppressNextImageReaderTextCollapse = false
                revealReaderButtons()
                return
            }
            collapseImageReaderTextAndHideButtons()
        }
    }

    private func scheduleImageReaderTextReturnIfNeeded(
        book: ReaderBook,
        proxy: ScrollViewProxy,
        onImageBackground: Bool,
        delay: Duration = readerImageTextReturnDelay
    ) {
        guard onImageBackground else { return }
        imageReaderTextReturnTask?.cancel()
        if suppressNextImageReaderTextReturn {
            suppressNextImageReaderTextReturn = false
            return
        }
        let rowID = app.activeBookRow?.id
        imageReaderTextReturnTask = Task { @MainActor in
            if delay > .zero {
                try? await Task.sleep(for: delay)
            }
            guard !Task.isCancelled,
                  app.activeBookRow?.id == rowID else { return }
            let targetID = narrationParagraphID(in: book) ?? currentParagraphID(in: book)
            if let targetID {
                withAnimation(IllumeTheme.blurLoadIn) {
                    proxy.scrollTo(targetID, anchor: .top)
                    imageReaderTextExpanded = false
                }
                imageNarrationPreviewAnchor = nil
                scheduleImageGeneration(for: book)
            } else {
                withAnimation(IllumeTheme.blurLoadIn) {
                    imageReaderTextExpanded = false
                }
                imageNarrationPreviewAnchor = nil
                scheduleImageGeneration(for: book)
            }
        }
    }

    private func narrationParagraphID(in book: ReaderBook) -> String? {
        guard let paragraphID = app.narration.paragraphID,
              book.paragraphs.contains(where: { $0.id == paragraphID }) else { return nil }
        return paragraphID
    }

    private func currentParagraphID(in book: ReaderBook) -> String? {
        guard book.paragraphs.indices.contains(currentIndex) else { return nil }
        return book.paragraphs[currentIndex].id
    }

    private func narrationPreviewSnippet(
        in book: ReaderBook,
        previewCharacters: Int? = nil
    ) -> ReaderNarrationPreviewSnippet? {
        let narrationIndex = app.narration.paragraphID.flatMap { paragraphID in
            book.paragraphs.firstIndex { $0.id == paragraphID }
        }
        let targetIndex = narrationIndex ?? (book.paragraphs.indices.contains(currentIndex) ? currentIndex : nil)
        guard let targetIndex,
              book.paragraphs.indices.contains(targetIndex) else { return nil }

        let paragraph = book.paragraphs[targetIndex]
        let activeRange = narrationIndex == nil ? nil : app.narration.wordRange
        let pinnedAnchor = imageNarrationPreviewAnchor?.paragraphID == paragraph.id
            ? imageNarrationPreviewAnchor?.wordStart
            : nil
        let narrationAnchor = app.narration.sectionParagraphID == paragraph.id
            ? app.narration.sectionWordStart
            : nil
        let anchorLocation = pinnedAnchor ?? narrationAnchor
        let excerpt = narrationPreviewExcerpt(
            for: paragraph.text,
            activeRange: activeRange,
            anchorLocation: anchorLocation,
            previewCharacters: previewCharacters ?? readerNarrationPreviewMaximumCharacters
        )
        return ReaderNarrationPreviewSnippet(
            activeRange: excerpt.activeRange,
            paragraph: paragraph,
            paragraphIndex: targetIndex,
            text: excerpt.text,
            visibleWordStart: excerpt.visibleWordStart
        )
    }

    private func narrationPreviewExcerpt(
        for text: String,
        activeRange: NSRange?,
        anchorLocation: Int?,
        previewCharacters: Int
    ) -> (text: String, activeRange: NSRange?, visibleWordStart: Int) {
        let nsText = text as NSString
        guard nsText.length > 0 else { return ("", nil, 0) }
        let previewCharacters = min(
            readerNarrationPreviewMaximumCharacters,
            max(readerNarrationPreviewMinimumCharacters, previewCharacters)
        )

        guard let activeRange,
              activeRange.location >= 0,
              NSMaxRange(activeRange) <= nsText.length else {
            let end = narrationPreviewWindowEnd(in: text, from: 0, previewCharacters: previewCharacters)
            let window = narrationPreviewExpandedWindow(
                in: text,
                start: 0,
                end: end,
                minimumCharacters: previewCharacters
            )
            return (
                nsText.substring(with: NSRange(location: window.start, length: window.end - window.start)),
                nil,
                firstWordStart(in: text, atOrAfter: window.start) ?? window.start
            )
        }

        let containingRange: NSRange
        if let anchorLocation,
           anchorLocation >= 0,
           anchorLocation < nsText.length {
            let windowStart = firstWordStart(in: text, atOrAfter: anchorLocation) ?? anchorLocation
            let windowEnd = narrationPreviewWindowEnd(in: text, from: windowStart, previewCharacters: previewCharacters)
            let window = narrationPreviewExpandedWindow(
                in: text,
                start: windowStart,
                end: windowEnd,
                minimumCharacters: previewCharacters
            )
            if activeRange.location >= window.start && NSMaxRange(activeRange) <= window.end {
                let excerpt = nsText.substring(with: NSRange(location: window.start, length: window.end - window.start))
                let adjustedRange = NSRange(
                    location: activeRange.location - window.start,
                    length: activeRange.length
                )

                return (
                    excerpt,
                    adjustedRange,
                    firstWordStart(in: text, atOrAfter: window.start) ?? window.start
                )
            }
        }
        containingRange = activeRange
        let windowStart = narrationPreviewWindowStart(
            in: text,
            containing: containingRange,
            previewCharacters: previewCharacters
        )
        let windowEnd = narrationPreviewWindowEnd(in: text, from: windowStart, previewCharacters: previewCharacters)
        let window = narrationPreviewExpandedWindow(
            in: text,
            start: windowStart,
            end: windowEnd,
            minimumCharacters: previewCharacters
        )
        let excerpt = nsText.substring(with: NSRange(location: window.start, length: window.end - window.start))
        let adjustedRange = activeRange.location >= window.start && NSMaxRange(activeRange) <= window.end
            ? NSRange(
                location: activeRange.location - window.start,
                length: activeRange.length
            )
            : nil

        return (
            excerpt,
            adjustedRange,
            firstWordStart(in: text, atOrAfter: window.start) ?? window.start
        )
    }

    private func narrationPreviewExpandedWindow(
        in text: String,
        start: Int,
        end: Int,
        minimumCharacters: Int
    ) -> (start: Int, end: Int) {
        let nsText = text as NSString
        guard nsText.length > 0 else { return (0, 0) }

        var windowStart = max(0, min(start, nsText.length))
        var windowEnd = max(windowStart, min(end, nsText.length))
        guard windowEnd - windowStart < minimumCharacters else {
            return (windowStart, windowEnd)
        }

        let missingCharacters = minimumCharacters - (windowEnd - windowStart)
        if windowEnd < nsText.length {
            windowEnd = narrationPreviewWindowEnd(
                in: text,
                from: windowStart,
                previewCharacters: minimumCharacters
            )
        }

        if windowEnd - windowStart < minimumCharacters, windowStart > 0 {
            let targetStart = max(0, windowStart - missingCharacters)
            windowStart = firstWordStart(in: text, atOrBefore: targetStart) ?? targetStart
        }

        return (windowStart, windowEnd)
    }

    private func narrationPreviewWindowStart(
        in text: String,
        containing activeRange: NSRange,
        previewCharacters: Int
    ) -> Int {
        let nsText = text as NSString
        guard nsText.length > previewCharacters else { return 0 }

        let targetBucket = max(0, activeRange.location / previewCharacters)
        let roughStart = min(targetBucket * previewCharacters, max(0, nsText.length - 1))
        return firstWordStart(in: text, atOrAfter: roughStart) ?? roughStart
    }

    private func narrationPreviewWindowEnd(in text: String, from start: Int, previewCharacters: Int) -> Int {
        let nsText = text as NSString
        guard start < nsText.length else { return nsText.length }

        let roughEnd = min(nsText.length, start + previewCharacters)
        guard roughEnd < nsText.length else { return nsText.length }

        let searchRange = NSRange(location: roughEnd, length: nsText.length - roughEnd)
        if let nextWord = IllumeAppModel.wordRanges(in: text).first(where: { NSLocationInRange($0.location, searchRange) }) {
            return nextWord.location
        }
        return roughEnd
    }

    private func firstWordStart(in text: String, atOrAfter offset: Int) -> Int? {
        IllumeAppModel.wordRanges(in: text).first { $0.location >= offset }?.location
    }

    private func firstWordStart(in text: String, atOrBefore offset: Int) -> Int? {
        IllumeAppModel.wordRanges(in: text).last { $0.location <= offset }?.location
    }

    private func narrationPreviewCharacterLimit(for height: CGFloat, viewportWidth: CGFloat) -> Int {
        let scale = min(app.readerSettings.textScale, 1.18)
        let fontSize = 18 * scale
        let lineHeight = UIFont.readerFont(ofSize: fontSize, weight: .regular, family: app.readerSettings.fontFamily).lineHeight
        let lineSpacing = 3.4 + CGFloat(min(max(app.readerSettings.lineHeight, 1.0), 1.55) - 1.0) * 7.2
        let visibleLines = max(1, Int(floor(height / (lineHeight + lineSpacing))))
        let availableWidth = max(140, viewportWidth - 84)
        let charactersPerLine = max(12, Int(floor(availableWidth / (fontSize * 0.58))))
        let estimatedCharacters = (visibleLines * charactersPerLine) - 6
        return min(
            readerNarrationPreviewMaximumCharacters,
            max(readerNarrationPreviewMinimumCharacters, estimatedCharacters)
        )
    }

    private func useCompactControlsHeight(isShowingImageMode: Bool) -> CGFloat {
        (isShowingImageMode || controlsCollapsed) ? 92 : 112
    }

    private func readerControlsHeight(isShowingImageMode: Bool, speedPickerExpanded: Bool, quickMenuOpen: Bool, activeMenuDestination: ReaderSheetDestination?) -> CGFloat {
        guard speedPickerExpanded || quickMenuOpen else {
            return useCompactControlsHeight(isShowingImageMode: isShowingImageMode)
        }

        if quickMenuOpen {
            if activeMenuDestination != nil {
                let expandedHeight: CGFloat = (isShowingImageMode || controlsCollapsed) ? 560 : 640
                return min(UIScreen.main.bounds.height * 0.72, expandedHeight)
            }
            return (isShowingImageMode || controlsCollapsed) ? 392 : 420
        }

        return (isShowingImageMode || controlsCollapsed) ? 248 : 280
    }

    private func useCompactControlsBottomPadding(isShowingImageMode: Bool) -> CGFloat {
        isShowingImageMode ? 20 : (controlsCollapsed ? 10 : 18)
    }

    private func scheduleImageGeneration(for book: ReaderBook, delay: Duration = .milliseconds(520)) {
        guard !imageReaderTextExpanded else { return }
        guard let chunk = imageChunk(in: book) else { return }
        let nextChunk = nextImageChunk(after: chunk, in: book)
        if app.readerImageChunkIndex == chunk.index,
           app.readerImageStyle == app.readerSettings.imageStyle,
           app.readerImagePhase == .checking || app.readerImagePhase == .generating || app.readerImagePhase == .ready {
            scheduledImageChunkIndex = chunk.index
            prefetchImageChunk(nextChunk)
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
            guard !Task.isCancelled else { return }
            prefetchImageChunk(nextChunk)
        }
    }

    private func scheduleNextImagePrefetch(for book: ReaderBook) {
        guard !imageReaderTextExpanded,
              let chunk = imageChunk(in: book),
              app.readerImageChunkIndex == chunk.index,
              app.readerImageStyle == app.readerSettings.imageStyle else { return }
        prefetchImageChunk(nextImageChunk(after: chunk, in: book))
    }

    private func prefetchImageChunk(_ chunk: ReaderImageChunk?) {
        guard let chunk else { return }
        app.prefetchImage(
            text: chunk.text,
            chunkIndex: chunk.index,
            startWord: chunk.startWord,
            endWord: chunk.endWord
        )
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
        let targetWordNumber = max(1, wordsBeforeTarget + 1)
        return imageChunkCache.chunks.last(where: { $0.startWord <= targetWordNumber }) ?? imageChunkCache.chunks.first
    }

    private func nextImageChunk(after chunk: ReaderImageChunk, in book: ReaderBook) -> ReaderImageChunk? {
        let bookID = app.activeBookRow?.id
        if !imageChunkCache.matches(bookID: bookID, book: book) {
            imageChunkCache = ReaderImageChunkCache.build(bookID: bookID, book: book)
        }

        let nextIndex = chunk.index + 1
        guard imageChunkCache.chunks.indices.contains(nextIndex) else { return nil }
        return imageChunkCache.chunks[nextIndex]
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
                .foregroundStyle(titleForeground)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .padding(.horizontal, 16)
                .frame(height: 42)
                .frame(maxWidth: 248)
                .background {
                    Capsule()
                        .fill(titleFill)
                }
                .illumeLiquidGlassCapsule(tint: titleGlassTint)
                .overlay {
                    Capsule()
                        .strokeBorder(titleBorder, lineWidth: 1)
                }
                .shadow(color: titleShadow, radius: 16, x: 0, y: 8)
                .padding(.horizontal, 72)
                .frame(maxWidth: .infinity, alignment: .center)

            HStack {
                Button(action: close) {
                    Image(systemName: "books.vertical.fill")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(foreground)
                        .frame(width: 52, height: 52)
                        .contentShape(Circle())
                }
                .buttonStyle(ReaderGlassCircleButtonStyle(tint: buttonTint, pressedScale: 0.86))
                .contentShape(Circle())
                .accessibilityLabel("Back to library")
                .accessibilityIdentifier("reader.backToLibrary")

                Spacer()
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .zIndex(4)
    }

    private var titleForeground: Color {
        onDarkBackground ? .white.opacity(0.94) : IllumeTheme.ink.opacity(0.86)
    }

    private var titleFill: Color {
        onDarkBackground ? Color.black.opacity(0.34) : Color.white.opacity(0.42)
    }

    private var titleGlassTint: Color {
        onDarkBackground ? Color.black.opacity(0.46) : IllumeTheme.paper.opacity(0.62)
    }

    private var titleBorder: Color {
        onDarkBackground ? Color.white.opacity(0.2) : IllumeTheme.paper.opacity(0.1)
    }

    private var titleShadow: Color {
        onDarkBackground ? Color.black.opacity(0.34) : Color.black.opacity(0.08)
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
        .presentationCornerRadius(42)
        .presentationBackground(.clear)
    }
}

private enum TableOfContentsStyle {
    static let ink = Color.white.opacity(0.94)
    static let secondaryText = Color.white.opacity(0.46)
    static let divider = Color.white.opacity(0.12)
}

struct TableOfContentsHeader: View {
    let book: ReaderBook
    let progressPercent: Int

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            cover

            VStack(alignment: .leading, spacing: 8) {
                Text(book.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(TableOfContentsStyle.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                pageProgress
            }
        }
        .padding(.leading, 28)
        .padding(.trailing, 28)
        .padding(.top, 30)
        .padding(.bottom, 20)
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
        .frame(width: 48, height: 70)
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
                .font(.system(size: 28, weight: .black, design: .rounded))
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
        .font(.system(size: 18, weight: .regular))
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
    var textColor = ReaderDefaultStyle.foreground
    var futureTextOpacity: Double = 0.22
    var speakingHighlightColor: Color? = Color(red: 0.918, green: 0.961, blue: 1.0)
    var scrollsActiveRange = true
    let selectParagraph: () -> Void
    let selectWord: (Int) -> Void

    var body: some View {
        let isNarrationParagraph = app.narration.paragraphID == paragraph.id
        let activeParagraphIndex = app.narration.paragraphID.flatMap { paragraphID in
            app.activeBook?.paragraphs.firstIndex { $0.id == paragraphID }
        }
        let isFutureParagraph = activeParagraphIndex.map { index > $0 } ?? false

        ReaderAttributedText(
            text: paragraph.text,
            font: uiFont,
            textColor: UIColor(textColor.opacity(isFutureParagraph ? futureTextOpacity : 1)),
            lineSpacing: paragraphLineSpacing,
            activeRange: isNarrationParagraph ? app.narration.wordRange : nil,
            activeHighlightColor: .clear,
            scrollsActiveRange: scrollsActiveRange
        ) {
            selectParagraph()
        } selectWord: { wordStart in
            selectWord(wordStart)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, paragraph.kind == .heading ? 22 : 2)
        .background {
            if isNarrationParagraph, let speakingHighlightColor {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(speakingHighlightColor)
                    .shadow(color: speakingHighlightColor.opacity(0.7), radius: 0, x: 0, y: 0)
            }
        }
        .animation(IllumeTheme.blurLoadIn, value: isNarrationParagraph)
    }

    private var uiFont: UIFont {
        let scale = min(app.readerSettings.textScale, 1.25)
        let size = 18.5 * scale
        switch paragraph.kind {
        case .heading:
            return UIFont.readerFont(ofSize: 24 * scale, weight: .bold, family: app.readerSettings.fontFamily)
        case .quote:
            let font = UIFont.readerFont(ofSize: size, weight: .medium, family: app.readerSettings.fontFamily)
            let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor
            return UIFont(descriptor: descriptor, size: size)
        default:
            return UIFont.readerFont(ofSize: size, weight: .regular, family: app.readerSettings.fontFamily)
        }
    }

    private var paragraphLineSpacing: CGFloat {
        let lineHeight = min(max(app.readerSettings.lineHeight, 1.0), 1.65)
        return 3.8 + CGFloat(lineHeight - 1.0) * 8.2
    }

}

private struct ReaderNarrationPreviewPanel: View {
    @EnvironmentObject private var app: IllumeAppModel
    let snippet: ReaderNarrationPreviewSnippet?
    var textColor = Color.white
    var height = readerImageTextCollapsedHeight
    let selectWord: (ReaderNarrationPreviewSnippet, Int) -> Void
    let expand: () -> Void

    var body: some View {
        Group {
            if let snippet {
                ReaderAttributedText(
                    text: snippet.text,
                    font: uiFont(for: snippet.paragraph),
                    textColor: UIColor(textColor),
                    lineSpacing: paragraphLineSpacing,
                    activeRange: snippet.activeRange,
                    activeHighlightColor: .clear,
                    futureTextOpacity: 0.52,
                    dimsTextWithoutActiveRange: true,
                    scrollsActiveRange: false
                ) {
                } selectWord: { wordStart in
                    selectWord(snippet, wordStart)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                EmptyView()
            }
        }
        .frame(height: height, alignment: .top)
        .clipped()
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .shadow(color: .black.opacity(0.72), radius: 10, x: 0, y: 3)
        .contentShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 14)
                .onEnded { value in
                    guard value.translation.height < -18,
                          abs(value.translation.height) > abs(value.translation.width) else {
                        return
                    }
                    expand()
                }
        )
        .accessibilityLabel("Current narration text")
    }

    private func uiFont(for paragraph: ReaderParagraph) -> UIFont {
        let scale = min(app.readerSettings.textScale, 1.18)
        let size = 18 * scale
        switch paragraph.kind {
        case .heading:
            return UIFont.readerFont(ofSize: 22 * scale, weight: .bold, family: app.readerSettings.fontFamily)
        case .quote:
            let font = UIFont.readerFont(ofSize: size, weight: .medium, family: app.readerSettings.fontFamily)
            let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor
            return UIFont(descriptor: descriptor, size: size)
        default:
            return UIFont.readerFont(ofSize: size, weight: .regular, family: app.readerSettings.fontFamily)
        }
    }

    private var paragraphLineSpacing: CGFloat {
        let lineHeight = min(max(app.readerSettings.lineHeight, 1.0), 1.55)
        return 3.4 + CGFloat(lineHeight - 1.0) * 7.2
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
    var dimsTextWithoutActiveRange = false
    var scrollsActiveRange = true
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
            futureTextOpacity: futureTextOpacity,
            dimsTextWithoutActiveRange: dimsTextWithoutActiveRange,
            scrollsActiveRange: scrollsActiveRange
        )
        guard context.coordinator.renderKey != renderKey else { return }
        context.coordinator.renderKey = renderKey
        textView.attributedText = attributedString

        if scrollsActiveRange, let activeRange {
            context.coordinator.scrollActiveRangeToVisible(activeRange, in: textView)
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
                    .foregroundColor: textColor
                ],
                range: activeRange
            )
        } else if dimsTextWithoutActiveRange {
            attributed.addAttributes(
                [
                    .foregroundColor: textColor.withAlphaComponent(futureTextOpacity)
                ],
                range: NSRange(location: 0, length: nsText.length)
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

        func scrollActiveRangeToVisible(_ range: NSRange, in textView: UITextView) {
            DispatchQueue.main.async { [weak textView] in
                guard let textView,
                      textView.window != nil,
                      !textView.bounds.isEmpty,
                      range.location >= 0,
                      NSMaxRange(range) <= textView.attributedText.length,
                      let scrollView = Self.enclosingScrollView(for: textView),
                      scrollView.window != nil,
                      !scrollView.bounds.isEmpty else { return }

                textView.layoutIfNeeded()
                let layoutManager = textView.layoutManager
                let textContainer = textView.textContainer
                layoutManager.ensureLayout(for: textContainer)

                let glyphRange = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                guard glyphRange.length > 0 else { return }

                var activeRect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
                activeRect.origin.x += textView.textContainerInset.left
                activeRect.origin.y += textView.textContainerInset.top

                let activeRectInScrollView = textView.convert(activeRect, to: scrollView)
                let viewportHeight = scrollView.bounds.height
                let upperBand = viewportHeight * readerNarrationActiveWordTopBand
                let lowerBand = viewportHeight * readerNarrationActiveWordBottomBand
                let activeMidY = activeRectInScrollView.midY
                guard activeMidY < upperBand || activeMidY > lowerBand else { return }

                let desiredOffsetY = scrollView.contentOffset.y
                    + activeMidY
                    - viewportHeight * readerNarrationTargetViewportPosition
                let maximumOffsetY = max(
                    -scrollView.adjustedContentInset.top,
                    scrollView.contentSize.height - viewportHeight + scrollView.adjustedContentInset.bottom
                )
                let clampedOffsetY = min(
                    max(desiredOffsetY, -scrollView.adjustedContentInset.top),
                    maximumOffsetY
                )
                guard abs(clampedOffsetY - scrollView.contentOffset.y) > 2 else { return }

                UIView.animate(
                    withDuration: 0.42,
                    delay: 0,
                    options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut]
                ) {
                    scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: clampedOffsetY), animated: false)
                }
            }
        }

        private static func enclosingScrollView(for view: UIView) -> UIScrollView? {
            var candidate = view.superview
            while let current = candidate {
                if let scrollView = current as? UIScrollView {
                    return scrollView
                }
                candidate = current.superview
            }
            return nil
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
        let dimsTextWithoutActiveRange: Bool
        let scrollsActiveRange: Bool

        static func == (lhs: RenderKey, rhs: RenderKey) -> Bool {
            lhs.text == rhs.text
                && lhs.fontName == rhs.fontName
                && lhs.fontSize == rhs.fontSize
                && lhs.textColor.isEqual(rhs.textColor)
                && lhs.lineSpacing == rhs.lineSpacing
                && lhs.activeRange == rhs.activeRange
                && lhs.activeHighlightColor.isEqual(rhs.activeHighlightColor)
                && lhs.futureTextOpacity == rhs.futureTextOpacity
                && lhs.dimsTextWithoutActiveRange == rhs.dimsTextWithoutActiveRange
                && lhs.scrollsActiveRange == rhs.scrollsActiveRange
        }
    }
}

private extension UIFont {
    static func readerFont(ofSize size: CGFloat, weight: UIFont.Weight, family: ReaderFontFamily) -> UIFont {
        switch family {
        case .serif:
            return systemSerifFont(ofSize: size, weight: weight)
        case .sansSerif:
            return systemFont(ofSize: size, weight: weight)
        }
    }

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
                    } label: {
                        Text(Self.formatRate(app.readerSettings.narrationRate))
                            .font(IllumeTypography.sans(12, weight: .heavy))
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

struct NarrationSpeedPopover: View {
    @EnvironmentObject private var app: IllumeAppModel
    private let rates = stride(from: 0.7, through: 2.0, by: 0.1).map { ($0 * 10).rounded() / 10 }

    var body: some View {
        VStack(spacing: 12) {
            Text("Narration Speed")
                .font(IllumeTypography.sans(25, weight: .regular))
                .foregroundStyle(IllumeTheme.ink.opacity(0.7))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(maxWidth: .infinity)

            ZStack {
                Capsule()
                    .fill(IllumeTheme.ink.opacity(0.1))
                    .frame(height: 50)
                    .padding(.horizontal, 10)
                    .allowsHitTesting(false)

                Picker("Narration Speed", selection: narrationRateBinding) {
                    ForEach(rates, id: \.self) { option in
                        Text(ReaderTransportRail.formatRate(option))
                            .font(IllumeTypography.sans(34, weight: .regular))
                            .tag(option)
                    }
                }
                .pickerStyle(.wheel)
                .labelsHidden()
                .frame(height: 196)
                .clipped()
            }
        }
        .padding(16)
        .frame(width: 288)
        .background {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(IllumeTheme.paper.opacity(0.9))
                .shadow(color: .black.opacity(0.24), radius: 24, x: 0, y: 12)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        }
    }

    private var narrationRateBinding: Binding<Double> {
        Binding(
            get: { nearestRate(to: app.readerSettings.narrationRate) },
            set: { app.setNarrationRate($0) }
        )
    }

    private func nearestRate(to value: Double) -> Double {
        rates.min(by: { abs($0 - value) < abs($1 - value) }) ?? 1.0
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
    let isExpanded: Bool
    var isCollapsed = false
    var onDarkBackground = false
    let toggleExpansion: () -> Void

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
            .font(IllumeTypography.sans(onDarkBackground ? 14 : (isCollapsed ? 12 : 14), weight: .heavy))
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
    var isCollapsed = false
    var onDarkBackground = false
    let selectRate: (Double) -> Void

    private let rates = stride(from: 0.7, through: 2.0, by: 0.1).map { ($0 * 10).rounded() / 10 }

    var body: some View {
        VStack(spacing: isCollapsed ? 10 : 14) {
            Text("Narration Speed")
                .font(IllumeTypography.sans(isCollapsed ? 26 : 31, weight: .regular))
                .foregroundStyle(titleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.76)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, isCollapsed ? 4 : 8)

            Picker("Narration Speed", selection: narrationRateBinding) {
                ForEach(rates, id: \.self) { option in
                    Text(ReaderTransportRail.formatRate(option))
                        .font(IllumeTypography.sans(isCollapsed ? 34 : 39, weight: .regular))
                        .foregroundStyle(pickerTextColor)
                        .tag(option)
                }
            }
            .pickerStyle(.wheel)
            .labelsHidden()
            .frame(height: isCollapsed ? 204 : 228)
            .clipped()
            .colorScheme(onDarkBackground ? .dark : .light)
        }
        .padding(.horizontal, isCollapsed ? 14 : 18)
        .padding(.top, isCollapsed ? 18 : 22)
        .padding(.bottom, isCollapsed ? 14 : 18)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: panelCornerRadius, style: .continuous)
                .fill(panelTint)
        }
        .illumeLiquidGlassRounded(cornerRadius: panelCornerRadius, tint: panelGlassTint)
        .shadow(color: onDarkBackground ? .black.opacity(0.38) : .black.opacity(0.18), radius: 24, x: 0, y: 14)
        .overlay {
            RoundedRectangle(cornerRadius: panelCornerRadius, style: .continuous)
                .strokeBorder(borderTint, lineWidth: 1)
        }
    }

    private var narrationRateBinding: Binding<Double> {
        Binding(
            get: { nearestRate(to: rate) },
            set: { selectRate($0) }
        )
    }

    private func nearestRate(to value: Double) -> Double {
        rates.min(by: { abs($0 - value) < abs($1 - value) }) ?? 1.0
    }

    private var panelTint: Color {
        onDarkBackground ? Color.black.opacity(0.72) : IllumeTheme.paper.opacity(0.9)
    }

    private var panelGlassTint: Color {
        onDarkBackground ? Color.black.opacity(0.56) : IllumeTheme.paper.opacity(0.72)
    }

    private var panelCornerRadius: CGFloat {
        isCollapsed ? 34 : 42
    }

    private var pickerTextColor: Color {
        onDarkBackground ? .white : IllumeTheme.ink
    }

    private var titleColor: Color {
        onDarkBackground ? .white.opacity(0.9) : IllumeTheme.ink.opacity(0.72)
    }

    private var borderTint: Color {
        onDarkBackground ? Color.white.opacity(0.18) : Color.white.opacity(0.22)
    }
}

struct ReaderGlassRoundedButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var cornerRadius: CGFloat
    var tint: Color
    var pressedScale: CGFloat = 0.94

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .illumeLiquidGlassRounded(
                cornerRadius: cornerRadius,
                tint: tint,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true,
                pressedScale: pressedScale
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(.white.opacity(configuration.isPressed ? 0.64 : 0.18), lineWidth: configuration.isPressed ? 2 : 1)
                    .scaleEffect(configuration.isPressed ? 1.035 : 1)
                    .opacity(isEnabled ? 1 : 0.35)
            }
            .brightness(configuration.isPressed ? 0.1 : 0)
            .shadow(
                color: .white.opacity(configuration.isPressed ? 0.24 : 0),
                radius: configuration.isPressed ? 18 : 0,
                x: 0, y: 0
            )
            .animation(IllumeTheme.spring, value: configuration.isPressed)
            .animation(IllumeTheme.spring, value: isEnabled)
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

fileprivate struct ReaderQuickMenuOverlay<DestinationContent: View>: View {
    let progressPercent: Int
    let hasTableOfContents: Bool
    @Binding var imageModeEnabled: Bool
    let imageModeLoading: Bool
    let imageModeDisabled: Bool
    let activeDestination: ReaderSheetDestination?
    var isCollapsed = false
    var onDarkBackground = false
    let openContents: () -> Void
    let openImageStyles: () -> Void
    let openFontSettings: () -> Void
    let openVoices: () -> Void
    let toggleImageMode: () -> Void
    let closeDestination: () -> Void
    @ViewBuilder let destinationContent: (ReaderSheetDestination) -> DestinationContent

    var body: some View {
        ZStack {
            if let activeDestination {
                ReaderQuickMenuExpandedPanel(
                    destination: activeDestination,
                    isCollapsed: isCollapsed,
                    onDarkBackground: onDarkBackground,
                    back: closeDestination
                ) {
                    destinationContent(activeDestination)
                }
                .transition(
                    .scale(scale: 0.82, anchor: activeDestination.menuExpansionAnchor)
                        .combined(with: .offset(y: 14))
                        .combined(with: .opacity)
                )
            } else {
                rows
                    .transition(
                        .scale(scale: 0.92, anchor: .bottomTrailing)
                            .combined(with: .opacity)
                    )
            }
        }
        .frame(maxWidth: .infinity)
        .animation(readerTypographyPanelAnimation, value: activeDestination?.id)
        .background {
            RoundedRectangle(cornerRadius: panelCornerRadius, style: .continuous)
                .fill(panelTint)
        }
        .illumeLiquidGlassRounded(cornerRadius: panelCornerRadius, tint: panelGlassTint)
        .shadow(color: onDarkBackground ? .black.opacity(0.38) : .black.opacity(0.18), radius: 24, x: 0, y: 14)
        .overlay {
            RoundedRectangle(cornerRadius: panelCornerRadius, style: .continuous)
                .strokeBorder(borderTint, lineWidth: 1)
        }
    }

    private var rows: some View {
        VStack(spacing: isCollapsed ? 8 : 10) {
            ReaderQuickMenuRow(
                title: "Contents • \(progressPercent)%",
                systemName: "list.bullet",
                isCollapsed: isCollapsed,
                onDarkBackground: onDarkBackground,
                isDisabled: !hasTableOfContents,
                action: openContents
            )

            ReaderQuickMenuRow(
                title: "Image Styles",
                systemName: "paintpalette.fill",
                isCollapsed: isCollapsed,
                onDarkBackground: onDarkBackground,
                action: openImageStyles
            )

            ReaderQuickMenuRow(
                title: "Font Settings",
                systemName: "textformat.size",
                isCollapsed: isCollapsed,
                onDarkBackground: onDarkBackground,
                action: openFontSettings
            )

            ReaderQuickMenuRow(
                title: "Voices",
                systemName: "waveform",
                isCollapsed: isCollapsed,
                onDarkBackground: onDarkBackground,
                action: openVoices
            )

            ReaderQuickMenuRow(
                title: "Image Mode",
                systemName: imageModeEnabled ? "photo.fill" : "photo",
                isCollapsed: isCollapsed,
                onDarkBackground: onDarkBackground,
                isSelected: imageModeEnabled,
                isLoading: imageModeLoading && imageModeEnabled,
                isDisabled: imageModeDisabled,
                action: toggleImageMode
            )
        }
        .padding(.horizontal, isCollapsed ? 14 : 18)
        .padding(.vertical, isCollapsed ? 16 : 20)
    }

    private var panelTint: Color {
        onDarkBackground ? Color.black.opacity(0.72) : IllumeTheme.paper.opacity(0.9)
    }

    private var panelGlassTint: Color {
        onDarkBackground ? Color.black.opacity(0.56) : IllumeTheme.paper.opacity(0.72)
    }

    private var panelCornerRadius: CGFloat {
        isCollapsed ? 34 : 42
    }

    private var borderTint: Color {
        onDarkBackground ? Color.white.opacity(0.18) : Color.white.opacity(0.22)
    }
}

fileprivate struct ReaderQuickMenuExpandedPanel<Content: View>: View {
    let destination: ReaderSheetDestination
    var isCollapsed = false
    var onDarkBackground = false
    let back: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: isCollapsed ? 12 : 14) {
            HStack(spacing: 12) {
                Button(action: back) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 19, weight: .black))
                        .foregroundStyle(textColor)
                        .frame(width: 42, height: 42)
                        .contentShape(Circle())
                }
                .buttonStyle(ReaderGlassCircleButtonStyle(tint: buttonTint, pressedScale: 0.92))
                .accessibilityLabel("Back to reading menu")

                Label(destination.menuTitle, systemImage: destination.menuIconName)
                    .font(IllumeTypography.sans(isCollapsed ? 20 : 22, weight: .heavy))
                    .foregroundStyle(textColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.76)

                Spacer(minLength: 8)
            }
            .padding(.horizontal, isCollapsed ? 14 : 18)
            .padding(.top, isCollapsed ? 14 : 18)

            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var textColor: Color {
        onDarkBackground ? .white : IllumeTheme.ink
    }

    private var buttonTint: Color {
        onDarkBackground ? Color.white.opacity(0.13) : Color.white.opacity(0.56)
    }
}

struct ReaderQuickMenuRow: View {
    let title: String
    let systemName: String
    var isCollapsed = false
    var onDarkBackground = false
    var isSelected = false
    var isLoading = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Text(title)
                    .font(IllumeTypography.sans(isCollapsed ? 20 : 22, weight: .regular))
                    .foregroundStyle(textColor.opacity(isDisabled ? 0.38 : 1))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)

                Spacer(minLength: 12)

                Group {
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(textColor.opacity(0.88))
                    } else {
                        Image(systemName: systemName)
                            .font(.system(size: isCollapsed ? 22 : 24, weight: .semibold))
                    }
                }
                .foregroundStyle(textColor.opacity(isDisabled ? 0.3 : 0.88))
                .frame(width: 34)
            }
            .padding(.leading, 18)
            .padding(.trailing, 16)
            .frame(height: isCollapsed ? 50 : 56)
            .contentShape(Capsule())
        }
        .buttonStyle(ReaderGlassCapsuleButtonStyle(tint: buttonTint, pressedScale: 0.965))
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.58 : 1)
        .accessibilityLabel(title)
        .accessibilityValue(isSelected ? "On" : "")
    }

    private var textColor: Color {
        onDarkBackground ? .white : IllumeTheme.ink
    }

    private var buttonTint: Color {
        if isSelected {
            return onDarkBackground ? Color.white.opacity(0.34) : Color.white.opacity(0.96)
        }
        return onDarkBackground ? Color.white.opacity(0.12) : Color.white.opacity(0.56)
    }
}

struct ReaderFontSettingsSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(ReaderFontFamily.allCases) { family in
                    Button {
                        app.readerSettings.fontFamily = family
                    } label: {
                        ReaderFontFamilyOption(
                            family: family,
                            isSelected: app.readerSettings.fontFamily == family
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 18)
            .padding(.bottom, 18)
        }
        .scrollIndicators(.hidden)
        .scrollContentBackground(.hidden)
        .presentationCornerRadius(42)
        .presentationBackground(.clear)
    }
}

private let readerTypographyPanelAnimation = Animation.spring(response: 0.44, dampingFraction: 0.78, blendDuration: 0.08)

struct ReaderFontFamilyOption: View {
    let family: ReaderFontFamily
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 14) {
            ReaderFontFamilyPreview(family: family, isSelected: isSelected)

            Text(family.label)
                .font(.system(size: 18, weight: isSelected ? .bold : .regular))
                .foregroundStyle(TableOfContentsStyle.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(TableOfContentsStyle.ink)
            }
        }
        .padding(.leading, 28)
        .padding(.trailing, 38)
        .padding(.vertical, 12)
        .background(isSelected ? Color.white.opacity(0.055) : Color.clear)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(TableOfContentsStyle.divider)
                .frame(height: 0.7)
                .padding(.leading, 28)
                .padding(.trailing, 28)
        }
        .accessibilityLabel(family.label)
        .accessibilityValue(isSelected ? "Selected" : "")
    }
}

struct ReaderFontFamilyPreview: View {
    let family: ReaderFontFamily
    let isSelected: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: isSelected
                            ? [IllumeTheme.accent.opacity(0.95), IllumeTheme.coral.opacity(0.88)]
                            : [Color.white.opacity(0.16), Color.white.opacity(0.06)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            Text(family.sample)
                .font(.system(size: 23, weight: .bold, design: family == .serif ? .serif : .default))
                .foregroundStyle(TableOfContentsStyle.ink)
                .lineLimit(1)
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .strokeBorder(Color.white.opacity(isSelected ? 0.28 : 0.1), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.16), radius: 7, x: 0, y: 3)
    }
}

struct ReaderVoiceSettingsSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(KokoroNarrationVoice.allCases) { voice in
                    Button {
                        app.setNarrationVoice(voice.id)
                    } label: {
                        ReaderVoiceOption(
                            voice: voice,
                            isSelected: KokoroNarrationVoice.availableVoice(for: app.readerSettings.narrationVoice) == voice
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 18)
            .padding(.bottom, 18)
        }
        .scrollIndicators(.hidden)
        .scrollContentBackground(.hidden)
        .presentationCornerRadius(42)
        .presentationBackground(.clear)
    }
}

struct ReaderVoiceOption: View {
    let voice: KokoroNarrationVoice
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(voice.displayName)
                .font(.system(size: 18, weight: isSelected ? .bold : .regular))
                .foregroundStyle(TableOfContentsStyle.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(TableOfContentsStyle.ink)
            }
        }
        .padding(.leading, 28)
        .padding(.trailing, 38)
        .padding(.vertical, 14)
        .background(isSelected ? Color.white.opacity(0.055) : Color.clear)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(TableOfContentsStyle.divider)
                .frame(height: 0.7)
                .padding(.leading, 28)
                .padding(.trailing, 28)
        }
        .accessibilityLabel(voice.displayName)
        .accessibilityValue(isSelected ? "Selected" : "")
    }
}

struct ReaderImageStyleSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(ReaderImageStyle.allCases, id: \.self) { style in
                    Button {
                        app.readerSettings.imageStyle = style
                    } label: {
                        ReaderImageStyleOption(
                            style: style,
                            isSelected: app.readerSettings.imageStyle == style
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 18)
            .padding(.bottom, 18)
        }
        .scrollIndicators(.hidden)
        .scrollContentBackground(.hidden)
        .presentationCornerRadius(42)
        .presentationBackground(.clear)
    }
}

struct ReaderImageStyleOption: View {
    let style: ReaderImageStyle
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 14) {
            ReaderImageStylePreview(style: style)

            Text(style.label)
                .font(.system(size: 18, weight: isSelected ? .bold : .regular))
                .foregroundStyle(TableOfContentsStyle.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            if isSelected {
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(TableOfContentsStyle.ink)
            }
        }
        .padding(.leading, 28)
        .padding(.trailing, 38)
        .padding(.vertical, 12)
        .background(isSelected ? Color.white.opacity(0.055) : Color.clear)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(TableOfContentsStyle.divider)
                .frame(height: 0.7)
                .padding(.leading, 28)
                .padding(.trailing, 28)
        }
        .accessibilityLabel(style.label)
        .accessibilityValue(isSelected ? "Selected" : "")
    }
}

struct ReaderImageStylePreview: View {
    let style: ReaderImageStyle

    var body: some View {
        Group {
            if let image = previewImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Color.white.opacity(0.1)
            }
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .shadow(color: .black.opacity(0.16), radius: 7, x: 0, y: 3)
    }

    private var previewImage: UIImage? {
        guard let url = Bundle.module.url(forResource: style.previewResourceName, withExtension: "jpg") else {
            return nil
        }
        return UIImage(contentsOfFile: url.path)
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

struct ReaderVoiceSettingsRow: View {
    @EnvironmentObject private var app: IllumeAppModel

    private var selectedVoice: KokoroNarrationVoice {
        KokoroNarrationVoice.availableVoice(for: app.readerSettings.narrationVoice)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text("Voice")
                    .font(IllumeTypography.sans(15, weight: .bold))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(selectedVoice.displayName)
                    .font(IllumeTypography.sans(12, weight: .heavy))
                    .foregroundStyle(IllumeTheme.ink.opacity(0.78))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.white.opacity(0.12), in: Capsule())
            }

            Menu {
                ForEach(KokoroNarrationVoice.allCases) { voice in
                    Button {
                        app.setNarrationVoice(voice.id)
                    } label: {
                        Text(voice.displayName)
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    Text(selectedVoice.displayName)
                        .font(IllumeTypography.sans(15, weight: .bold))
                        .foregroundStyle(IllumeTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(IllumeTheme.ink.opacity(0.62))
                }
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(.white.opacity(0.12), lineWidth: 1)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 84, alignment: .leading)
        .sliderRowGlass()
        .accessibilityElement(children: .contain)
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
    var fillsReadingView = false
    var fullTextModeEnabled = false

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

    private var imageReadabilityScrimOpacity: Double {
        guard fillsReadingView, fullTextModeEnabled else { return 0 }
        return 0.62
    }

    private var displayedImageBlurRadius: CGFloat {
        guard fillsReadingView, fullTextModeEnabled else { return 0 }
        return 7
    }

    private var lowerGradientMidOpacity: Double {
        0.72
    }

    private var lowerGradientBottomOpacity: Double {
        0.94
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Color(red: 0.015, green: 0.017, blue: 0.022))

            if phase == .checking {
                ReaderImageCheckingView(
                    urlString: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView,
                    blurRadius: displayedImageBlurRadius
                )
            } else if phase == .generating {
                ReaderImageGeneratingView(
                    backdropURLString: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView,
                    blurRadius: displayedImageBlurRadius
                )
            } else if phase == .limitReached {
                ReaderImageLimitView()
            } else if let urlString, Self.isDataImageURL(urlString) {
                ReaderImageDataURLView(
                    dataURL: urlString,
                    contentMode: imageContentMode,
                    addsBottomBlur: fillsReadingView,
                    animatesImageIn: phase == .ready,
                    blurRadius: displayedImageBlurRadius
                )
            } else if let urlString, let url = URL(string: urlString) {
                AsyncImage(url: url) { imagePhase in
                    switch imagePhase {
                    case .success(let image):
                        ReaderDisplayedImage(
                            image: image,
                            contentMode: imageContentMode,
                            addsBottomBlur: fillsReadingView,
                            blurRadius: displayedImageBlurRadius
                        )
                        .blurLoadIn(radius: 13)
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(.white.opacity(0.48))
                    default:
                        Color.clear
                    }
                }
            } else {
                Color.clear
            }

            if imageReadabilityScrimOpacity > 0 {
                Color.black
                    .opacity(imageReadabilityScrimOpacity)
            }

            VStack {
                Spacer()
                LinearGradient(
                    colors: [
                        .clear,
                        .black.opacity(lowerGradientMidOpacity),
                        .black.opacity(lowerGradientBottomOpacity)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: gradientHeight)
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

struct ReaderImageCheckingView: View {
    let urlString: String?
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false
    var blurRadius: CGFloat = 0

    var body: some View {
        ZStack {
            Color.black.opacity(0.08)

            if let urlString, ReaderImageURL.isDataImageURL(urlString) {
                ReaderImageDataURLView(
                    dataURL: urlString,
                    contentMode: contentMode,
                    addsBottomBlur: addsBottomBlur,
                    blurRadius: blurRadius
                )
                .checkingImageEffect()
            } else if let urlString, let url = URL(string: urlString) {
                AsyncImage(url: url) { imagePhase in
                    switch imagePhase {
                    case .success(let image):
                        ReaderDisplayedImage(
                            image: image,
                            contentMode: contentMode,
                            addsBottomBlur: addsBottomBlur,
                            blurRadius: blurRadius
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

struct ReaderImageDataURLView: View {
    let dataURL: String
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false
    var animatesImageIn = false
    var blurRadius: CGFloat = 0
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ReaderDisplayedImage(
                    image: Image(uiImage: image),
                    contentMode: contentMode,
                    addsBottomBlur: addsBottomBlur,
                    blurRadius: blurRadius
                )
                .blurLoadIn(radius: animatesImageIn ? 13 : 0)
            } else {
                Color.clear
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
    var blurRadius: CGFloat = 0

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
            .blur(radius: blurRadius)
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

struct ReaderImageLimitView: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.04, green: 0.043, blue: 0.052),
                    Color(red: 0.10, green: 0.078, blue: 0.066),
                    Color(red: 0.025, green: 0.041, blue: 0.044)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white.opacity(0.9))
                Text("Image limit reached")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(.white)
                Text("Upgrade to Pro to keep generating reader scenes.")
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 36)
            }
            .blurLoadIn(radius: 10)
        }
    }
}

struct ReaderImageGeneratingView: View {
    var backdropURLString: String?
    var contentMode: ContentMode = .fill
    var addsBottomBlur = false
    var blurRadius: CGFloat = 0

    var body: some View {
        ZStack {
            Color.clear

            if let backdropURLString, ReaderImageURL.isDataImageURL(backdropURLString) {
                ReaderImageDataURLView(
                    dataURL: backdropURLString,
                    contentMode: contentMode,
                    addsBottomBlur: addsBottomBlur,
                    blurRadius: blurRadius
                )
                    .generatingBackdropEffect()
            } else if let backdropURLString, let url = URL(string: backdropURLString) {
                AsyncImage(url: url) { imagePhase in
                    if case .success(let image) = imagePhase {
                        ReaderDisplayedImage(
                            image: image,
                            contentMode: contentMode,
                            addsBottomBlur: addsBottomBlur,
                            blurRadius: blurRadius
                        )
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

struct AnimatedWaveformView: View {
    let color: Color
    @State private var isAnimating = false

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<4) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(color)
                    .frame(width: 2, height: barHeight(for: index))
            }
        }
        .frame(height: 12)
        .onAppear {
            withAnimation(
                .easeInOut(duration: Double.random(in: 0.4...0.7))
                .repeatForever(autoreverses: true)
            ) {
                isAnimating = true
            }
        }
    }

    private func barHeight(for index: Int) -> CGFloat {
        let baseHeights: [CGFloat] = [3, 10, 6, 4]
        let targetHeights: [CGFloat] = [8, 3, 10, 6]
        return isAnimating ? targetHeights[index] : baseHeights[index]
    }
}

struct IllumeSlider: View {
    @Binding var value: Double
    let bounds: ClosedRange<Double>
    let step: Double
    let onDarkBackground: Bool

    @GestureState private var isDragging = false

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let range = bounds.upperBound - bounds.lowerBound
            let percentage = CGFloat((value - bounds.lowerBound) / range)
            let filledWidth = max(0, min(percentage * width, width))

            ZStack(alignment: .leading) {
                // Background Track
                Capsule()
                    .fill(onDarkBackground ? Color.white.opacity(0.12) : IllumeTheme.ink.opacity(0.08))
                    .frame(height: 6)

                // Fill Track with Gradient
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [IllumeTheme.accent, IllumeTheme.coral],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: filledWidth, height: 6)

                // Thumb
                Circle()
                    .fill(onDarkBackground ? .white : IllumeTheme.ink)
                    .frame(width: 18, height: 18)
                    .shadow(color: .black.opacity(0.18), radius: 3, x: 0, y: 1.5)
                    .scaleEffect(isDragging ? 1.25 : 1.0)
                    .offset(x: max(0, min(filledWidth - 9, width - 18)))
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .updating($isDragging) { _, state, _ in
                                state = true
                            }
                            .onChanged { gesture in
                                let dragX = gesture.location.x
                                let newPercentage = Double(max(0, min(dragX / width, 1.0)))
                                let newValue = bounds.lowerBound + newPercentage * range
                                let steppedValue = (newValue / step).rounded() * step
                                value = max(bounds.lowerBound, min(steppedValue, bounds.upperBound))
                            }
                    )
            }
            .frame(height: 18)
            .contentShape(Rectangle())
        }
        .frame(height: 18)
    }
}

struct PresetSpeedButton: View {
    let preset: Double
    let isSelected: Bool
    let onDarkBackground: Bool
    let action: () -> Void

    private var presetCornerRadius: CGFloat { 10 }
    private var presetFontSize: CGFloat { 13 }
    private var presetButtonHeight: CGFloat { 38 }

    var body: some View {
        Button(action: action) {
            Text(ReaderTransportRail.formatRate(preset))
                .font(.system(size: presetFontSize, weight: isSelected ? .black : .bold, design: .rounded))
                .foregroundStyle(isSelected ? .white : (onDarkBackground ? .white.opacity(0.7) : IllumeTheme.ink.opacity(0.7)))
                .frame(maxWidth: .infinity, minHeight: presetButtonHeight)
                .background {
                    if isSelected {
                        RoundedRectangle(cornerRadius: presetCornerRadius, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [IllumeTheme.accent.opacity(0.9), IllumeTheme.coral.opacity(0.9)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .shadow(color: IllumeTheme.coral.opacity(0.35), radius: 6, x: 0, y: 2)
                    } else {
                        RoundedRectangle(cornerRadius: presetCornerRadius, style: .continuous)
                            .fill(onDarkBackground ? Color.white.opacity(0.08) : Color.white.opacity(0.04))
                    }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: presetCornerRadius, style: .continuous)
                        .strokeBorder(
                            isSelected ? .white.opacity(0.3) : (onDarkBackground ? .white.opacity(0.12) : IllumeTheme.ink.opacity(0.08)),
                            lineWidth: 1
                        )
                }
                .scaleEffect(isSelected ? 1.03 : 1.0)
                .animation(.spring(response: 0.2, dampingFraction: 0.7), value: isSelected)
        }
        .buttonStyle(LiquidLiftButtonStyle())
    }
}

struct VoiceCard: View {
    let voice: KokoroNarrationVoice
    let isSelected: Bool
    let onDarkBackground: Bool
    let action: () -> Void

    private var voiceCardCornerRadius: CGFloat { 12 }
    private var voiceSymbolFontSize: CGFloat { 14 }
    private var voiceNameFontSize: CGFloat { 13 }
    private var voiceCardHeight: CGFloat { 38 }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(voice.symbol)
                    .font(.system(size: voiceSymbolFontSize, weight: .black, design: .rounded))
                    .foregroundStyle(isSelected ? .white : (onDarkBackground ? .white.opacity(0.88) : IllumeTheme.ink.opacity(0.88)))

                Text(voice.label)
                    .font(.system(size: voiceNameFontSize, weight: isSelected ? .bold : .medium, design: .rounded))
                    .foregroundStyle(isSelected ? .white : (onDarkBackground ? .white.opacity(0.78) : IllumeTheme.ink.opacity(0.78)))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                Spacer(minLength: 0)

                if isSelected {
                    AnimatedWaveformView(color: .white)
                        .padding(.trailing, 2)
                }
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: voiceCardHeight)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: voiceCardCornerRadius, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [IllumeTheme.accent.opacity(0.9), IllumeTheme.coral.opacity(0.9)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .shadow(color: IllumeTheme.coral.opacity(0.35), radius: 8, x: 0, y: 3)
                } else {
                    RoundedRectangle(cornerRadius: voiceCardCornerRadius, style: .continuous)
                        .fill(onDarkBackground ? Color.white.opacity(0.08) : Color.white.opacity(0.04))
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: voiceCardCornerRadius, style: .continuous)
                    .strokeBorder(
                        isSelected ? .white.opacity(0.35) : (onDarkBackground ? .white.opacity(0.12) : IllumeTheme.ink.opacity(0.08)),
                        lineWidth: 1
                    )
            }
            .scaleEffect(isSelected ? 1.025 : 1.0)
            .animation(.spring(response: 0.22, dampingFraction: 0.74), value: isSelected)
        }
        .buttonStyle(LiquidLiftButtonStyle())
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
