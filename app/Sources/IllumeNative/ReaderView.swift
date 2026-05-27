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

struct ReaderView: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var settingsOpen = false
    @State private var tableOfContentsOpen = false
    @State private var pendingParagraphID: String?
    @State private var scrollRequest = 0
    @State private var readerContentVisible = true
    @State private var currentIndex = 0
    @State private var imageModeEnabled = false
    @State private var imageModeTask: Task<Void, Never>?
    @State private var scheduledImageChunkIndex: Int?

    var body: some View {
        let theme = app.readerSettings.theme

        ZStack {
            theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                ReaderToolbar(
                    tableOfContentsOpen: $tableOfContentsOpen,
                    settingsOpen: $settingsOpen,
                    hasTableOfContents: app.activeBook.map { !tableOfContentsEntries(for: $0).isEmpty } ?? false
                ) {
                    app.closeReader()
                    dismiss()
                }

                if let book = app.activeBook {
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
                        .blurLoadIn(radius: 7)
                        .opacity(readerContentVisible ? 1 : 0)
                        .blur(radius: readerContentVisible ? 0 : 7)
                        .scaleEffect(readerContentVisible ? 1 : 0.985)
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

            if let imageUrl = app.readerImageResponse?.imageUrl,
               let url = URL(string: imageUrl) {
                ReaderImageOverlay(url: url) {
                    withAnimation(IllumeTheme.spring) {
                        app.readerImageResponse = nil
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

                        ReaderImageModeButton(
                            isEnabled: imageModeEnabled,
                            isLoading: app.isLoading,
                            isDisabled: imageParagraph(in: book) == nil
                        ) {
                            toggleImageMode(for: book)
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 20)
                }
            }
        }
        .foregroundStyle(theme.foreground)
        .sheet(isPresented: $settingsOpen) {
            ReaderSettingsSheet()
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
        .onChange(of: app.readerSettings.imageStyle) {
            guard imageModeEnabled, let book = app.activeBook else { return }
            scheduledImageChunkIndex = nil
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
            await app.generateImage(text: chunk.text, startWord: chunk.startWord, endWord: chunk.endWord)
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
        let target = min(max(currentIndex, 0), book.paragraphs.count - 1)
        var wordsBeforeTarget = 0
        var allWords: [String] = []

        for (index, paragraph) in book.paragraphs.enumerated() {
            if paragraph.kind == .heading { continue }
            let paragraphWords = paragraph.text.split(whereSeparator: \.isWhitespace).map(String.init)
            if index < target {
                wordsBeforeTarget += paragraphWords.count
            }
            allWords.append(contentsOf: paragraphWords)
        }

        guard !allWords.isEmpty else { return nil }
        let chunkIndex = wordsBeforeTarget / readerImageChunkWords
        let startOffset = min(chunkIndex * readerImageChunkWords, allWords.count - 1)
        let endOffset = min(startOffset + readerImageChunkWords, allWords.count)
        guard startOffset < endOffset else { return nil }

        return ReaderImageChunk(
            endWord: endOffset,
            index: chunkIndex,
            startWord: startOffset + 1,
            text: allWords[startOffset..<endOffset].joined(separator: " ")
        )
    }

    private func tableOfContentsEntries(for book: ReaderBook) -> [TableOfContentsEntry] {
        var entries: [TableOfContentsEntry] = []
        for (chapterIndex, title) in book.chapters.enumerated() where !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let paragraphIndex = book.paragraphs.firstIndex(where: { $0.chapterIndex == chapterIndex }) else {
                continue
            }
            entries.append(
                TableOfContentsEntry(
                    title: title,
                    paragraphIndex: paragraphIndex,
                    paragraphID: book.paragraphs[paragraphIndex].id,
                    pageNumber: book.paragraphs[paragraphIndex].pageNumber
                )
            )
        }

        let hasOnlyBookTitle = entries.count == 1 && entries.first?.title == book.title
        if entries.isEmpty || hasOnlyBookTitle {
            let headingEntries: [TableOfContentsEntry] = book.paragraphs.enumerated().compactMap { index, paragraph in
                guard paragraph.kind == .heading else { return nil }
                return TableOfContentsEntry(
                    title: paragraph.text,
                    paragraphIndex: index,
                    paragraphID: paragraph.id,
                    pageNumber: paragraph.pageNumber
                )
            }
            if !headingEntries.isEmpty {
                entries = headingEntries.map { entry in
                    TableOfContentsEntry(
                        title: entry.title,
                        paragraphIndex: entry.paragraphIndex,
                        paragraphID: entry.paragraphID,
                        pageNumber: entry.pageNumber
                    )
                }
            }
        }

        if entries.isEmpty, !book.paragraphs.isEmpty {
            entries = [TableOfContentsEntry(title: book.title, paragraphIndex: 0, paragraphID: book.paragraphs[0].id, pageNumber: book.paragraphs.first?.pageNumber)]
        }

        return entries
    }
}

struct ReaderToolbar: View {
    @Binding var tableOfContentsOpen: Bool
    @Binding var settingsOpen: Bool
    let hasTableOfContents: Bool
    let close: () -> Void

    var body: some View {
        HStack {
            SoftIconButton(systemName: "chevron.down", action: close)
            Spacer()
            SoftIconButton(systemName: "list.bullet") { tableOfContentsOpen = true }
                .disabled(!hasTableOfContents)
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
        context.coordinator.wordRanges = IllumeAppModel.wordRanges(in: text)
        textView.linkTextAttributes = [
            .foregroundColor: textColor,
            .underlineStyle: 0
        ]
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
}

struct ReaderNarrationButton: View {
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 22, weight: .black))
                .foregroundStyle(IllumeTheme.ink)
                .frame(width: 58, height: 58)
                .illumeLiquidGlassCircle(
                    tint: isPlaying ? IllumeTheme.mist : IllumeTheme.paper,
                    isInteractive: true
                )
        }
        .buttonStyle(LiquidLiftButtonStyle())
        .accessibilityLabel(isPlaying ? "Stop narration" : "Play narration")
    }
}

struct ReaderImageModeButton: View {
    let isEnabled: Bool
    let isLoading: Bool
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
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

struct ReaderSettingsSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

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

struct ReaderImageOverlay: View {
    let url: URL
    let close: () -> Void

    var body: some View {
        VStack {
            Spacer()
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .blurLoadIn(radius: 10)
                case .failure:
                    Image(systemName: "photo")
                        .font(.largeTitle)
                default:
                    ProgressView()
                }
            }
            .frame(maxHeight: 360)
            .padding(12)
            .illumeLiquidGlassRounded(cornerRadius: 28, tint: IllumeTheme.paper)
            .overlay(alignment: .topTrailing) {
                SoftIconButton(systemName: "xmark", action: close)
                    .padding(16)
            }
            .padding(18)
        }
        .background {
            Color.black.opacity(0.18)
                .ignoresSafeArea()
                .onTapGesture(perform: close)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
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
