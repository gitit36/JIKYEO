import SwiftUI

/// Typography scale for JIKYEO. Uses system font with rounded design for
/// numbers to make money amounts feel confident and readable.
public enum Typo {
    /// Big headline used for "이번엔 진짜 지키고 싶은 약속이 있나요?"
    public static let display     = Font.largeTitle.weight(.bold)
    /// Page-level title.
    public static let title       = Font.title2.weight(.bold)
    /// Section headers, wizard question titles.
    public static let heading     = Font.title3.weight(.semibold)
    /// Body copy.
    public static let body        = Font.body
    public static let bodyStrong  = Font.body.weight(.semibold)
    /// Secondary copy / captions.
    public static let caption     = Font.caption
    /// Button label.
    public static let button      = Font.body.weight(.semibold)
    /// Money — large, rounded, so amounts stay readable at larger Dynamic Type.
    public static let moneyHero   = Font.largeTitle.weight(.bold)
    public static let moneyLarge  = Font.title.weight(.bold)
    public static let moneyBody   = Font.body.weight(.semibold)
    public static let moneySmall  = Font.caption.weight(.semibold)
}
