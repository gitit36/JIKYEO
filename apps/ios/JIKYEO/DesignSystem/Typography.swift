import SwiftUI

/// Typography scale for JIKYEO. Uses system font with rounded design for
/// numbers to make money amounts feel confident and readable.
public enum Typo {
    /// Big headline used for "이번엔 진짜 지키고 싶은 약속이 있나요?"
    public static let display     = Font.system(size: 30, weight: .bold, design: .default)
    /// Page-level title.
    public static let title       = Font.system(size: 24, weight: .bold, design: .default)
    /// Section headers, wizard question titles.
    public static let heading     = Font.system(size: 20, weight: .semibold, design: .default)
    /// Body copy.
    public static let body        = Font.system(size: 16, weight: .regular, design: .default)
    public static let bodyStrong  = Font.system(size: 16, weight: .semibold, design: .default)
    /// Secondary copy / captions.
    public static let caption     = Font.system(size: 13, weight: .regular, design: .default)
    /// Button label.
    public static let button      = Font.system(size: 17, weight: .semibold, design: .default)
    /// Money — large, rounded, mono-ish for that fintech feel.
    public static let moneyHero   = Font.system(size: 40, weight: .bold, design: .rounded)
    public static let moneyLarge  = Font.system(size: 28, weight: .bold, design: .rounded)
    public static let moneyBody   = Font.system(size: 17, weight: .semibold, design: .rounded)
    public static let moneySmall  = Font.system(size: 14, weight: .semibold, design: .rounded)
}
