#if os(iOS)
import CoreText
import SwiftUI

enum IllumeTheme {
    static let ink = Color(red: 0.08, green: 0.075, blue: 0.065)
    static let paper = Color(red: 0.985, green: 0.975, blue: 0.945)
    static let mist = Color(red: 0.95, green: 0.91, blue: 0.82)
    static let accent = Color(red: 0.62, green: 0.20, blue: 0.09)
    static let coral = Color(red: 1.0, green: 0.38, blue: 0.28)
    static let plum = Color(red: 0.34, green: 0.22, blue: 0.46)
    static let spring = Animation.spring(response: 0.34, dampingFraction: 0.78)
    static let blurLoadIn = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.18)
}

enum IllumeTypography {
    static func logo(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
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

    private static let registeredFonts: Void = {
        [
            "AveriaSerifLibre-Regular",
            "AveriaSerifLibre-Bold",
            "CrimsonText-Regular",
            "CrimsonText-SemiBold",
            "CrimsonText-Italic",
            "Outfit-Regular"
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
    var foreground: Color = .white

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
                isInteractive: true
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(IllumeTheme.spring, value: configuration.isPressed)
            .animation(IllumeTheme.spring, value: isEnabled)
    }
}

struct SoftIconButton: View {
    let systemName: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            icon
        }
        .buttonStyle(LiquidIconButtonStyle())
    }

    private var icon: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(IllumeTheme.ink)
            .frame(width: 44, height: 44)
    }
}

struct LiquidIconButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .illumeLiquidGlassCircle(
                tint: IllumeTheme.paper,
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
                isInteractive: true
            )
            .animation(IllumeTheme.spring, value: configuration.isPressed)
    }
}

private struct IllumeLiquidGlassCapsuleModifier: ViewModifier {
    let tint: Color
    let isPressed: Bool
    let isEnabled: Bool
    let isInteractive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(tint).interactive(isInteractive && isEnabled), in: Capsule())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(isPressed ? 0.965 : 1)
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(isPressed ? 0.965 : 1)
        }
    }
}

private struct IllumeLiquidGlassCircleModifier: ViewModifier {
    let tint: Color
    let isPressed: Bool
    let isEnabled: Bool
    let isInteractive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(tint).interactive(isInteractive && isEnabled), in: Circle())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(isPressed ? 0.92 : 1)
        } else {
            content
                .background(.ultraThinMaterial, in: Circle())
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(isPressed ? 0.92 : 1)
        }
    }
}

private struct IllumeLiquidGlassRoundedModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color
    let isPressed: Bool
    let isEnabled: Bool
    let isInteractive: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.tint(tint).interactive(isInteractive && isEnabled), in: shape)
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(isPressed ? 0.985 : 1)
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .opacity(isEnabled ? 1 : 0.5)
                .scaleEffect(isPressed ? 0.985 : 1)
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
    func blurLoadIn(delay: Double = 0, radius: CGFloat = 9) -> some View {
        modifier(BlurLoadInModifier(delay: delay, blurRadius: radius))
    }

    func illumeLiquidGlassCapsule(
        tint: Color = IllumeTheme.paper,
        isPressed: Bool = false,
        isEnabled: Bool = true,
        isInteractive: Bool = false
    ) -> some View {
        modifier(
            IllumeLiquidGlassCapsuleModifier(
                tint: tint,
                isPressed: isPressed,
                isEnabled: isEnabled,
                isInteractive: isInteractive
            )
        )
    }

    func illumeLiquidGlassCircle(
        tint: Color = IllumeTheme.paper,
        isPressed: Bool = false,
        isEnabled: Bool = true,
        isInteractive: Bool = false
    ) -> some View {
        modifier(
            IllumeLiquidGlassCircleModifier(
                tint: tint,
                isPressed: isPressed,
                isEnabled: isEnabled,
                isInteractive: isInteractive
            )
        )
    }

    func illumeLiquidGlassRounded(
        cornerRadius: CGFloat = 22,
        tint: Color = IllumeTheme.paper,
        isPressed: Bool = false,
        isEnabled: Bool = true,
        isInteractive: Bool = false
    ) -> some View {
        modifier(
            IllumeLiquidGlassRoundedModifier(
                cornerRadius: cornerRadius,
                tint: tint,
                isPressed: isPressed,
                isEnabled: isEnabled,
                isInteractive: isInteractive
            )
        )
    }
}
#endif
