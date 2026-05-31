#if os(iOS)
import CoreText
import SwiftUI

enum IllumeTheme {
    static let ink = Color(red: 0.93, green: 0.90, blue: 0.84)
    static let paper = Color(red: 0.055, green: 0.052, blue: 0.047)
    static let mist = Color(red: 0.14, green: 0.13, blue: 0.115)
    static let accent = Color(red: 0.98, green: 0.48, blue: 0.34)
    static let coral = Color(red: 1.0, green: 0.38, blue: 0.28)
    static let plum = Color(red: 0.34, green: 0.22, blue: 0.46)
    static let spring = Animation.spring(response: 0.24, dampingFraction: 0.74)
    static let buttonPress = Animation.spring(response: 0.16, dampingFraction: 0.7)
    static let buttonRelease = Animation.interpolatingSpring(stiffness: 520, damping: 20)
    static let blurLoadIn = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.18)
    static let minimumTouchTarget: CGFloat = 48

    static func liquidGlassTint(_ color: Color, prominent: Bool = false) -> Color {
        color.opacity(prominent ? 0.62 : 0.42)
    }
}

enum IllumeTypography {
    static func logo(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        _ = registeredFonts
        return .custom("Averia Serif Libre", size: size).weight(weight)
    }

    static func heading(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        _ = registeredFonts
        return .custom("Crimson Text", size: size).weight(weight)
    }

    static func sans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        _ = registeredFonts
        return .custom("Outfit", size: size).weight(weight)
    }

    static func librarySerif(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    private static let registeredFonts: Void = {
        [
            "AveriaSerifLibre-Regular",
            "AveriaSerifLibre-Bold"
        ].forEach { fileName in
            guard let url = Bundle.module.url(forResource: fileName, withExtension: "ttf") else {
                return
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()
}

struct PillButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var tint: Color = IllumeTheme.ink
    var foreground: Color = IllumeTheme.paper

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.headline, design: .rounded, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 18)
            .frame(height: 52)
            .frame(maxWidth: .infinity)
            .illumeLiquidGlassCapsule(
                tint: tint,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true,
                pressedScale: 0.955
            )
            .animation(IllumeTheme.spring, value: configuration.isPressed)
            .animation(IllumeTheme.spring, value: isEnabled)
    }
}

struct SoftIconButton: View {
    let systemName: String
    var tint: Color = IllumeTheme.paper
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            icon
        }
        .illumeNativeGlassButton(tint: tint, borderShape: .circle, controlSize: .small, fallback: LiquidIconButtonStyle(tint: tint))
    }

    private var icon: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(IllumeTheme.ink)
            .frame(width: 44, height: 44)
    }
}

struct IllumeGlassEffectGroup<Content: View>: View {
    var spacing: CGFloat?
    @ViewBuilder let content: () -> Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content()
            }
        } else {
            content()
        }
    }
}

struct LiquidIconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var tint: Color = IllumeTheme.paper

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .illumeLiquidGlassCircle(
                tint: tint,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true
            )
            .animation(IllumeTheme.spring, value: configuration.isPressed)
    }
}

struct LiquidCardButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var cornerRadius: CGFloat = 22
    var tint: Color = IllumeTheme.paper

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .illumeLiquidGlassRounded(
                cornerRadius: cornerRadius,
                tint: tint,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true
            )
            .animation(IllumeTheme.spring, value: configuration.isPressed)
    }
}

struct LiquidLiftButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .animation(IllumeTheme.spring, value: configuration.isPressed)
    }
}

struct MiniGlassButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.caption, design: .rounded, weight: .bold))
            .foregroundStyle(IllumeTheme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .illumeLiquidGlassCapsule(
                tint: IllumeTheme.paper,
                isPressed: configuration.isPressed,
                isEnabled: isEnabled,
                isInteractive: true,
                pressedScale: 0.94
            )
            .animation(IllumeTheme.spring, value: configuration.isPressed)
    }
}

private struct IllumeLiquidGlassCapsuleModifier: ViewModifier {
    let tint: Color
    let isPressed: Bool
    let isEnabled: Bool
    let isInteractive: Bool
    let pressedScale: CGFloat
    @State private var releaseBounce = false

    private var currentScale: CGFloat {
        if isPressed {
            return pressedScale
        }
        return releaseBounce ? 1.045 : 1
    }

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .frame(minHeight: IllumeTheme.minimumTouchTarget)
                .glassEffect(.regular.tint(IllumeTheme.liquidGlassTint(tint)).interactive(isInteractive && isEnabled), in: Capsule())
                .contentShape(Capsule())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(currentScale)
                .brightness(isPressed ? 0.06 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: currentScale)
                .onChange(of: isPressed) { _, newValue in
                    triggerReleaseBounce(when: newValue)
                }
        } else {
            content
                .frame(minHeight: IllumeTheme.minimumTouchTarget)
                .background(.ultraThinMaterial, in: Capsule())
                .contentShape(Capsule())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(currentScale)
                .brightness(isPressed ? 0.06 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: currentScale)
                .onChange(of: isPressed) { _, newValue in
                    triggerReleaseBounce(when: newValue)
                }
        }
    }

    private func triggerReleaseBounce(when isPressed: Bool) {
        guard !isPressed, isEnabled else { return }
        releaseBounce = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(90))
            releaseBounce = false
        }
    }
}

private struct IllumeLiquidGlassCircleModifier: ViewModifier {
    let tint: Color
    let isPressed: Bool
    let isEnabled: Bool
    let isInteractive: Bool
    let pressedScale: CGFloat
    @State private var releaseBounce = false

    private var currentScale: CGFloat {
        if isPressed {
            return pressedScale
        }
        return releaseBounce ? 1.075 : 1
    }

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .frame(minWidth: IllumeTheme.minimumTouchTarget, minHeight: IllumeTheme.minimumTouchTarget)
                .glassEffect(.regular.tint(IllumeTheme.liquidGlassTint(tint)).interactive(isInteractive && isEnabled), in: Circle())
                .contentShape(Circle())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(currentScale)
                .brightness(isPressed ? 0.08 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: currentScale)
                .onChange(of: isPressed) { _, newValue in
                    triggerReleaseBounce(when: newValue)
                }
        } else {
            content
                .frame(minWidth: IllumeTheme.minimumTouchTarget, minHeight: IllumeTheme.minimumTouchTarget)
                .background(.ultraThinMaterial, in: Circle())
                .contentShape(Circle())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(currentScale)
                .brightness(isPressed ? 0.08 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: currentScale)
                .onChange(of: isPressed) { _, newValue in
                    triggerReleaseBounce(when: newValue)
                }
        }
    }

    private func triggerReleaseBounce(when isPressed: Bool) {
        guard !isPressed, isEnabled else { return }
        releaseBounce = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(90))
            releaseBounce = false
        }
    }
}

private struct IllumeLiquidGlassRoundedModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color
    let isPressed: Bool
    let isEnabled: Bool
    let isInteractive: Bool
    let pressedScale: CGFloat
    @State private var releaseBounce = false

    private var currentScale: CGFloat {
        if isPressed {
            return pressedScale
        }
        return releaseBounce ? 1.025 : 1
    }

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        if #available(iOS 26.0, *) {
            content
                .frame(minHeight: IllumeTheme.minimumTouchTarget)
                .glassEffect(.regular.tint(IllumeTheme.liquidGlassTint(tint)).interactive(isInteractive && isEnabled), in: shape)
                .contentShape(shape)
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(currentScale)
                .brightness(isPressed ? 0.05 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: currentScale)
                .onChange(of: isPressed) { _, newValue in
                    triggerReleaseBounce(when: newValue)
                }
        } else {
            content
                .frame(minHeight: IllumeTheme.minimumTouchTarget)
                .background(.ultraThinMaterial, in: shape)
                .contentShape(shape)
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(currentScale)
                .brightness(isPressed ? 0.05 : 0)
                .animation(isPressed ? IllumeTheme.buttonPress : IllumeTheme.buttonRelease, value: currentScale)
                .onChange(of: isPressed) { _, newValue in
                    triggerReleaseBounce(when: newValue)
                }
        }
    }

    private func triggerReleaseBounce(when isPressed: Bool) {
        guard !isPressed, isEnabled else { return }
        releaseBounce = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(90))
            releaseBounce = false
        }
    }
}

struct BlurLoadInModifier: ViewModifier {
    var delay: Double = 0
    var blurRadius: CGFloat = 9
    @State private var isVisible = false

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .blur(radius: isVisible ? 0 : blurRadius)
            .scaleEffect(isVisible ? 1 : 0.985)
            .onAppear {
                withAnimation(IllumeTheme.blurLoadIn.delay(delay)) {
                    isVisible = true
                }
            }
    }
}

extension View {
    @ViewBuilder
    func illumeNativeGlassButton<S: ButtonStyle>(
        tint: Color = IllumeTheme.paper,
        borderShape: ButtonBorderShape = .capsule,
        controlSize: ControlSize = .regular,
        isProminent: Bool = false,
        fallback: S
    ) -> some View {
        if #available(iOS 26.0, *) {
            if isProminent {
                self
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(borderShape)
                    .controlSize(controlSize)
                    .tint(tint)
            } else {
                self
                    .buttonStyle(.glass)
                    .buttonBorderShape(borderShape)
                    .controlSize(controlSize)
                    .tint(tint)
            }
        } else {
            self.buttonStyle(fallback)
        }
    }

    func blurLoadIn(delay: Double = 0, radius: CGFloat = 9) -> some View {
        modifier(BlurLoadInModifier(delay: delay, blurRadius: radius))
    }

    func illumeLiquidGlassCapsule(
        tint: Color = IllumeTheme.paper,
        isPressed: Bool = false,
        isEnabled: Bool = true,
        isInteractive: Bool = false,
        pressedScale: CGFloat = 0.965
    ) -> some View {
        modifier(
            IllumeLiquidGlassCapsuleModifier(
                tint: tint,
                isPressed: isPressed,
                isEnabled: isEnabled,
                isInteractive: isInteractive,
                pressedScale: pressedScale
            )
        )
    }

    func illumeLiquidGlassCircle(
        tint: Color = IllumeTheme.paper,
        isPressed: Bool = false,
        isEnabled: Bool = true,
        isInteractive: Bool = false,
        pressedScale: CGFloat = 0.9
    ) -> some View {
        modifier(
            IllumeLiquidGlassCircleModifier(
                tint: tint,
                isPressed: isPressed,
                isEnabled: isEnabled,
                isInteractive: isInteractive,
                pressedScale: pressedScale
            )
        )
    }

    func illumeLiquidGlassRounded(
        cornerRadius: CGFloat = 22,
        tint: Color = IllumeTheme.paper,
        isPressed: Bool = false,
        isEnabled: Bool = true,
        isInteractive: Bool = false,
        pressedScale: CGFloat = 0.975
    ) -> some View {
        modifier(
            IllumeLiquidGlassRoundedModifier(
                cornerRadius: cornerRadius,
                tint: tint,
                isPressed: isPressed,
                isEnabled: isEnabled,
                isInteractive: isInteractive,
                pressedScale: pressedScale
            )
        )
    }
}
#endif
