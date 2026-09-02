import Foundation

/// Data-driven template. The wizard renders steps based on `requiredInputs`.
/// Adding a new template does not require touching the wizard — only adding
/// new `InputKey` values (rare).
public struct CommitmentTemplate: Identifiable, Hashable {
    public enum InputKey: String, Hashable {
        case daysOfWeek
        case timesPerWeek
        case windowStartLocalTime
        case proofDeadlineLocalTime
        case gpsTarget
        case gpsRadiusM
        case timerRequiredSeconds
    }

    public let id: String
    public let title: String
    public let pitch: String
    public let symbol: String
    public let category: CommitmentCategory
    public let supportedScheduleTypes: [ScheduleType]
    public let defaultScheduleType: ScheduleType
    public let recommendedVerification: [VerificationMethod]
    public let defaultVerification: VerificationMethod
    public let defaultProofExplanationTemplate: String
    public let suggestedStakeKrw: [Int]
    public let defaultStakeKrw: Int
    public let requiredInputs: [InputKey]
    public let defaultWindowStartLocalTime: String
    public let defaultDeadlineLocalTime: String
    public let defaultDays: [Weekday]
    public let defaultTimerMinutes: Int
    public let defaultGpsRadiusM: Int
}

public enum CommitmentTemplates {
    public static let all: [CommitmentTemplate] = [
        CommitmentTemplate(
            id: "wakeup", title: "일찍 일어나기",
            pitch: "정한 시간까지 일어나서 사진으로 증명해요.",
            symbol: "sunrise.fill",
            category: .wakeup,
            supportedScheduleTypes: [.daily, .specific_days],
            defaultScheduleType: .daily,
            recommendedVerification: [.photo, .self],
            defaultVerification: .photo,
            defaultProofExplanationTemplate: "오전 {windowStart}에 일어나서\n{deadline}까지 사진을 찍어요.",
            suggestedStakeKrw: [3_000, 5_000, 10_000],
            defaultStakeKrw: 3_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime, .daysOfWeek],
            defaultWindowStartLocalTime: "07:00",
            defaultDeadlineLocalTime: "07:30",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 0,
            defaultGpsRadiusM: 0
        ),
        CommitmentTemplate(
            id: "workout", title: "운동하기",
            pitch: "지정한 헬스장에 다녀와서 GPS로 증명해요.",
            symbol: "figure.strengthtraining.traditional",
            category: .workout,
            supportedScheduleTypes: [.specific_days, .x_per_week],
            defaultScheduleType: .specific_days,
            recommendedVerification: [.gps, .photo],
            defaultVerification: .gps,
            defaultProofExplanationTemplate: "{deadline}까지 지정한 장소 {radius}m 안에 들어오면 돼요.",
            suggestedStakeKrw: [5_000, 10_000, 20_000],
            defaultStakeKrw: 5_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime, .daysOfWeek, .gpsTarget, .gpsRadiusM],
            defaultWindowStartLocalTime: "18:00",
            defaultDeadlineLocalTime: "21:00",
            defaultDays: [.MON, .WED, .FRI],
            defaultTimerMinutes: 0,
            defaultGpsRadiusM: 150
        ),
        CommitmentTemplate(
            id: "study", title: "공부하기",
            pitch: "집중 타이머로 목표 시간을 채워요.",
            symbol: "book.closed.fill",
            category: .study,
            supportedScheduleTypes: [.daily, .specific_days, .x_per_week],
            defaultScheduleType: .daily,
            recommendedVerification: [.timer, .photo],
            defaultVerification: .timer,
            defaultProofExplanationTemplate: "{deadline}까지 앱 타이머로 {minutes}분을 채워요.",
            suggestedStakeKrw: [3_000, 5_000, 10_000],
            defaultStakeKrw: 3_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime, .timerRequiredSeconds],
            defaultWindowStartLocalTime: "20:00",
            defaultDeadlineLocalTime: "23:59",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 60,
            defaultGpsRadiusM: 0
        ),
        CommitmentTemplate(
            id: "read", title: "책 읽기",
            pitch: "읽은 페이지 사진으로 증명해요.",
            symbol: "text.book.closed.fill",
            category: .read,
            supportedScheduleTypes: [.daily, .specific_days],
            defaultScheduleType: .daily,
            recommendedVerification: [.photo, .timer],
            defaultVerification: .photo,
            defaultProofExplanationTemplate: "{deadline}까지 읽은 페이지 사진을 찍어요.",
            suggestedStakeKrw: [3_000, 5_000],
            defaultStakeKrw: 3_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime],
            defaultWindowStartLocalTime: "21:00",
            defaultDeadlineLocalTime: "23:30",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 0,
            defaultGpsRadiusM: 0
        ),
        CommitmentTemplate(
            id: "meditate", title: "명상하기",
            pitch: "집중 타이머로 정한 시간만큼 명상해요.",
            symbol: "leaf.fill",
            category: .meditate,
            supportedScheduleTypes: [.daily, .specific_days],
            defaultScheduleType: .daily,
            recommendedVerification: [.timer],
            defaultVerification: .timer,
            defaultProofExplanationTemplate: "{deadline}까지 앱 타이머로 {minutes}분을 채워요.",
            suggestedStakeKrw: [3_000, 5_000],
            defaultStakeKrw: 3_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime, .timerRequiredSeconds],
            defaultWindowStartLocalTime: "07:00",
            defaultDeadlineLocalTime: "22:00",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 20,
            defaultGpsRadiusM: 0
        ),
        CommitmentTemplate(
            id: "screen", title: "SNS 덜 보기",
            pitch: "하루 사용시간을 직접 확인해요.",
            symbol: "iphone",
            category: .screen,
            supportedScheduleTypes: [.daily],
            defaultScheduleType: .daily,
            recommendedVerification: [.self, .photo],
            defaultVerification: .self,
            defaultProofExplanationTemplate: "{deadline}까지 오늘 사용시간을 직접 확인해요.",
            suggestedStakeKrw: [3_000, 5_000],
            defaultStakeKrw: 3_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime],
            defaultWindowStartLocalTime: "22:00",
            defaultDeadlineLocalTime: "23:59",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 0,
            defaultGpsRadiusM: 0
        ),
        CommitmentTemplate(
            id: "no-delivery", title: "배달음식 줄이기",
            pitch: "오늘 배달음식을 시키지 않았는지 확인해요.",
            symbol: "takeoutbag.and.cup.and.straw.fill",
            category: .custom,
            supportedScheduleTypes: [.daily, .specific_days],
            defaultScheduleType: .daily,
            recommendedVerification: [.self, .friend],
            defaultVerification: .self,
            defaultProofExplanationTemplate: "{deadline}까지 오늘 배달음식을 시키지 않았는지 확인해요.",
            suggestedStakeKrw: [5_000, 10_000],
            defaultStakeKrw: 5_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime],
            defaultWindowStartLocalTime: "12:00",
            defaultDeadlineLocalTime: "23:59",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 0,
            defaultGpsRadiusM: 0
        ),
        CommitmentTemplate(
            id: "custom", title: "직접 만들기",
            pitch: "내가 원하는 약속을 자유롭게 만들어요.",
            symbol: "square.and.pencil",
            category: .custom,
            supportedScheduleTypes: [.one_time, .daily, .specific_days, .x_per_week],
            defaultScheduleType: .daily,
            recommendedVerification: [.photo, .gps, .timer, .self],
            defaultVerification: .photo,
            defaultProofExplanationTemplate: "{deadline}까지 약속을 지키고 증명해요.",
            suggestedStakeKrw: [3_000, 5_000, 10_000, 20_000],
            defaultStakeKrw: 5_000,
            requiredInputs: [.windowStartLocalTime, .proofDeadlineLocalTime],
            defaultWindowStartLocalTime: "09:00",
            defaultDeadlineLocalTime: "21:00",
            defaultDays: Weekday.allCases,
            defaultTimerMinutes: 0,
            defaultGpsRadiusM: 0
        ),
    ]
}
