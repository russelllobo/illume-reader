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
    var tint: Color = IllumeTheme.ink
    var foreground: Color = .white

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.headline, design: .rounded, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 18)
            .frame(height: 52)
            .frame(maxWidth: .infinity)
            .background(tint, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(IllumeTheme.spring, value: configuration.isPressed)
    }
}

struct SoftIconButton: View {
    let systemName: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(IllumeTheme.ink)
                .frame(width: 44, height: 44)
                .background(.white.opacity(0.72), in: Circle())
                .overlay(Circle().stroke(.black.opacity(0.06)))
        }
        .buttonStyle(.plain)
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
}
#endif
