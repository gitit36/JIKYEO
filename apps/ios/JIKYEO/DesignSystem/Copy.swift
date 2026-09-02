import Foundation

/// Centralized Korean UX copy.
///
/// Every user-facing string lives here so tone stays consistent and
/// screens don't drift into aggressive or legal-sounding phrasing.
public enum Copy {
    // Onboarding
    public static let onboardingHeadline    = "나와 한 약속, 이번엔 진짜 지켜봐요."
    public static let onboardingSubhead     = "못 지키면 실제 약속금이 걸려 있어요."
    public static let onboardingCTA         = "시작하기"

    // Home
    public static let homeGreeting          = "오늘도 지켜봐요"
    public static let homeAtRiskPrefix      = "오늘 걸린 약속금"
    public static let homeNoCommitments     = "오늘 지킬 약속이 없어요."
    public static let homeCreateCTA         = "새 약속 만들기"

    // Create — wizard
    public static let wizardGoalQ           = "무엇을 꼭 하게 만들고 싶나요?"
    public static let wizardScheduleQ       = "언제 / 얼마나 자주 할까요?"
    public static let wizardVerifyQ         = "어떻게 증명할까요?"
    public static let wizardStakeQ          = "못 지키면 얼마를 걸까요?"
    public static let wizardObserverQ       = "누가 이 약속을 지켜볼까요?"
    public static let wizardReviewTitle     = "이대로 약속할게요"
    public static let wizardPaymentCTA      = "결제하고 시작하기"
    public static let wizardSignHeadline    = "마지막으로, 직접 약속해요."
    public static let wizardStartedHeadline = "약속이 시작됐어요"

    // Proof
    public static let proofPhotoHint        = "했다는 걸 보여주세요."
    public static let proofGpsHint          = "지정한 장소에 도착했나요?"
    public static let proofTimerHint        = "집중 타이머로 채워요."
    public static let proofSelfHint         = "직접 확인해주세요."

    // Result
    public static let resultPassTitle       = "약속을 지켰어요."
    public static let resultUncertainTitle  = "한 번 더 확인이 필요해요."
    public static let resultFailTitle       = "약속을 놓쳤어요."
    public static let resultAppealCTA       = "판정이 이상한가요? 다시 확인해드릴게요."

    // Never-miss-twice
    public static let nextTimeEncouragement = "한 번 놓친 건 괜찮아요. 다음 약속만 이어가요."
}
