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
                    .libraryBlurReentry(isReaderTransitionActive: app.isReaderPresented)
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
                    .zIndex(3)
            }

            if app.activeBook != nil, app.isReaderPresented {
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
        .animation(IllumeTheme.spring, value: app.isReaderPresented)
        .animation(IllumeTheme.blurLoadIn, value: app.activeBookRow?.id)
        .animation(IllumeTheme.blurLoadIn, value: app.isLoading)
        .animation(IllumeTheme.blurLoadIn, value: app.isImporting)
        .fullScreenCover(item: $app.proUpgradePrompt) { prompt in
            ProUpgradeSheet(prompt: prompt)
        }
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

private enum OnboardingStep {
    case welcome
    case productMotion
    case auth
}

struct AuthView: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var email = ""
    @State private var password = ""
    @State private var isEmailSignInExpanded = false
    @State private var hasAppeared = false
    @State private var onboardingStep: OnboardingStep = .welcome

    var body: some View {
        ZStack {
            authBackground

            switch onboardingStep {
            case .welcome:
                WelcomeOnboardingScreen(
                    showAuth: showExistingAccount,
                    continueToDemo: {
                        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: reduceMotion ? 0.01 : 0.38)) {
                            onboardingStep = .productMotion
                        }
                    }
                )
                .transition(.asymmetric(
                    insertion: .opacity,
                    removal: .opacity.combined(with: .move(edge: .leading))
                ))
            case .productMotion:
                ProductMotionOnboardingScreen(
                    showAuth: {
                        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: reduceMotion ? 0.01 : 0.36)) {
                            onboardingStep = .auth
                            app.authMode = .signUp
                        }
                    }
                )
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .trailing)),
                    removal: .opacity.combined(with: .move(edge: .leading))
                ))
            case .auth:
                authForm
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(IllumeTheme.spring, value: onboardingStep)
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.01) : IllumeTheme.blurLoadIn.delay(0.04)) {
                hasAppeared = true
            }
        }
    }

    private func showExistingAccount() {
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: reduceMotion ? 0.01 : 0.36)) {
            app.authMode = .signIn
            isEmailSignInExpanded = false
            onboardingStep = .auth
        }
    }

    private var authForm: some View {
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

private struct WelcomeOnboardingScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visibleTitleWordCount = 0

    let showAuth: () -> Void
    let continueToDemo: () -> Void

    private let titleLines = [["Read", "without"], ["drifting", "away."]]
    private var titleWordCount: Int {
        titleLines.reduce(0) { $0 + $1.count }
    }

    var body: some View {
        OnboardingPageShell {
            ZStack(alignment: .topTrailing) {
                OnboardingLogoShine(sunSize: 170, beamLength: 420)
                    .frame(width: 300, height: 270)
                    .offset(x: 96, y: -76)
                    .onboardingEntrance(delay: 0, reduceMotion: reduceMotion)

                VStack(alignment: .leading, spacing: 26) {
                    Spacer(minLength: 72)

                    Text("illume")
                        .font(IllumeTypography.logo(28, weight: .bold))
                        .foregroundStyle(IllumeTheme.ink.opacity(0.88))
                        .onboardingEntrance(delay: 0, reduceMotion: reduceMotion)

                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(titleLines.enumerated()), id: \.offset) { lineIndex, line in
                            HStack(spacing: 10) {
                                ForEach(Array(line.enumerated()), id: \.offset) { wordIndex, word in
                                    let absoluteIndex = titleLines.prefix(lineIndex).reduce(0) { $0 + $1.count } + wordIndex
                                    Text(word)
                                        .font(IllumeTypography.logo(58, weight: .bold))
                                        .foregroundStyle(IllumeTheme.ink)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.74)
                                        .opacity(visibleTitleWordCount > absoluteIndex ? 1 : 0)
                                        .blur(radius: visibleTitleWordCount > absoluteIndex || reduceMotion ? 0 : 8)
                                        .animation(reduceMotion ? .easeOut(duration: 0.01) : .timingCurve(0.16, 1, 0.3, 1, duration: 0.58), value: visibleTitleWordCount)
                                }
                            }
                            .lineLimit(1)
                        }
                    }
                    .padding(.top, 12)

                    Text("Illume helps you stay with a book using natural narration, live word tracking and beautiful illustrations.")
                        .font(.system(size: 18, weight: .medium, design: .rounded))
                        .foregroundStyle(IllumeTheme.ink.opacity(0.72))
                        .lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true)
                        .onboardingEntrance(delay: 0, reduceMotion: reduceMotion)

                    Spacer(minLength: 34)

                    VStack(spacing: 12) {
                        OnboardingPrimaryButton(title: "Start my first focused read", systemImage: "arrow.right") {
                            continueToDemo()
                        }

                        Button(action: showAuth) {
                            Text("Already have an account?")
                                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                .foregroundStyle(IllumeTheme.ink.opacity(0.66))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                    .onboardingEntrance(delay: 0, reduceMotion: reduceMotion)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            }
        }
        .task {
            visibleTitleWordCount = reduceMotion ? titleWordCount : 0
            guard !reduceMotion else { return }
            for index in 1...titleWordCount {
                try? await Task.sleep(for: .milliseconds(index == 1 ? 240 : 280))
                visibleTitleWordCount = index
            }
        }
    }
}

private struct ProductMotionOnboardingScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let showAuth: () -> Void

    var body: some View {
        OnboardingPageShell {
            VStack(alignment: .leading, spacing: 26) {
                Spacer(minLength: 34)

                OnboardingLogoShine(sunSize: 142, beamLength: 360, showsSparkles: true)
                    .frame(maxWidth: .infinity)
                    .frame(height: 318)
                    .onboardingEntrance(delay: 0.02, reduceMotion: reduceMotion)

                VStack(alignment: .leading, spacing: 14) {
                    Text("Your eyes, ears, and imagination working together.")
                        .font(IllumeTypography.logo(38, weight: .bold))
                        .foregroundStyle(IllumeTheme.ink)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("Follow the words. Hear the story. See difficult passages come to life.")
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(IllumeTheme.ink.opacity(0.72))
                        .lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .onboardingEntrance(delay: 0.1, reduceMotion: reduceMotion)

                Spacer(minLength: 18)

                OnboardingPrimaryButton(title: "Show me how it works", systemImage: "sparkles") {
                    showAuth()
                }
                .onboardingEntrance(delay: 0.18, reduceMotion: reduceMotion)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 24)
        }
    }
}

private struct OnboardingPageShell<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { proxy in
            content()
                .frame(maxWidth: 430, minHeight: proxy.size.height, alignment: .topLeading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .clipped()
        }
    }
}

private struct OnboardingLogoShine: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var sunSize: CGFloat
    var beamLength: CGFloat
    var showsSparkles = false

    var body: some View {
        TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1 / 30)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            let shimmer = reduceMotion ? 0.55 : (sin(elapsed * 0.9) + 1) * 0.5
            let sweep = reduceMotion ? 0 : sin(elapsed * 0.58) * 10

            ZStack(alignment: .topTrailing) {
                SunBeam(width: sunSize * 0.7, length: beamLength)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 1.0, green: 0.46, blue: 0.1).opacity(0.44 + shimmer * 0.16),
                                Color(red: 1.0, green: 0.3, blue: 0.02).opacity(0.2 + shimmer * 0.12),
                                Color.clear
                            ],
                            startPoint: .topTrailing,
                            endPoint: .bottomLeading
                        )
                    )
                    .blur(radius: 18)
                    .rotationEffect(.degrees(12 + sweep), anchor: .topTrailing)
                    .offset(x: -sunSize * 0.48, y: sunSize * 0.56)
                    .blendMode(.screen)

                SunBeam(width: sunSize * 0.42, length: beamLength * 0.84)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 1.0, green: 0.72, blue: 0.28).opacity(0.3 + shimmer * 0.12),
                                Color(red: 1.0, green: 0.4, blue: 0.08).opacity(0.12),
                                Color.clear
                            ],
                            startPoint: .topTrailing,
                            endPoint: .bottomLeading
                        )
                    )
                    .blur(radius: 12)
                    .rotationEffect(.degrees(-2 - sweep * 0.7), anchor: .topTrailing)
                    .offset(x: -sunSize * 0.56, y: sunSize * 0.5)
                    .blendMode(.screen)

                Circle()
                    .fill(IllumeTheme.coral.opacity(0.24 + shimmer * 0.14))
                    .frame(width: sunSize * 2.15, height: sunSize * 2.15)
                    .blur(radius: 34)
                    .offset(x: sunSize * 0.45, y: -sunSize * 0.12)
                    .blendMode(.screen)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 1.0, green: 0.72, blue: 0.25),
                                Color(red: 1.0, green: 0.42, blue: 0.06),
                                IllumeTheme.coral
                            ],
                            center: .topLeading,
                            startRadius: 4,
                            endRadius: sunSize * 0.72
                        )
                    )
                    .frame(width: sunSize, height: sunSize)
                    .shadow(color: IllumeTheme.coral.opacity(0.5 + shimmer * 0.18), radius: 30 + shimmer * 10)
                    .overlay {
                        Circle()
                            .stroke(Color.white.opacity(0.14), lineWidth: 1)
                            .padding(1)
                    }
                    .scaleEffect(reduceMotion ? 1 : 0.985 + shimmer * 0.025)

                if showsSparkles {
                    ShineSparkles(phase: shimmer)
                        .frame(width: beamLength * 0.72, height: beamLength * 0.38)
                        .offset(x: -sunSize * 1.35, y: sunSize * 0.85)
                }
            }
            .accessibilityHidden(true)
        }
        .allowsHitTesting(false)
    }
}

private struct SunBeam: Shape {
    let width: CGFloat
    let length: CGFloat

    func path(in rect: CGRect) -> Path {
        let source = CGPoint(x: rect.maxX, y: rect.minY)
        let end = CGPoint(x: rect.maxX - length, y: rect.minY + length * 0.82)

        var path = Path()
        path.move(to: source)
        path.addLine(to: CGPoint(x: end.x - width * 0.5, y: end.y))
        path.addQuadCurve(to: CGPoint(x: end.x + width * 0.5, y: end.y), control: CGPoint(x: end.x, y: end.y + width * 0.35))
        path.closeSubpath()
        return path
    }
}

private struct ShineSparkles: View {
    let phase: Double

    var body: some View {
        ZStack {
            ForEach(0..<5, id: \.self) { index in
                Circle()
                    .fill(Color(red: 1.0, green: 0.78, blue: 0.34).opacity(0.2 + opacity(for: index)))
                    .frame(width: CGFloat(5 + index * 2), height: CGFloat(5 + index * 2))
                    .blur(radius: 1.5)
                    .offset(offset(for: index))
            }
        }
        .blendMode(.screen)
    }

    private func opacity(for index: Int) -> Double {
        let wave = sin((phase * .pi * 2) + Double(index) * 0.9)
        return max(0.05, (wave + 1) * 0.18)
    }

    private func offset(for index: Int) -> CGSize {
        let points = [
            CGSize(width: -86, height: -24),
            CGSize(width: -34, height: 12),
            CGSize(width: 24, height: -36),
            CGSize(width: 82, height: 8),
            CGSize(width: 126, height: -18)
        ]
        return points[index]
    }
}

private struct OnboardingPrimaryButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.74)

                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .black))
            }
            .padding(.horizontal, 18)
            .frame(height: 62)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(AuthActionButtonStyle(
            tint: Color(red: 1.0, green: 0.61, blue: 0.22),
            foreground: IllumeTheme.paper
        ))
    }
}

private struct ProductDemoLoop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let lines = [
        ["The", "lamp", "warmed", "the", "page"],
        ["and", "the", "sentence", "began"],
        ["to", "open", "toward", "morning."]
    ]

    private var wordCount: Int {
        lines.reduce(0) { $0 + $1.count }
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 0.12)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            let activeWord = reduceMotion ? 5 : Int(elapsed * 2.4).positiveModulo(wordCount)
            let imagePulse = reduceMotion ? 1 : 0.96 + CGFloat((sin(elapsed * 2.0) + 1) * 0.025)

            ZStack(alignment: .topTrailing) {
                RoundedRectangle(cornerRadius: 34, style: .continuous)
                    .fill(IllumeTheme.ink.opacity(0.07))
                    .overlay {
                        RoundedRectangle(cornerRadius: 34, style: .continuous)
                            .stroke(IllumeTheme.ink.opacity(0.1), lineWidth: 1)
                    }

                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 8) {
                        Image(systemName: "waveform")
                            .font(.system(size: 15, weight: .black))
                            .foregroundStyle(IllumeTheme.accent)
                        Text("Narrating")
                            .font(.system(.caption, design: .rounded, weight: .black))
                            .foregroundStyle(IllumeTheme.ink.opacity(0.62))
                        Spacer()
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { lineIndex, line in
                            HStack(spacing: 5) {
                                ForEach(Array(line.enumerated()), id: \.offset) { wordOffset, word in
                                    let index = wordIndex(line: lineIndex, word: wordOffset)
                                    DemoWord(word: word, isActive: index == activeWord)
                                }
                            }
                        }
                    }

                    HStack(spacing: 9) {
                        ForEach(0..<wordCount, id: \.self) { index in
                            Capsule()
                                .fill(index <= activeWord ? IllumeTheme.accent.opacity(0.95) : IllumeTheme.ink.opacity(0.12))
                                .frame(width: index % 4 == 0 ? 4 : 3, height: CGFloat(8 + (index % 5) * 6))
                                .animation(.easeInOut(duration: 0.18), value: activeWord)
                        }
                    }
                    .frame(height: 42, alignment: .bottom)

                    Spacer(minLength: 0)
                }
                .padding(24)
                .padding(.trailing, 80)

                DemoIllustrationCard(scale: imagePulse)
                    .frame(width: 124, height: 154)
                    .offset(x: 5, y: 72)
                    .shadow(color: IllumeTheme.accent.opacity(0.2), radius: 24, y: 14)
            }
        }
        .accessibilityLabel("Demo showing narration, live word highlighting, and an illustration appearing beside the passage.")
    }

    private func wordIndex(line: Int, word: Int) -> Int {
        lines.prefix(line).reduce(0) { $0 + $1.count } + word
    }
}

private struct DemoWord: View {
    let word: String
    let isActive: Bool

    var body: some View {
        Text(word)
            .font(.system(size: 17, weight: isActive ? .bold : .medium, design: .serif))
            .foregroundStyle(isActive ? IllumeTheme.paper : IllumeTheme.ink.opacity(0.78))
            .padding(.horizontal, isActive ? 6 : 0)
            .padding(.vertical, isActive ? 4 : 0)
            .background {
                if isActive {
                    Capsule(style: .continuous)
                        .fill(IllumeTheme.accent)
                }
            }
            .animation(.easeInOut(duration: 0.18), value: isActive)
    }
}

private struct DemoIllustrationCard: View {
    let scale: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.99, green: 0.59, blue: 0.31),
                        Color(red: 0.45, green: 0.24, blue: 0.38),
                        Color(red: 0.11, green: 0.13, blue: 0.18)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(alignment: .bottomLeading) {
                ZStack(alignment: .bottomLeading) {
                    Circle()
                        .fill(Color.yellow.opacity(0.64))
                        .frame(width: 42, height: 42)
                        .offset(x: 52, y: -82)

                    Path { path in
                        path.move(to: CGPoint(x: 0, y: 130))
                        path.addCurve(to: CGPoint(x: 72, y: 62), control1: CGPoint(x: 24, y: 90), control2: CGPoint(x: 42, y: 70))
                        path.addCurve(to: CGPoint(x: 124, y: 130), control1: CGPoint(x: 96, y: 84), control2: CGPoint(x: 110, y: 102))
                        path.closeSubpath()
                    }
                    .fill(Color.black.opacity(0.28))

                    Path { path in
                        path.move(to: CGPoint(x: 18, y: 132))
                        path.addCurve(to: CGPoint(x: 90, y: 76), control1: CGPoint(x: 34, y: 104), control2: CGPoint(x: 58, y: 74))
                        path.addCurve(to: CGPoint(x: 124, y: 128), control1: CGPoint(x: 104, y: 92), control2: CGPoint(x: 116, y: 112))
                        path.closeSubpath()
                    }
                    .fill(IllumeTheme.ink.opacity(0.22))
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(Color.white.opacity(0.24), lineWidth: 1)
            }
            .scaleEffect(scale)
    }
}

private struct OnboardingEntranceModifier: ViewModifier {
    let delay: Double
    let reduceMotion: Bool
    @State private var isVisible = false

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .blur(radius: isVisible || reduceMotion ? 0 : 10)
            .offset(y: isVisible || reduceMotion ? 0 : 16)
            .onAppear {
                withAnimation(reduceMotion ? .easeOut(duration: 0.01) : .timingCurve(0.16, 1, 0.3, 1, duration: 0.42).delay(delay)) {
                    isVisible = true
                }
            }
    }
}

private extension View {
    func onboardingEntrance(delay: Double, reduceMotion: Bool) -> some View {
        modifier(OnboardingEntranceModifier(delay: delay, reduceMotion: reduceMotion))
    }
}

private extension Int {
    func positiveModulo(_ divisor: Int) -> Int {
        guard divisor != 0 else { return 0 }
        let remainder = self % divisor
        return remainder >= 0 ? remainder : remainder + divisor
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
        let glassTintOpacity = showsBorder ? 0.68 : 0.74
        let borderOpacity = showsBorder ? 0.34 : (isPressed ? 0.58 : 0.32)

        if #available(iOS 26.0, *) {
            configuration.label
                .foregroundStyle(foreground)
                .glassEffect(.regular.tint(tint.opacity(glassTintOpacity)).interactive(isEnabled), in: shape)
                .overlay {
                    shape.strokeBorder(
                        showsBorder ? IllumeTheme.ink.opacity(borderOpacity) : Color.white.opacity(borderOpacity),
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
                        showsBorder ? IllumeTheme.ink.opacity(0.28) : Color.white.opacity(isPressed ? 0.44 : 0.24),
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
        OnboardingLogoShine(sunSize: 140, beamLength: 360)
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
    @State private var selectedClassic: ClassicBook?

    private var classicShelves: [ClassicGenreShelf] {
        ClassicCatalog.shelves()
    }

    private var expandedPanelClassics: [ClassicBook] {
        let shelfBooks = classicShelves.flatMap(\.books)
        var seen = Set<String>()
        var uniqueBooks = shelfBooks.filter { seen.insert($0.id).inserted }
        if let selectedClassic, !seen.contains(selectedClassic.id) {
            uniqueBooks.insert(selectedClassic, at: 0)
        }
        return uniqueBooks
    }

    var body: some View {
        NavigationStack {
            ZStack {
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

                        if !classicShelves.isEmpty {
                            ClassicsSection(
                                shelves: classicShelves,
                                selectedClassic: $selectedClassic
                            )
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, app.activeBook == nil ? 32 : 150)
                }
                .scrollIndicators(.hidden)
                .background(IllumeTheme.paper)
                .refreshable {
                    await app.reload()
                }
                .overlay(alignment: .top) {
                    if let title = app.uploadedBookNotice {
                        UploadReadyToast(title: title)
                            .padding(.top, 12)
                            .padding(.horizontal, 18)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }

                if let selectedClassic {
                    Color.black.opacity(0.16)
                        .ignoresSafeArea()
                        .transition(.opacity)
                        .onTapGesture {
                            withAnimation(IllumeTheme.spring) {
                                self.selectedClassic = nil
                            }
                        }

                    ClassicExpandedPanel(
                        classic: selectedClassic,
                        classics: expandedPanelClassics,
                        selectClassic: { classic in
                            withAnimation(IllumeTheme.spring) {
                                self.selectedClassic = classic
                            }
                        },
                        close: {
                            withAnimation(IllumeTheme.spring) {
                                self.selectedClassic = nil
                            }
                        }
                    )
                    .padding(.horizontal, 18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .center)))
                }

                if let book = app.activeBook, selectedClassic == nil {
                    LibraryNarrationControls(book: book)
                        .padding(.horizontal, 18)
                        .padding(.bottom, 18)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .zIndex(5)
                }
            }
            .animation(IllumeTheme.spring, value: selectedClassic?.id)
            .animation(IllumeTheme.spring, value: app.activeBookRow?.id)
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

struct LibraryNarrationControls: View {
    @EnvironmentObject private var app: IllumeAppModel
    let book: ReaderBook

    var body: some View {
        GeometryReader { geometry in
            let currentIndex = app.narrationControlIndex(in: book)
            let isCompact = geometry.size.width < 390

            if let activeBookRow = app.activeBookRow {
                HStack(spacing: isCompact ? 12 : 16) {
                    Button {
                        app.openNarrationSpot(in: book)
                    } label: {
                        HStack(spacing: isCompact ? 12 : 14) {
                            CoverView(book: activeBookRow, size: coverSize(isCompact: isCompact))
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .strokeBorder(.white.opacity(0.28), lineWidth: 1)
                                }
                                .shadow(color: .black.opacity(0.24), radius: 10, x: 0, y: 5)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(activeBookRow.title)
                                    .font(.system(size: isCompact ? 23 : 29, weight: .regular, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.96))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.74)

                                Text(authorLine(for: activeBookRow))
                                    .font(.system(size: isCompact ? 18 : 22, weight: .regular, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.68))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.72)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(activeBookRow.title) at current narration")

                    HStack(spacing: isCompact ? 10 : 14) {
                        LibraryNarrationPlayButton(
                            isPlaying: app.narration.isPlaying,
                            isPreparing: app.narration.isPreparing,
                            isCompact: isCompact
                        ) {
                            app.toggleNarration(for: book, from: currentIndex)
                        }

                        LibraryNarrationRewindButton(isCompact: isCompact) {
                            app.moveNarrationControl(to: currentIndex - 1, in: book)
                        }
                        .disabled(currentIndex <= 0)
                        .opacity(currentIndex <= 0 ? 0.42 : 1)
                    }
                }
                .padding(.leading, isCompact ? 12 : 14)
                .padding(.trailing, isCompact ? 13 : 16)
                .padding(.vertical, isCompact ? 10 : 12)
                .frame(width: min(geometry.size.width, 1048), height: isCompact ? 86 : 98)
                .illumeLiquidGlassCapsule(tint: IllumeTheme.paper.opacity(0.88))
                .overlay {
                    Capsule()
                        .strokeBorder(.white.opacity(0.16), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.34), radius: 24, x: 0, y: 12)
                .frame(width: geometry.size.width, height: geometry.size.height, alignment: .center)
            }
        }
        .frame(height: 112)
        .blurLoadIn(radius: 10)
    }

    private func coverSize(isCompact: Bool) -> CGSize {
        isCompact ? CGSize(width: 48, height: 64) : CGSize(width: 62, height: 78)
    }

    private func authorLine(for row: BookRow) -> String {
        if !row.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return row.author
        }
        if !book.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return book.author
        }
        return row.fileName
    }
}

struct LibraryNarrationPlayButton: View {
    let isPlaying: Bool
    let isPreparing: Bool
    let isCompact: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isPreparing {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.regular)
                        .tint(IllumeTheme.paper)
                } else {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: isCompact ? 32 : 39, weight: .black))
                        .symbolRenderingMode(.monochrome)
                        .offset(x: isPlaying ? 0 : 3)
                }
            }
            .foregroundStyle(.white)
            .frame(width: isCompact ? 48 : 58, height: isCompact ? 48 : 58)
            .contentShape(Circle())
        }
        .buttonStyle(LiquidLiftButtonStyle())
        .accessibilityLabel(isPreparing ? "Preparing narration" : (isPlaying ? "Pause narration" : "Play narration"))
    }
}

struct LibraryNarrationRewindButton: View {
    let isCompact: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "gobackward.15")
                .font(.system(size: isCompact ? 34 : 41, weight: .black))
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(.white)
                .frame(width: isCompact ? 46 : 54, height: isCompact ? 46 : 54)
                .contentShape(Circle())
        }
        .buttonStyle(LiquidLiftButtonStyle())
        .accessibilityLabel("Previous paragraph")
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
            Text("library")
                .font(IllumeTypography.logo(28))
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

struct ClassicsSection: View {
    let shelves: [ClassicGenreShelf]
    @Binding var selectedClassic: ClassicBook?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                Text("classics")
                .font(IllumeTypography.logo(28))
                Spacer()
                Text("Standard Ebooks")
                    .font(.caption.weight(.black))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 22) {
                ForEach(Array(shelves.enumerated()), id: \.element.id) { shelfIndex, shelf in
                    ClassicGenreRow(
                        shelf: shelf,
                        selectedClassic: $selectedClassic
                    )
                    .blurLoadIn(delay: min(Double(shelfIndex) * 0.025, 0.16), radius: 8)
                }
            }
            .animation(IllumeTheme.spring, value: selectedClassic?.id)
        }
    }
}

struct ClassicGenreRow: View {
    let shelf: ClassicGenreShelf
    @Binding var selectedClassic: ClassicBook?

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(shelf.title)
                .font(.system(.headline, design: .rounded, weight: .black))
                .foregroundStyle(IllumeTheme.ink)

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 16) {
                    ForEach(Array(shelf.books.enumerated()), id: \.element.id) { index, classic in
                        ClassicBookCard(
                            classic: classic,
                            isSelected: selectedClassic?.id == classic.id,
                            isPanelOpen: selectedClassic != nil,
                            onToggle: {
                                withAnimation(IllumeTheme.spring) {
                                    selectedClassic = selectedClassic?.id == classic.id ? nil : classic
                                }
                            }
                        )
                        .blurLoadIn(delay: min(Double(index) * 0.018, 0.14), radius: 8)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }
}

struct ClassicBookCard: View {
    @EnvironmentObject private var app: IllumeAppModel
    let classic: ClassicBook
    let isSelected: Bool
    let isPanelOpen: Bool
    let onToggle: () -> Void

    private var isImported: Bool {
        app.hasImportedClassic(classic)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onToggle) {
                VStack(alignment: .leading, spacing: 10) {
                    ClassicCover(resourceName: classic.coverResourceName, remoteURL: classic.coverUrl)
                        .opacity(isSelected && isPanelOpen ? 0.58 : 1)
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(IllumeTheme.ink.opacity(isSelected ? 0.32 : 0), lineWidth: 2)
                        }
                        .overlay(alignment: .topTrailing) {
                            if isImported {
                                Image(systemName: "checkmark")
                                    .font(.caption2.weight(.black))
                                    .foregroundStyle(.white)
                                    .frame(width: 24, height: 24)
                                    .background(IllumeTheme.accent, in: Circle())
                                    .padding(7)
                                    .transition(.scale.combined(with: .opacity))
                            }
                        }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(classic.title)
                            .font(.system(.subheadline, design: .rounded, weight: .bold))
                            .foregroundStyle(IllumeTheme.ink)
                            .lineLimit(2)
                        Text(classic.author)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(width: 118, height: 58, alignment: .topLeading)
                }
                .frame(width: 118, height: 238, alignment: .topLeading)
            }
            .buttonStyle(LiquidLiftButtonStyle())
        }
        .frame(width: 118, height: 238, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(classic.title), \(classic.author)")
    }
}

struct ClassicExpandedPanel: View {
    @EnvironmentObject private var app: IllumeAppModel
    let classic: ClassicBook
    let classics: [ClassicBook]
    let selectClassic: (ClassicBook) -> Void
    let close: () -> Void

    private var matchingBook: BookRow? {
        app.bookMatchingClassic(classic)
    }

    private var isImporting: Bool {
        app.importingClassicID == classic.id
    }

    private var isDisabled: Bool {
        isImporting || (matchingBook == nil && app.importingClassicID != nil)
    }

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.black))
                        .foregroundStyle(IllumeTheme.ink)
                        .frame(width: 34, height: 34)
                        .background(IllumeTheme.paper.opacity(0.7), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close \(classic.title) details")
            }

            ClassicCoverPicker(
                classics: classics,
                selectedClassic: classic,
                selectClassic: selectClassic
            )

            VStack(spacing: 7) {
                Text(classic.title)
                    .font(IllumeTypography.librarySerif(28, weight: .bold))
                    .foregroundStyle(IllumeTheme.ink)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.82)
                Text(classic.author)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            VStack(alignment: .leading, spacing: 14) {
                Text("About Book")
                    .font(.system(.headline, design: .rounded, weight: .bold))

                Text(classic.summary)
                    .font(.callout)
                    .foregroundStyle(IllumeTheme.ink.opacity(0.72))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)

                GenreChipRow(genres: classic.genres)

                actionButton
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(IllumeTheme.paper.opacity(0.9), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(IllumeTheme.ink.opacity(0.08), lineWidth: 1)
            )
        }
        .padding(18)
        .frame(maxWidth: 380)
        .background(IllumeTheme.paper.opacity(0.94), in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .strokeBorder(.white.opacity(0.62), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.14), radius: 30, y: 16)
    }

    private var actionButton: some View {
        Button {
            close()
            Task { await app.readClassicNow(classic) }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "book.pages")
                    .font(.subheadline.weight(.black))
                Text("Read Now")
                    .font(.subheadline.weight(.black))
                    .lineLimit(1)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ClassicReadNowButtonStyle())
        .disabled(isDisabled)
        .accessibilityLabel("Read \(classic.title) now")
    }
}

struct ClassicReadNowButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.black.opacity(isEnabled ? 0.9 : 0.48))
            .background(
                IllumeTheme.ink.opacity(isEnabled ? (configuration.isPressed ? 1 : 0.86) : 0.44),
                in: Capsule()
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(IllumeTheme.spring, value: configuration.isPressed)
            .animation(IllumeTheme.spring, value: isEnabled)
    }
}

struct ClassicCoverPicker: View {
    let classics: [ClassicBook]
    let selectedClassic: ClassicBook
    let selectClassic: (ClassicBook) -> Void
    @State private var centeredClassicID: String?

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .center, spacing: 12) {
                ForEach(classics) { classic in
                    Button {
                        withAnimation(IllumeTheme.spring) {
                            selectClassic(classic)
                        }
                    } label: {
                        ClassicCover(
                            resourceName: classic.coverResourceName,
                            remoteURL: classic.coverUrl,
                            isExpanded: classic.id == selectedClassic.id
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: classic.id == selectedClassic.id ? 18 : 14, style: .continuous)
                                .strokeBorder(IllumeTheme.ink.opacity(classic.id == selectedClassic.id ? 0.28 : 0), lineWidth: 2)
                        }
                        .scaleEffect(classic.id == selectedClassic.id ? 1 : 0.82)
                        .opacity(classic.id == selectedClassic.id ? 1 : 0.78)
                        .zIndex(classic.id == selectedClassic.id ? 1 : 0)
                    }
                    .frame(width: 150, height: 216)
                    .buttonStyle(LiquidLiftButtonStyle())
                    .id(classic.id)
                    .accessibilityLabel("\(classic.title), \(classic.author)")
                }
            }
            .padding(.horizontal, 42)
            .padding(.vertical, 12)
            .scrollTargetLayout()
        }
        .frame(height: 236)
        .scrollClipDisabled()
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .scrollPosition(id: $centeredClassicID, anchor: .center)
        .onAppear {
            centeredClassicID = selectedClassic.id
        }
        .onChange(of: selectedClassic.id) { _, id in
            guard centeredClassicID != id else { return }
            withAnimation(IllumeTheme.spring) {
                centeredClassicID = id
            }
        }
        .onChange(of: centeredClassicID) { _, id in
            guard let id,
                  id != selectedClassic.id,
                  let classic = classics.first(where: { $0.id == id }) else { return }
            selectClassic(classic)
        }
    }
}

struct GenreChipRow: View {
    let genres: [String]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(genres, id: \.self) { genre in
                    Text(genre)
                        .font(.caption.weight(.black))
                        .foregroundStyle(IllumeTheme.ink.opacity(0.72))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(IllumeTheme.accent.opacity(0.16), in: Capsule())
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
    }
}

struct ClassicCover: View {
    let resourceName: String
    var remoteURL: URL?
    var isExpanded = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [IllumeTheme.ink, IllumeTheme.coral],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            if let image = UIImage(named: "\(resourceName).jpg", in: .module, compatibleWith: nil) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if let remoteURL {
                CoverArtwork(urlString: remoteURL.absoluteString)
            }
        }
        .frame(width: isExpanded ? 150 : 118, height: isExpanded ? 216 : 170)
        .clipShape(RoundedRectangle(cornerRadius: isExpanded ? 18 : 14, style: .continuous))
        .shadow(color: .black.opacity(isExpanded ? 0.2 : 0.14), radius: isExpanded ? 18 : 12, y: isExpanded ? 12 : 8)
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
    @Environment(\.dismiss) private var dismiss

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
                    dismiss()
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(260))
                        app.proUpgradePrompt = ProUpgradePrompt(
                            used: app.imageUsageCount,
                            limit: app.imageLimit,
                            isPro: app.isPro
                        )
                    }
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

struct ProUpgradeSheet: View {
    @EnvironmentObject private var app: IllumeAppModel
    @Environment(\.dismiss) private var dismiss
    let prompt: ProUpgradePrompt

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                ProSunBackground()

                VStack(spacing: 0) {
                    ProPaywallHeader(dismiss: dismiss)
                        .padding(.horizontal, 12)
                        .padding(.top, 18)

                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 0) {
                            Spacer(minLength: max(44, proxy.size.height * 0.09))

                            VStack(alignment: .leading, spacing: 10) {
                                Text(prompt.isPro ? "Monthly visuals used" : "Read without limits")
                                    .font(IllumeTypography.sans(40, weight: .heavy))
                                    .foregroundStyle(.white)
                                    .lineSpacing(1)
                                    .minimumScaleFactor(0.82)
                                    .lineLimit(2)

                                Text(prompt.isPro ? "You have reached this month's Pro image allowance." : "Keep every book vivid, focused, and easy to stay with.")
                                    .font(IllumeTypography.sans(13, weight: .medium))
                                    .foregroundStyle(.white.opacity(0.66))
                            }
                            .padding(.top, 6)

                            VStack(alignment: .leading, spacing: 14) {
                                ForEach(featureTitles, id: \.self) { title in
                                    ProChecklistRow(title: title)
                                }
                            }
                            .padding(.top, 28)

                            Spacer(minLength: 44)

                            VStack(spacing: 4) {
                                Text(prompt.isPro ? "\(prompt.used) / \(prompt.limit) visuals used" : "Only $14.98 /year")
                                    .font(IllumeTypography.sans(13, weight: .bold))
                                    .foregroundStyle(.white)

                                Text(prompt.isPro ? "Restore purchases or check back next month." : "Cancel anytime.")
                                    .font(IllumeTypography.sans(11, weight: .medium))
                                    .foregroundStyle(.white.opacity(0.58))
                            }
                            .frame(maxWidth: .infinity)

                            primaryAction
                                .padding(.top, 20)

                            Divider()
                                .background(.white.opacity(0.18))
                                .padding(.top, 18)

                            ProPlanOptions()
                                .padding(.top, 18)
                                .padding(.bottom, max(28, proxy.safeAreaInsets.bottom + 12))
                        }
                        .padding(.horizontal, 18)
                        .frame(minHeight: proxy.size.height - 36, alignment: .top)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            app.pauseNarration()
        }
    }

    private var featureTitles: [String] {
        if prompt.isPro {
            [
                "Restore your active subscription",
                "Keep every premium reader feature",
                "Cloud sync and visual history",
                "Natural narration and word tracking",
                "Family sharing support"
            ]
        } else {
            [
                "Unlimited AI illustrations",
                "Natural narration",
                "Live word tracking",
                "EPUB and PDF support",
                "Cloud library sync",
                "More storage for your books",
                "Priority reading tools",
                "Family sharing included"
            ]
        }
    }

    @ViewBuilder
    private var primaryAction: some View {
        if prompt.isPro {
            Button {
                Task {
                    await app.restorePro()
                    dismiss()
                }
            } label: {
                ProPrimaryButtonLabel(title: "Restore purchases", systemName: "arrow.clockwise")
            }
            .buttonStyle(LiquidLiftButtonStyle())
        } else {
            Button {
                Task {
                    await app.purchasePro()
                    if app.isPro {
                        dismiss()
                    }
                }
            } label: {
                ProPrimaryButtonLabel(title: "Continue", systemName: "arrow.right")
            }
            .buttonStyle(LiquidLiftButtonStyle())
        }
    }
}

private struct ProPaywallHeader: View {
    let dismiss: DismissAction

    var body: some View {
        HStack(spacing: 8) {
            Text("illume")
                .font(IllumeTypography.logo(28, weight: .bold))
                .foregroundStyle(.white)

            Text("PRO")
                .font(.system(size: 9, weight: .black, design: .rounded))
                .foregroundStyle(Color(red: 0.24, green: 0.25, blue: 0.46))
                .padding(.horizontal, 7)
                .frame(height: 16)
                .background(.white, in: Capsule())

            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(.white.opacity(0.16), in: Circle())
                    .overlay {
                        Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
                    }
                    .contentShape(Circle())
            }
            .buttonStyle(LiquidLiftButtonStyle())
            .accessibilityLabel("Close")
        }
    }
}

private struct ProSunBackground: View {
    var body: some View {
        ZStack(alignment: .topTrailing) {
            LinearGradient(
                colors: [
                    Color(red: 0.26, green: 0.18, blue: 0.22),
                    IllumeTheme.paper,
                    Color(red: 0.03, green: 0.03, blue: 0.05)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            OnboardingLogoShine(sunSize: 204, beamLength: 470, showsSparkles: false)
                .frame(width: 348, height: 310)
                .offset(x: 112, y: -92)

            RadialGradient(
                colors: [
                    IllumeTheme.coral.opacity(0.24),
                    Color(red: 1.0, green: 0.68, blue: 0.24).opacity(0.1),
                    .clear
                ],
                center: .topTrailing,
                startRadius: 28,
                endRadius: 380
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [.clear, Color(red: 0.03, green: 0.03, blue: 0.05).opacity(0.9)],
                startPoint: .center,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }
}

private struct ProChecklistRow: View {
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(.white.opacity(0.16), in: Circle())

            Text(title)
                .font(IllumeTypography.sans(15, weight: .medium))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.82)
        }
    }
}

private struct ProPrimaryButtonLabel: View {
    let title: String
    let systemName: String

    var body: some View {
        HStack {
            Spacer()

            Text(title)
                .font(IllumeTypography.sans(15, weight: .semibold))
                .foregroundStyle(Color(red: 0.03, green: 0.04, blue: 0.1))

            Spacer()

            Image(systemName: systemName)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(red: 0.03, green: 0.04, blue: 0.1))
                .frame(width: 20)
        }
        .frame(height: 48)
        .padding(.horizontal, 20)
        .background(.white, in: Capsule())
    }
}

private struct ProPlanOptions: View {
    var body: some View {
        VStack(spacing: 10) {
            ProPlanCard(
                title: "Monthly Illume+",
                price: "$5.98/month",
                detail: "Unlock premium features with a flexible monthly plan.",
                badge: "Your Plan",
                isSelected: false
            )

            ProPlanCard(
                title: "Change Plan to Annual Illume+",
                price: "$39.98/year",
                detail: "Unlock Illume+ features and save with an annual plan.",
                badge: nil,
                isSelected: true
            )
        }
    }
}

private struct ProPlanCard: View {
    let title: String
    let price: String
    let detail: String
    let badge: String?
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(IllumeTypography.sans(17, weight: .heavy))
                        .foregroundStyle(.black)
                        .lineLimit(2)
                        .minimumScaleFactor(0.86)

                    Text(price)
                        .font(IllumeTypography.sans(12, weight: .medium))
                        .foregroundStyle(.black.opacity(0.82))
                }

                Spacer(minLength: 8)

                planIndicator
            }

            if let badge {
                HStack(spacing: 5) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 9, weight: .bold))
                    Text(badge)
                        .font(IllumeTypography.sans(10, weight: .bold))
                }
                .foregroundStyle(Color(red: 0.12, green: 0.13, blue: 0.2))
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(Color.black.opacity(0.06), in: Capsule())
            }

            Spacer(minLength: 0)

            Text(detail)
                .font(IllumeTypography.sans(11, weight: .medium))
                .foregroundStyle(.black.opacity(0.78))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        .background(Color(red: 0.93, green: 0.93, blue: 0.92), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(isSelected ? Color(red: 0.12, green: 0.13, blue: 0.2) : Color.black.opacity(0.12), lineWidth: isSelected ? 1.4 : 1)
        }
    }

    @ViewBuilder
    private var planIndicator: some View {
        if isSelected {
            Image(systemName: "checkmark")
                .font(.system(size: 9, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 19, height: 19)
                .background(Color(red: 0.12, green: 0.13, blue: 0.2), in: Circle())
        } else {
            Circle()
                .strokeBorder(Color.black.opacity(0.26), lineWidth: 1.4)
                .frame(width: 19, height: 19)
        }
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
                    .opacity(phase == .opening ? 1 : 0)

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
