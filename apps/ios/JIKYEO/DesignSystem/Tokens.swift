import SwiftUI

/// Core design tokens for 지켜 / JIKYEO.
///
/// Rules:
/// - Never use raw hex or magic numbers in screens. Always route through `DS.*`.
/// - Semantic names, not screen-specific names.
/// - Toss-inspired but not a Toss copy — palette and shapes are ours.
public enum DS {
    // MARK: - Colors (semantic)
    public enum Color {
        /// Primary brand — deep green. Communicates "protection / kept".
        public static let primary       = SwiftUI.Color(hex: 0x0E8F5C)
        public static let primaryPressed = SwiftUI.Color(hex: 0x0B7B4E)
        public static let primaryDim    = SwiftUI.Color(hex: 0xD6F1E2)

        /// Money — the same green, used only when displaying protected money.
        public static let moneyPositive = SwiftUI.Color(hex: 0x0E8F5C)
        /// Money that was lost. Muted red — never harsh.
        public static let moneyLost     = SwiftUI.Color(hex: 0xB6402F)
        /// Money currently at risk — attention orange.
        public static let moneyAtRisk   = SwiftUI.Color(hex: 0xC46A11)

        public static let text          = SwiftUI.Color(hex: 0x111111)
        public static let textSecondary = SwiftUI.Color(hex: 0x5A5F66)
        public static let textMuted     = SwiftUI.Color(hex: 0x9095A0)

        public static let surface       = SwiftUI.Color(hex: 0xFFFFFF)
        public static let surfaceMuted  = SwiftUI.Color(hex: 0xF6F7F9)
        public static let surfaceBackground = SwiftUI.Color(hex: 0xFAFAFB)
        public static let divider       = SwiftUI.Color(hex: 0xE7E9EC)

        public static let statusPass       = primary
        public static let statusUncertain  = SwiftUI.Color(hex: 0xC46A11)
        public static let statusFail       = moneyLost
        public static let statusScheduled  = SwiftUI.Color(hex: 0x546675)
        public static let statusReviewing  = SwiftUI.Color(hex: 0x5A5F66)
    }

    // MARK: - Spacing (4-pt scale)
    public enum Space {
        public static let xxs: CGFloat = 4
        public static let xs:  CGFloat = 8
        public static let sm:  CGFloat = 12
        public static let md:  CGFloat = 16
        public static let lg:  CGFloat = 24
        public static let xl:  CGFloat = 32
        public static let xxl: CGFloat = 48
    }

    // MARK: - Radius
    public enum Radius {
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let pill: CGFloat = 999
    }

    // MARK: - Shadow
    public struct Shadow {
        public let color: SwiftUI.Color
        public let radius: CGFloat
        public let x: CGFloat
        public let y: CGFloat
    }
    public static let cardShadow = Shadow(
        color: SwiftUI.Color.black.opacity(0.04),
        radius: 12, x: 0, y: 2
    )
}

extension SwiftUI.Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self = SwiftUI.Color(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}
