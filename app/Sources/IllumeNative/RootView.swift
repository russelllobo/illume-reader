#if os(iOS)
import AuthenticationServices
import IllumeCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct RootView: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        ZStack {
            IllumeTheme.paper.ignoresSafeArea()

            if !app.canLaunch {
                LaunchLoadingView()
                    .transition(.opacity)
            } else if app.isSignedIn {
                LibraryShell()
                    .libraryBlurReentry(isReaderTransitionActive: app.activeBook != nil)
                    .blurLoadIn(radius: 7)
                    .transition(.scale(scale: 0.98).combined(with: .opacity))
            } else {
                AuthView()
                    .blurLoadIn(radius: 7)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if let closingBook = app.closingBook {
                BookScreenTransitionPanel(
                    book: closingBook,
                    sourceFrame: app.bookTransitionSourceFrame,
                    phase: .closing
                )
                    .transition(.opacity)
                    .zIndex(3)
            }

            if app.activeBook != nil {
                ReaderView()
                    .readerBlurReveal()
                    .transition(.opacity)
                    .id(app.activeBookRow?.id)
                    .zIndex(2)
            }
        }
        .animation(IllumeTheme.spring, value: app.isSignedIn)
        .animation(IllumeTheme.spring, value: app.canLaunch)
        .animation(IllumeTheme.spring, value: app.openingBook?.id)
        .animation(IllumeTheme.spring, value: app.closingBook?.id)
        .animation(IllumeTheme.spring, value: app.activeBook != nil)
        .animation(IllumeTheme.blurLoadIn, value: app.activeBookRow?.id)
        .animation(IllumeTheme.blurLoadIn, value: app.isLoading)
        .animation(IllumeTheme.blurLoadIn, value: app.isImporting)
    }
}

struct ReaderBlurRevealModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isVisible = false

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .blur(radius: isVisible || reduceMotion ? 0 : 18)
            .scaleEffect(isVisible || reduceMotion ? 1 : 0.992)
            .onAppear {
                withAnimation(reduceMotion ? .easeOut(duration: 0.01) : .timingCurve(0.16, 1, 0.22, 1, duration: 0.28)) {
                    isVisible = true
                }
            }
    }
}

private extension View {
    func readerBlurReveal() -> some View {
        modifier(ReaderBlurRevealModifier())
    }
}

struct LibraryBlurReentryModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isReaderTransitionActive: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isReaderTransitionActive && !reduceMotion ? 0.92 : 1)
            .blur(radius: isReaderTransitionActive && !reduceMotion ? 14 : 0)
            .scaleEffect(isReaderTransitionActive && !reduceMotion ? 0.992 : 1)
            .animation(reduceMotion ? .easeOut(duration: 0.01) : IllumeTheme.blurLoadIn, value: isReaderTransitionActive)
    }
}

private extension View {
    func libraryBlurReentry(isReaderTransitionActive: Bool) -> some View {
        modifier(LibraryBlurReentryModifier(isReaderTransitionActive: isReaderTransitionActive))
    }
}

struct LaunchLoadingView: View {
    var body: some View {
        ZStack {
            IllumeTheme.paper.ignoresSafeArea()

            Text("illume")
                .font(IllumeTypography.logo(48, weight: .bold))
                .foregroundStyle(IllumeTheme.ink)
        }
    }
}

struct AuthView: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var email = ""
    @State private var password = ""
    @State private var isEmailSignInExpanded = false
    @State private var hasAppeared = false

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 30) {
                    Spacer(minLength: max(24, proxy.size.height * 0.08))

                    header
                        .authEntrance(isVisible: hasAppeared, delay: 0, reduceMotion: reduceMotion)

                    authActions
                        .authEntrance(isVisible: hasAppeared, delay: 0.07, reduceMotion: reduceMotion)

                    if let notice = app.visibleNotice {
                        Text(notice)
                            .font(.system(.footnote, design: .rounded, weight: .semibold))
                            .foregroundStyle(IllumeTheme.coral)
                            .padding(.horizontal, 4)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }

                    Spacer(minLength: 18)
                }
                .frame(maxWidth: 420, alignment: .leading)
                .frame(minHeight: proxy.size.height, alignment: .top)
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
            .scrollIndicators(.hidden)
            .frame(maxWidth: .infinity, alignment: .center)
            .background(authBackground)
        }
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.01) : IllumeTheme.blurLoadIn.delay(0.04)) {
                hasAppeared = true
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            AuthReadingMark()
                .frame(width: 112, height: 132)
                .padding(.bottom, 4)

            VStack(alignment: .leading, spacing: 8) {
                Text("illume")
                    .font(IllumeTypography.logo(64, weight: .bold))
                    .foregroundStyle(IllumeTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Text("Reading, but easier.")
                    .font(.system(.title2, design: .rounded, weight: .semibold))
                    .foregroundStyle(IllumeTheme.ink.opacity(0.68))
            }
        }
    }

    private var authActions: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(spacing: 12) {
                AuthActionButton(
                    title: "Continue with Apple",
                    tint: .black,
                    foreground: .white,
                    systemImage: "apple.logo"
                ) {
                    Task { await app.signInWithApple() }
                }

                AuthActionButton(
                    title: "Continue with Google",
                    tint: IllumeTheme.mist,
                    foreground: IllumeTheme.ink,
                    textIcon: "G",
                    showsBorder: true
                ) {
                    Task { await app.signInWithGoogle() }
                }

                if isEmailSignInExpanded {
                    VStack(spacing: 14) {
                        TextField("Email", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .illumeField()

                        SecureField("Password", text: $password)
                            .textContentType(app.authMode == .signIn ? .password : .newPassword)
                            .illumeField()

                        AuthActionButton(
                            title: app.authMode == .signIn ? "Sign in" : "Create account",
                            tint: IllumeTheme.ink,
                            foreground: IllumeTheme.paper,
                            systemImage: app.authMode == .signIn ? "arrow.right" : "person.badge.plus"
                        ) {
                            Task { await app.authenticate(email: email, password: password) }
                        }
                        .disabled(email.isEmpty || password.count < 6)
                    }
                    .padding(.top, 2)
                    .transition(.asymmetric(
                        insertion: .move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.98, anchor: .top)),
                        removal: .opacity
                    ))
                } else {
                    AuthActionButton(
                        title: "Sign in with email",
                        tint: IllumeTheme.ink,
                        foreground: IllumeTheme.paper,
                        systemImage: "envelope"
                    ) {
                        withAnimation(IllumeTheme.spring) {
                            isEmailSignInExpanded = true
                        }
                    }
                }
            }

            Button {
                withAnimation(IllumeTheme.spring) {
                    app.authMode = app.authMode == .signIn ? .signUp : .signIn
                    isEmailSignInExpanded = true
                }
            } label: {
                Text(app.authMode == .signIn ? "New here? Create an account" : "Already have an account? Sign in")
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(IllumeTheme.ink.opacity(0.72))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(AuthSecondaryButtonStyle())
            .padding(.top, 2)
        }
        .animation(IllumeTheme.spring, value: isEmailSignInExpanded)
        .animation(IllumeTheme.spring, value: app.authMode)
    }

    private var authBackground: some View {
        ZStack(alignment: .topTrailing) {
            LinearGradient(
                colors: [
                    IllumeTheme.paper,
                    IllumeTheme.mist.opacity(0.58),
                    Color.black.opacity(0.88)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            AuthPageBackdrop()
                .frame(width: 240, height: 320)
                .offset(x: 84, y: -42)
                .opacity(hasAppeared ? 1 : 0)
                .scaleEffect(hasAppeared ? 1 : 0.96, anchor: .topTrailing)
                .animation(reduceMotion ? .easeOut(duration: 0.01) : .easeOut(duration: 0.42).delay(0.04), value: hasAppeared)
        }
    }
}

struct AuthActionButton: View {
    let title: String
    var tint: Color
    var foreground: Color
    var systemImage: String?
    var textIcon: String?
    var showsBorder = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                icon
                    .frame(width: 34, height: 34)

                Text(title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Spacer(minLength: 8)
            }
            .padding(.horizontal, 18)
            .frame(height: 62)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(AuthActionButtonStyle(tint: tint, foreground: foreground, showsBorder: showsBorder))
    }

    @ViewBuilder
    private var icon: some View {
        if let systemImage {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .bold))
        } else if let textIcon {
            Text(textIcon)
                .font(.system(.title3, design: .rounded, weight: .black))
        }
    }
}

struct AuthActionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let tint: Color
    let foreground: Color
    var showsBorder = false

    func makeBody(configuration: Configuration) -> some View {
        let isPressed = configuration.isPressed && isEnabled
        let shape = Capsule(style: .continuous)

        if #available(iOS 26.0, *) {
            configuration.label
                .foregroundStyle(foreground)
                .glassEffect(.regular.tint(tint.opacity(showsBorder ? 0.36 : 0.58)).interactive(isEnabled), in: shape)
                .overlay {
                    shape.strokeBorder(
                        showsBorder ? IllumeTheme.ink.opacity(0.18) : Color.white.opacity(isPressed ? 0.52 : 0.22),
                        lineWidth: showsBorder ? 1 : 0.9
                    )
                }
                .contentShape(shape)
                .opacity(isEnabled ? 1 : 0.48)
                .scaleEffect(reduceMotion ? 1 : (isPressed ? 0.965 : 1))
                .offset(y: reduceMotion ? 0 : (isPressed ? 2 : 0))
                .brightness(isPressed ? 0.06 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: isPressed)
        } else {
            configuration.label
                .foregroundStyle(foreground)
                .background(
                    shape
                        .fill(tint)
                        .shadow(color: tint.opacity(isEnabled ? 0.22 : 0), radius: isPressed ? 10 : 18, y: isPressed ? 4 : 11)
                )
                .overlay {
                    shape.strokeBorder(
                        showsBorder ? IllumeTheme.ink.opacity(0.12) : Color.white.opacity(isPressed ? 0.38 : 0.18),
                        lineWidth: showsBorder ? 1 : 0.8
                    )
                }
                .overlay(alignment: .topLeading) {
                    shape
                        .fill(Color.white.opacity(isPressed ? 0.18 : 0.08))
                        .frame(height: 30)
                        .padding(3)
                        .allowsHitTesting(false)
                }
                .opacity(isEnabled ? 1 : 0.48)
                .scaleEffect(reduceMotion ? 1 : (isPressed ? 0.965 : 1))
                .offset(y: reduceMotion ? 0 : (isPressed ? 2 : 0))
                .brightness(isPressed ? 0.045 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: isPressed)
        }
    }
}

struct AuthSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let isPressed = configuration.isPressed && isEnabled
        let shape = Capsule(style: .continuous)

        if #available(iOS 26.0, *) {
            configuration.label
                .glassEffect(.regular.tint(IllumeTheme.paper.opacity(0.42)).interactive(isEnabled), in: shape)
                .overlay {
                    shape.strokeBorder(IllumeTheme.ink.opacity(isPressed ? 0.16 : 0.08), lineWidth: 1)
                }
                .contentShape(shape)
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(reduceMotion ? 1 : (isPressed ? 0.97 : 1))
                .brightness(isPressed ? 0.05 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: isPressed)
        } else {
            configuration.label
                .background(.ultraThinMaterial, in: shape)
                .overlay {
                    shape.strokeBorder(IllumeTheme.ink.opacity(0.08), lineWidth: 1)
                }
                .scaleEffect(reduceMotion ? 1 : (isPressed ? 0.97 : 1))
                .brightness(isPressed ? 0.04 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: isPressed)
        }
    }
}

struct AuthReadingMark: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(IllumeTheme.ink)
                .frame(width: 86, height: 116)
                .rotationEffect(.degrees(-5))
                .shadow(color: IllumeTheme.ink.opacity(0.2), radius: 16, y: 10)

            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(IllumeTheme.coral)
                .frame(width: 82, height: 110)
                .offset(x: 20, y: -14)
                .rotationEffect(.degrees(7))
                .shadow(color: IllumeTheme.coral.opacity(0.22), radius: 18, y: 9)

            VStack(alignment: .leading, spacing: 7) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(Color.white.opacity(index == 0 ? 0.82 : 0.58))
                        .frame(width: index == 0 ? 44 : 32, height: 4)
                }
            }
            .padding(18)
            .offset(x: 20, y: -14)
            .rotationEffect(.degrees(7))
        }
    }
}

struct AuthPageBackdrop: View {
    var body: some View {
        ZStack {
            ForEach(0..<4, id: \.self) { index in
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(IllumeTheme.ink.opacity(0.055), lineWidth: 1)
                    .background(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .fill(Color.white.opacity(0.22))
                    )
                    .rotationEffect(.degrees(Double(index) * -5 - 4))
                    .offset(x: CGFloat(index) * -14, y: CGFloat(index) * 12)
            }
        }
    }
}

private struct AuthEntranceModifier: ViewModifier {
    let isVisible: Bool
    let delay: Double
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .blur(radius: isVisible || reduceMotion ? 0 : 10)
            .offset(y: isVisible || reduceMotion ? 0 : 16)
            .animation(reduceMotion ? .easeOut(duration: 0.01) : IllumeTheme.blurLoadIn.delay(delay), value: isVisible)
    }
}

private extension View {
    func authEntrance(isVisible: Bool, delay: Double, reduceMotion: Bool) -> some View {
        modifier(AuthEntranceModifier(isVisible: isVisible, delay: delay, reduceMotion: reduceMotion))
    }
}

struct LibraryShell: View {
    @EnvironmentObject private var app: IllumeAppModel
    @State private var importerOpen = false
    @State private var profileOpen = false
    @State private var bookToRename: BookRow?
    @State private var renameTitle = ""
    @State private var bookToDelete: BookRow?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    LibraryHeader(
                        profileOpen: $profileOpen,
                        importerOpen: $importerOpen,
                        renameBook: beginRenaming,
                        deleteBook: beginDeleting
                    )
                        .blurLoadIn(delay: 0.01, radius: 7)

                    if let notice = app.visibleNotice {
                        NoticeBanner(text: notice)
                    }

                    if app.books.isEmpty && app.pendingBookImports.isEmpty {
                        EmptyLibrary(importerOpen: $importerOpen)
                    } else {
                        ContinueSection(renameBook: beginRenaming, deleteBook: beginDeleting)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
            .background(IllumeTheme.paper)
            .overlay(alignment: .top) {
                if let title = app.uploadedBookNotice {
                    UploadReadyToast(title: title)
                        .padding(.top, 12)
                        .padding(.horizontal, 18)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .refreshable {
                await app.reload()
            }
            .fileImporter(
                isPresented: $importerOpen,
                allowedContentTypes: [.illumeEpub, .pdf],
                allowsMultipleSelection: false
            ) { result in
                guard case .success(let urls) = result, let url = urls.first else { return }
                Task { await app.importDocument(from: url) }
            }
            .sheet(isPresented: $profileOpen) {
                ProfileSheet()
                    .presentationDetents([.medium, .large])
                    .presentationCornerRadius(30)
            }
            .alert("Rename Book", isPresented: renameAlertPresented) {
                TextField("Title", text: $renameTitle)
                    .textInputAutocapitalization(.words)
                Button("Cancel", role: .cancel) {
                    bookToRename = nil
                    renameTitle = ""
                }
                Button("Save") {
                    guard let book = bookToRename else { return }
                    let title = renameTitle
                    bookToRename = nil
                    renameTitle = ""
                    Task { await app.renameBook(book, title: title) }
                }
                .disabled(renameTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Choose a new title for this book.")
            }
            .confirmationDialog(
                bookToDelete.map { "Delete \"\($0.title)\"?" } ?? "Delete Book?",
                isPresented: deleteDialogPresented,
                titleVisibility: .visible
            ) {
                Button("Delete Book", role: .destructive) {
                    guard let book = bookToDelete else { return }
                    bookToDelete = nil
                    Task { await app.deleteBook(book) }
                }
                Button("Cancel", role: .cancel) {
                    bookToDelete = nil
                }
            } message: {
                Text("This removes the book from your library.")
            }
        }
    }

    private var renameAlertPresented: Binding<Bool> {
        Binding(
            get: { bookToRename != nil },
            set: { isPresented in
                if !isPresented {
                    bookToRename = nil
                    renameTitle = ""
                }
            }
        )
    }

    private var deleteDialogPresented: Binding<Bool> {
        Binding(
            get: { bookToDelete != nil },
            set: { isPresented in
                if !isPresented {
                    bookToDelete = nil
                }
            }
        )
    }

    private func beginRenaming(_ book: BookRow) {
        renameTitle = book.title
        bookToRename = book
    }

    private func beginDeleting(_ book: BookRow) {
        bookToDelete = book
    }
}

struct LibraryHeader: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Binding var profileOpen: Bool
    @Binding var importerOpen: Bool
    let renameBook: (BookRow) -> Void
    let deleteBook: (BookRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("illume")
                        .font(IllumeTypography.logo(36))
                    Text("\(app.books.count) books")
                        .font(.system(.subheadline, design: .rounded, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                IllumeGlassEffectGroup(spacing: 10) {
                    HStack(spacing: 10) {
                        SoftIconButton(systemName: "person.crop.circle") { profileOpen = true }
                        SoftIconButton(systemName: "plus") { importerOpen = true }
                    }
                }
            }

            if let first = app.books.first {
                BookOpenButton(book: first) { sourceFrame in
                    HStack(spacing: 16) {
                        BookOpenCover(book: first, size: CGSize(width: 86, height: 124), sourceFrame: sourceFrame)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Continue")
                                .font(.system(.subheadline, design: .rounded, weight: .bold))
                                .foregroundStyle(IllumeTheme.accent)
                            Text(first.title)
                                .font(.system(.title3, design: .rounded, weight: .bold))
                                .foregroundStyle(IllumeTheme.ink)
                                .lineLimit(2)
                            BookOpeningStatus(book: first)
                            Text(first.author.isEmpty ? first.fileName : first.author)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(IllumeTheme.ink)
                    }
                    .padding(16)
                }
                .buttonStyle(LiquidCardButtonStyle(cornerRadius: 26, tint: IllumeTheme.paper))
                .bookContextMenu(book: first, renameBook: renameBook, deleteBook: deleteBook)
                .bookDeleteDisappearing(book: first)
                .blurLoadIn(delay: 0.04, radius: 8)
            }
        }
    }
}

struct ContinueSection: View {
    @EnvironmentObject private var app: IllumeAppModel
    let renameBook: (BookRow) -> Void
    let deleteBook: (BookRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Library")
                .font(IllumeTypography.librarySerif(28))
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(app.pendingBookImports) { pendingImport in
                        PendingLibraryBook(pendingImport: pendingImport)
                            .blurLoadIn(radius: 8)
                    }

                    ForEach(Array(app.books.prefix(8).enumerated()), id: \.element.id) { index, book in
                        BookOpenButton(book: book) { sourceFrame in
                            VStack(alignment: .leading, spacing: 10) {
                                BookOpenCover(book: book, size: CGSize(width: 118, height: 170), sourceFrame: sourceFrame)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(book.title)
                                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                                        .foregroundStyle(IllumeTheme.ink)
                                        .lineLimit(2)
                                    BookOpeningStatus(book: book)
                                }
                                .frame(width: 118, height: 58, alignment: .topLeading)
                            }
                            .frame(width: 118, height: 238, alignment: .topLeading)
                        }
                        .buttonStyle(LiquidLiftButtonStyle())
                        .bookContextMenu(book: book, renameBook: renameBook, deleteBook: deleteBook)
                        .bookDeleteDisappearing(book: book)
                        .blurLoadIn(delay: min(Double(index) * 0.025, 0.12), radius: 8)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }
}

struct BookOpeningStatus: View {
    @EnvironmentObject private var app: IllumeAppModel
    let book: BookRow

    var body: some View {
        if app.openingBook?.id == book.id {
            AnimatedEllipsisText("Opening")
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }
}

struct PendingLibraryBook: View {
    let pendingImport: PendingBookImport

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PendingImportCover(pendingImport: pendingImport, size: CGSize(width: 118, height: 170))
            VStack(alignment: .leading, spacing: 8) {
                Text(pendingImport.title)
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .foregroundStyle(IllumeTheme.ink)
                    .lineLimit(2)
                Text(pendingImport.statusText)
                    .hidden()
                    .overlay(alignment: .leading) {
                        if pendingImport.statusText == "Generating visuals" {
                            AnimatedEllipsisText("Generating visuals")
                        } else {
                            Text(pendingImport.statusText)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(IllumeTheme.accent)
                                .lineLimit(1)
                                .minimumScaleFactor(0.84)
                        }
                    }
            }
            .frame(width: 118, height: 58, alignment: .topLeading)
        }
        .frame(width: 118, height: 238, alignment: .topLeading)
    }
}

struct AnimatedEllipsisText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dotCount = 0

    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text + String(repeating: ".", count: dotCount))
            .font(.caption.weight(.bold))
            .foregroundStyle(IllumeTheme.accent)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.84)
            .task {
                guard !reduceMotion else {
                    dotCount = 3
                    return
                }

                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(360))
                    guard !Task.isCancelled else { return }
                    dotCount = (dotCount + 1) % 4
                }
            }
            .accessibilityLabel(text)
    }
}

struct PendingImportCover: View {
    let pendingImport: PendingBookImport
    let size: CGSize

    private var blurRadius: CGFloat {
        max(0, CGFloat(100 - pendingImport.progress) * 0.18)
    }

    var body: some View {
        ZStack {
            if let coverUrl = pendingImport.coverUrl, !coverUrl.isEmpty {
                CoverArtwork(urlString: coverUrl)
            } else {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [IllumeTheme.ink, IllumeTheme.accent],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Text(pendingImport.title.prefix(1))
                    .font(.system(size: size.width * 0.46, weight: .black, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
            }
        }
        .frame(width: size.width, height: size.height)
        .blur(radius: blurRadius)
        .saturation(max(0.65, 1 - Double(100 - pendingImport.progress) * 0.003))
        .opacity(max(0.72, 1 - Double(100 - pendingImport.progress) * 0.0024))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(IllumeTheme.paper.opacity(0.14 + Double(100 - pendingImport.progress) * 0.003))
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 12, y: 8)
        .animation(IllumeTheme.blurLoadIn, value: pendingImport.progress)
    }
}

struct UploadReadyToast: View {
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .fontWeight(.bold)
                .lineLimit(1)
            Text("ready")
                .foregroundStyle(.white.opacity(0.82))
        }
        .font(.system(.footnote, design: .rounded, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: 360)
        .illumeLiquidGlassRounded(cornerRadius: 16, tint: IllumeTheme.ink)
        .shadow(color: .black.opacity(0.18), radius: 18, y: 10)
        .accessibilityElement(children: .combine)
    }
}

struct BookGrid: View {
    @EnvironmentObject private var app: IllumeAppModel
    let renameBook: (BookRow) -> Void
    let deleteBook: (BookRow) -> Void
    private let columns = [GridItem(.adaptive(minimum: 152), spacing: 18)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
            ForEach(Array(app.books.enumerated()), id: \.element.id) { index, book in
                BookOpenButton(book: book) { sourceFrame in
                    HStack(alignment: .top, spacing: 12) {
                        BookOpenCover(book: book, size: CGSize(width: 58, height: 82), sourceFrame: sourceFrame)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(book.title)
                                .font(.system(.subheadline, design: .rounded, weight: .bold))
                                .foregroundStyle(IllumeTheme.ink)
                                .lineLimit(2)
                            BookOpeningStatus(book: book)
                            Text(book.documentType.rawValue.uppercased())
                                .font(.caption2.weight(.black))
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(LiquidCardButtonStyle(cornerRadius: 18, tint: IllumeTheme.paper))
                .bookContextMenu(book: book, renameBook: renameBook, deleteBook: deleteBook)
                .bookDeleteDisappearing(book: book)
                .blurLoadIn(delay: min(Double(index) * 0.018, 0.14), radius: 7)
            }
        }
    }
}

struct EmptyLibrary: View {
    @Binding var importerOpen: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Image(systemName: "books.vertical.fill")
                .font(.system(size: 54, weight: .bold))
                .foregroundStyle(IllumeTheme.accent)
            Text("Drop in your first book.")
                .font(IllumeTypography.librarySerif(34, weight: .bold))
            Text("EPUBs and PDFs sync through the same private backend as the web app.")
                .font(.system(.body, design: .rounded))
                .foregroundStyle(.secondary)
            Button("Import EPUB or PDF") { importerOpen = true }
                .illumeNativeGlassButton(tint: IllumeTheme.accent, isProminent: true, fallback: PillButtonStyle(tint: IllumeTheme.accent))
        }
        .padding(.top, 60)
        .blurLoadIn(radius: 8)
    }
}

struct NoticeBanner: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(.footnote, design: .rounded, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .illumeLiquidGlassRounded(cornerRadius: 14, tint: IllumeTheme.coral)
            .transition(.opacity.combined(with: .move(edge: .top)))
            .blurLoadIn(radius: 6)
    }
}

struct CoverView: View {
    let book: BookRow
    let size: CGSize

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            fallbackCover

            if let coverUrl = book.coverUrl, !coverUrl.isEmpty {
                CoverArtwork(urlString: coverUrl)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 12, y: 8)
    }

    private var fallbackCover: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: coverColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(book.title.prefix(1))
                .font(.system(size: size.width * 0.46, weight: .black, design: .rounded))
                .foregroundStyle(.white.opacity(0.9))
                .padding(10)
        }
    }

    private var coverColors: [Color] {
        let palettes: [[Color]] = [
            [IllumeTheme.ink, IllumeTheme.accent],
            [IllumeTheme.plum, IllumeTheme.coral],
            [Color(red: 0.34, green: 0.22, blue: 0.46), Color(red: 0.97, green: 0.74, blue: 0.26)]
        ]
        return palettes[abs(book.title.hashValue) % palettes.count]
    }
}

struct BookOpenButton<Label: View>: View {
    @EnvironmentObject private var app: IllumeAppModel
    @State private var sourceFrame: CGRect?

    let book: BookRow
    @ViewBuilder let label: (Binding<CGRect?>) -> Label

    var body: some View {
        Button {
            Task { await app.open(book, sourceFrame: sourceFrame) }
        } label: {
            label($sourceFrame)
        }
    }
}

struct BookOpenCover: View {
    let book: BookRow
    let size: CGSize
    @Binding var sourceFrame: CGRect?

    var body: some View {
        CoverView(book: book, size: size)
            .trackBookTransitionFrame($sourceFrame)
    }
}

struct CoverArtwork: View {
    let urlString: String

    var body: some View {
        if let image = dataURLImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .blurLoadIn(radius: 10)
        } else if let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .blurLoadIn(radius: 10)
                default:
                    Color.clear
                }
            }
        } else {
            Color.clear
        }
    }

    private var dataURLImage: UIImage? {
        guard let commaIndex = urlString.firstIndex(of: ","),
              urlString[..<commaIndex].contains(";base64") else {
            return nil
        }
        let base64 = urlString[urlString.index(after: commaIndex)...]
        guard let data = Data(base64Encoded: String(base64)) else {
            return nil
        }
        return UIImage(data: data)
    }
}

struct ProfileSheet: View {
    @EnvironmentObject private var app: IllumeAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 10) {
                AccountBrandLockup(isPro: app.isPro)
                Text(app.session?.user.email ?? "Signed in")
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 16) {
                Meter(
                    label: "Storage",
                    value: Double(app.storageUsed),
                    max: Double(app.storageQuotaBytes),
                    valueText: "\(ByteCountFormatter.illumeStorage.string(fromByteCount: Int64(app.storageUsed))) / \(ByteCountFormatter.illumeStorage.string(fromByteCount: Int64(app.storageQuotaBytes)))"
                )
                Meter(
                    label: "AI Images",
                    value: Double(app.imageUsageCount),
                    max: Double(app.imageLimit),
                    valueText: "\(app.imageUsageLabel) \(app.imageUsageSuffix)"
                )
            }

            if app.isPro {
                Button("Restore purchases") {
                    Task { await app.restorePro() }
                }
                .illumeNativeGlassButton(tint: IllumeTheme.accent, isProminent: true, fallback: PillButtonStyle(tint: IllumeTheme.accent))
            } else {
                Button("Go Pro") {
                    Task { await app.purchasePro() }
                }
                .illumeNativeGlassButton(tint: IllumeTheme.ink, isProminent: true, fallback: PillButtonStyle(tint: IllumeTheme.ink))
            }

            Button("Sign out", role: .destructive) {
                app.signOut()
            }
            .illumeNativeGlassButton(tint: IllumeTheme.coral, isProminent: true, fallback: PillButtonStyle(tint: IllumeTheme.coral))

            Spacer()
        }
        .padding(24)
        .background(IllumeTheme.paper)
    }
}

struct AccountBrandLockup: View {
    let isPro: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 9) {
            Text("illume")
                .font(IllumeTypography.logo(38))
                .foregroundStyle(IllumeTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.82)

            PlanBadge(isPro: isPro)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("illume \(isPro ? "Pro" : "Free")")
    }
}

struct PlanBadge: View {
    let isPro: Bool

    var body: some View {
        Text(isPro ? "Pro" : "Free")
            .font(.system(size: 10, weight: .black, design: .rounded))
            .textCase(.uppercase)
            .tracking(0.4)
            .foregroundStyle(isPro ? IllumeTheme.paper : IllumeTheme.ink)
            .padding(.horizontal, 9)
            .frame(height: 22)
            .background {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(isPro ? IllumeTheme.ink : IllumeTheme.paper)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .strokeBorder(IllumeTheme.ink, lineWidth: 1)
            }
            .fixedSize(horizontal: true, vertical: false)
    }
}

struct Meter: View {
    let label: String
    let value: Double
    let max: Double
    var valueText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(.system(.subheadline, design: .rounded, weight: .bold))
                Spacer()
                Text(valueText ?? "\(Int(value)) / \(Int(max))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                RoundedRectangle(cornerRadius: 6)
                    .fill(.black.opacity(0.08))
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 6)
                            .fill(IllumeTheme.accent)
                            .frame(width: proxy.size.width * min(1, value / max))
                    }
            }
            .frame(height: 10)
        }
    }
}

private extension ByteCountFormatter {
    static var illumeStorage: ByteCountFormatter {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useMB, .useGB]
        formatter.countStyle = .file
        formatter.includesUnit = true
        formatter.isAdaptive = true
        return formatter
    }
}

struct BookScreenTransitionPanel: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded: Bool

    let book: BookRow
    let sourceFrame: CGRect?
    let phase: Phase

    enum Phase {
        case opening
        case closing
    }

    init(book: BookRow, sourceFrame: CGRect?, phase: Phase) {
        self.book = book
        self.sourceFrame = sourceFrame
        self.phase = phase
        _isExpanded = State(initialValue: phase == .closing)
    }

    var body: some View {
        GeometryReader { proxy in
            let screenFrame = CGRect(origin: .zero, size: proxy.size)
            let source = sourceFrame ?? fallbackSourceFrame(in: proxy.size)
            let panelFrame = isExpanded ? screenFrame : source
            let cornerRadius = isExpanded ? 0 : min(18, panelFrame.width * 0.18)

            ZStack {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(IllumeTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                    .shadow(color: .black.opacity(isExpanded ? 0 : 0.18), radius: isExpanded ? 0 : 14, y: isExpanded ? 0 : 8)
                    .frame(width: panelFrame.width, height: panelFrame.height)
                    .position(x: panelFrame.midX, y: panelFrame.midY)

                CoverView(book: book, size: panelFrame.size)
                    .opacity(isExpanded ? 0 : 1)
                    .position(x: panelFrame.midX, y: panelFrame.midY)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .ignoresSafeArea()
        }
        .onAppear {
            let animation = reduceMotion
                ? Animation.easeOut(duration: 0.01)
                : Animation.timingCurve(0.18, 0.82, 0.18, 1, duration: 0.22)

            withAnimation(animation) {
                isExpanded = phase == .opening
                    ? true
                    : false
            }
        }
    }

    private func fallbackSourceFrame(in size: CGSize) -> CGRect {
        let width = min(size.width * 0.28, 118)
        let height = width * 1.44
        return CGRect(
            x: (size.width - width) / 2,
            y: size.height * 0.28,
            width: width,
            height: height
        )
    }
}

struct BookLoadingSheen: View {
    @State private var sweep = false

    var body: some View {
        GeometryReader { proxy in
            LinearGradient(
                colors: [.clear, .white.opacity(0.28), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(width: proxy.size.width * 0.42, height: proxy.size.height * 1.45)
            .rotationEffect(.degrees(18))
            .offset(x: sweep ? proxy.size.width * 1.05 : -proxy.size.width * 0.62)
            .animation(.easeInOut(duration: 1.45).repeatForever(autoreverses: false), value: sweep)
        }
        .onAppear {
            sweep = true
        }
    }
}

private struct BookTransitionFramePreferenceKey: PreferenceKey {
    static let defaultValue: CGRect? = nil

    static func reduce(value: inout CGRect?, nextValue: () -> CGRect?) {
        value = nextValue() ?? value
    }
}

private extension View {
    func bookDeleteDisappearing(book: BookRow) -> some View {
        modifier(BookDeleteDisappearingModifier(bookID: book.id))
    }

    func trackBookTransitionFrame(_ frame: Binding<CGRect?>) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: BookTransitionFramePreferenceKey.self,
                    value: proxy.frame(in: .global)
                )
            }
        )
        .onPreferenceChange(BookTransitionFramePreferenceKey.self) { value in
            guard let value else { return }
            frame.wrappedValue = value
        }
    }

    func bookContextMenu(
        book: BookRow,
        renameBook: @escaping (BookRow) -> Void,
        deleteBook: @escaping (BookRow) -> Void
    ) -> some View {
        contextMenu {
            Button {
                renameBook(book)
            } label: {
                Label("Rename", systemImage: "pencil")
            }

            Button(role: .destructive) {
                deleteBook(book)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    func illumeField() -> some View {
        self
            .font(.system(.body, design: .rounded, weight: .medium))
            .padding(.horizontal, 16)
            .frame(height: 54)
            .illumeLiquidGlassRounded(cornerRadius: 18, tint: IllumeTheme.paper)
    }
}

private struct BookDeleteDisappearingModifier: ViewModifier {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let bookID: UUID

    private var isDeleting: Bool {
        app.deletingBookIDs.contains(bookID)
    }

    func body(content: Content) -> some View {
        content
            .blur(radius: isDeleting && !reduceMotion ? 16 : 0)
            .opacity(isDeleting ? 0 : 1)
            .scaleEffect(isDeleting && !reduceMotion ? 0.94 : 1)
            .allowsHitTesting(!isDeleting)
            .accessibilityHidden(isDeleting)
            .animation(reduceMotion ? .easeOut(duration: 0.01) : IllumeTheme.blurLoadIn, value: isDeleting)
    }
}

private extension UTType {
    static let illumeEpub = UTType(filenameExtension: "epub") ?? .data
}
#endif
