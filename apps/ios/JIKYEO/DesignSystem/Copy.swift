import Foundation

/// Centralized Korean UX copy. All user-visible strings live here.
public enum Copy {
    // MARK: - Onboarding
    public enum Onboarding {
        public static let hero1        = "나와 한 약속,\n이번엔 진짜 지켜봐요."
        public static let hero2        = "빠져나가기 어렵게 만들어드릴게요."
        public static let heroCTA      = "시작하기"

        public static let goalTitle    = "무엇을 꼭 바꾸고 싶나요?"
        public static let goalHint     = "지금 마음이 가는 걸 고르면 돼요."
        public static let goalNext     = "이걸로 시작할게요"

        public static let howTitle     = "이렇게 지켜요"
        public static let how1         = "약속을 정하고"
        public static let how2         = "했다는 걸 증명하고"
        public static let how3         = "얼마나 지켰는지 확인해요"
        public static let howNext      = "알겠어요"

        public static let notifyTitle  = "마감 전에 알려드릴게요."
        public static let notifySub    = "약속을 놓치지 않도록\n조용히 알림만 보내요."
        public static let notifyYes    = "알림 받을게요"
        public static let notifyLater  = "나중에"

        public static let signInTitle  = "이제 시작해볼까요?"
        public static let signInSub    = "이름과 이메일만 있으면 돼요."
        public static let signInCTA    = "시작하기"
        public static let nameField    = "이름"
        public static let emailField   = "이메일"
    }

    // MARK: - Home
    public enum Home {
        public static let greeting          = "오늘도 지켜봐요"
        public static let noneToday         = "오늘 지킬 약속이 없어요."
        public static let atRiskLabel       = "오늘 걸린 약속금"
        public static let noneMessage       = "작은 약속부터 시작해봐요."
        public static let createCTA         = "새 약속 만들기"
        public static let proofCTA          = "지금 증명하기"
        public static let timerCTA          = "시작하기"
        /// Header shown at the top of the today list when at least one commitment carries MONEY.
        public static func todayCountAndMoney(_ count: Int) -> String { "오늘 지켜야 할 약속 \(count)개" }
        /// Header shown when NO commitment today carries money — no "0원" hero.
        public static func todayCountOnly(_ count: Int) -> String { "오늘 지켜야 할 약속 \(count)개" }
        public static func remainingSuffix(_ minutes: Int) -> String { "\(minutes)분 남았어요" }
    }

    // MARK: - Wizard
    public enum Wizard {
        public static let step1Title       = "무엇을 꼭 하게 만들고 싶나요?"
        public static let step2Title       = "언제 할까요?"
        public static let step3Title       = "어떻게 증명할까요?"
        public static let step3Recommended = "추천"
        public static let step4Title       = "이렇게 증명하면 돼요"
        // Enforcement step
        public static let enforceTitle     = "어떻게 지키게 만들까요?"
        public static let enforceSelfTitle = "나만 확인할게요"
        public static let enforceSelfSub   = "증명은 남기되, 돈은 걸지 않아요."
        public static let enforceSocialTitle = "친구에게 결과를 알려주세요"
        public static let enforceSocialSub   = "혼자만 아는 약속보다 더 지키기 쉬워져요."
        public static let enforceMoneyTitle  = "돈까지 걸고 확실히 할게요"
        public static let enforceMoneySub    = "못 지키면 실제 약속금을 돌려받지 못해요."
        // Money step (only MONEY mode)
        public static let step5Title       = "못 지키면 얼마를 걸까요?"
        public static let step5MaxPrefix   = "이번 약속에서\n최대"
        public static let step5MaxSuffix   = "이 걸려 있어요."
        public static let step5PerLabel    = "한 번 놓치면"
        public static let step5MonthlyRemaining = "이번 달 남은 한도"
        public static let step5CustomLabel = "직접 입력"
        public static let step5CustomPlaceholder = "원하는 금액"
        public static let step5OverTierTitle = "금액이 큰 약속이에요"
        public static let step5OverTierConfirm = "이 금액으로 할게요"
        public static let step5OverTierBack    = "금액 다시 고르기"
        public static func step5OverTierBody(_ krw: Int64) -> String {
            "이번 약속에서 최대 \(MoneyText.format(krw))을\n돌려받지 못할 수 있어요."
        }
        // Social step
        public static let step6Title       = "누구에게 알려줄까요?"
        public static let step6OnlyMe      = "나만 보기"
        public static let step6Share       = "친구에게 결과 공유"
        public static let step6Verify      = "친구가 직접 확인"
        public static let step6FriendHint  = "친구는 결과를 알 뿐, 실패금을 받지 않아요."
        // Review
        public static let step7Title       = "이대로 약속할게요"
        public static let step7CTA         = "이대로 약속할게요"
        public static let step7MoneyReviewHint = "약속이 끝나면 지킨 만큼 돌려받아요."
        public static let step7SelfReviewHint  = "돈은 걸지 않고 내 기록으로 확인할게요."
        public static let step7SocialReviewHint = "친구에게도 결과가 전달돼요."
        /// MONEY review CTA: "15,000원 걸고 약속할게요"
        public static func step7MoneyCTA(_ amount: String) -> String { "\(amount) 걸고 약속할게요" }
        public static let step8Title       = "약속금을 걸어요"
        public static let step8SubDev      = "개발 모드 · 모의 결제(MockPaymentProvider)로 진행돼요."
        public static let step8RowPerOccurrence = "회차당 약속금"
        public static let step8RowCount    = "총 횟수"
        public static let step8RowMaxLoss  = "최대 손실"
        public static let step8RowUpfront  = "지금 결제할 금액"
        public static let step8Explain     = "약속금은 미리 결제되고, 약속이 끝나면 지킨 회차만큼 한 번에 돌려받아요."
        public static func step8CTA(_ amount: String) -> String { "\(amount) 결제하기" }
        public static let step8Charging    = "결제 중"
        public static let step8FailedTitle = "결제가 완료되지 않았어요"
        public static let step8Retry       = "다시 결제하기"
        public static let step8DebugFail   = "결제 실패 시뮬레이션 (DEBUG)"
        public static let step8Funded      = "약속금 걸림"
        public static let step9Title       = "마지막으로,\n직접 약속해요."
        public static let step9Hint        = "손가락으로 서명해주세요."
        public static let step9Expiry      = "결제 후 30분 안에 서명을 마쳐주세요."
        public static let step9ExpiryRefund = "시간이 지나면 전액 환불돼요."
        public static let step9Clear       = "다시 그리기"
        public static let step9CTA         = "서명하고 시작하기"
        public static let step9Cancel      = "약속 취소하기"
        public static let step9CancelTitle = "약속을 취소할까요?"
        public static let step9CancelBody  = "결제된 약속금은 전액 환불돼요. 약속은 시작되지 않아요."
        public static let step9CancelYes   = "취소하고 환불받기"
        public static let step10Title      = "약속이 시작됐어요."
        public static let step10Cancelled  = "약속을 시작하지 않았어요."
        public static let step10CancelledSub = "걸린 약속금은 전액 돌려드려요."
        public static let step10SubMoney   = "지금 걸린 약속금"
        public static let step10SubSelf    = "이제 매일 지켜봐요."
        public static let step10Home       = "홈으로"

        public static let scheduleOneTime       = "한 번만"
        public static let scheduleDaily         = "매일"
        public static let scheduleSpecificDays  = "특정 요일"
        public static let scheduleXPerWeek      = "주 N회"

        public static let methodPhoto     = "사진으로 증명"
        public static let methodGps       = "장소로 증명"
        public static let methodTimer     = "집중 타이머"
        public static let methodSelf      = "내가 직접 확인"
        public static let methodFriend    = "친구가 확인"

        public static func timesPerWeek(_ n: Int) -> String { "주 \(n)회" }
        public static let windowStartLabel      = "약속 시작 시간"
        public static let deadlineLabel         = "증명 마감 시간"
        public static let daysLabel             = "요일"

        public static let next            = "다음"
        public static let back            = "이전"

        public static let unsafeTitle     = "이 약속에는 약속금을 걸 수 없어요."
        public static let unsafeSubtitle  = "안전을 위해 다른 방식의 목표로 바꿔주세요."

        public static let comingSoon      = "준비 중"
        public static let comingSoonSocial = "친구 초대는 곧 열려요. 지금은 나만 확인이나 약속금으로 지켜봐요."
        public static let comingSoonFriend = "친구와 함께 지키는 기능은 곧 열려요."
        public static let gpsPickPlaceholder = "장소가 아직 선택되지 않았어요."
        public static let gpsPickCTA      = "장소 선택하기"
        public static let gpsDebugMock    = "테스트용 위치 넣기"
    }

    // MARK: - Proof (증명하기)
    public enum Proof {
        // Photo
        public static let photoTitle       = "약속을 사진으로 남겨요"
        public static let photoHint        = "카메라로 지금 이 순간을 찍어주세요."
        public static let photoCapture     = "지금 촬영하기"
        public static let photoRetake      = "다시 찍기"
        public static let photoUse         = "이 사진으로 증명하기"
        public static let photoUploading   = "증명을 보내는 중이에요"
        public static let photoReviewing   = "확인 중이에요"
        public static let photoPermTitle   = "카메라 접근이 필요해요"
        public static let photoPermBody    = "약속을 사진으로 증명하려면 카메라 사용을 허용해주세요."
        public static let photoPermCTA     = "설정에서 허용하기"
        // GPS
        public static let gpsTitle         = "지정한 장소에 도착했나요?"
        public static let gpsCapturing     = "현재 위치를 확인하고 있어요."
        public static let gpsSubmit        = "여기서 증명하기"
        public static let gpsPermTitle     = "위치 접근이 필요해요"
        public static let gpsPermBody      = "약속 장소에 도착했는지 확인하려면 위치 사용을 허용해주세요."
        public static let gpsPermCTA       = "설정에서 허용하기"
        public static func gpsRadiusHint(_ label: String?, _ radiusM: Int) -> String {
            let name = (label?.isEmpty == false) ? label! : "지정한 장소"
            return "\(name) \(radiusM)m 안에 들어오면 돼요."
        }
        // Target picker
        public static let pickerTitle      = "어디에 가야 하나요?"
        public static let pickerConfirm    = "이 위치로 정할게요"
        public static let pickerSearchHint = "장소 검색"
        public static let pickerUseCurrent = "현재 위치 사용"
        public static let pickerRadiusLabel = "도착 반경"
        // Timer
        public static let timerTitle       = "집중 타이머"
        public static let timerStart       = "시작하기"
        public static let timerPause       = "잠깐 멈추기"
        public static let timerResume      = "계속하기"
        public static let timerFinish      = "완료"
        public static let timerGiveUp      = "그만두기"
        public static func timerGoalMinutes(_ m: Int) -> String { "\(m)분 채우기" }
        public static let timerKeepScreenOn = "화면을 켜두면 더 정확해요."
        // Self verify
        public static let selfTitle        = "약속을 지켰나요?"
        public static let selfSub          = "솔직하게 눌러주세요."
        public static let selfKept         = "지켰어요"
        public static let selfMissed       = "못 지켰어요"
        public static let selfConfirmKept  = "정말 지켰어요?"
        public static let selfConfirmMissed = "정말 놓쳤어요?"
    }

    // MARK: - Result UX (PRD §14)
    public enum Result {
        // PASS
        public static let passTitle        = "약속을 지켰어요."
        public static func passSelfBody(_ dateLine: String) -> String { "\(dateLine)도 해냈어요." }
        public static func passMoneyBody(_ krw: Int64) -> String { "\(MoneyText.format(krw))을 지켰어요." }
        // UNCERTAIN
        public static let uncertainTitle   = "한 번 더 확인이 필요해요."
        public static let uncertainBody    = "아직 실패로 처리하지 않았어요."
        public static let uncertainCTA     = "다시 증명하기"
        // FAIL
        public static let failTitle        = "약속을 놓쳤어요."
        public static func failMoneyBody(_ krw: Int64) -> String { "\(MoneyText.format(krw))이 걸린 회차예요." }
        public static let failSelfBody     = "다음 약속은 이어가볼까요?"
        // Shared
        public static let backHome         = "홈으로"
        public static let checkAgainLater  = "잠시 후 다시 확인해요."
    }

    // MARK: - Appeal (MONEY FAIL only)
    public enum Appeal {
        public static let cta = "결과에 이의 제기하기"
        public static let title = "결과에 이의 제기하기"
        public static let body = "이미 제출한 증명과 판정 내용만 다시 살펴봐요. 새 사진은 받지 않아요."
        public static let reasonLabel = "어떤 부분이 잘못된 것 같나요?"
        public static let reasonVerification = "판정이 잘못된 것 같아요"
        public static let reasonEvidence = "증거가 잘못 읽힌 것 같아요"
        public static let reasonOther = "다른 이유예요"
        public static let explanationLabel = "짧게 알려주세요"
        public static let explanationHint = "다시 봐주었으면 하는 점을 적어주세요."
        public static let submit = "제출하기"
        public static let reviewing = "검토 중"
        public static let rejectedPrefix = "기각됨"
        public static let originalFail = "원래 결과 · 놓침"
        public static let correctedPass = "정정 결과 · 지킴"
        public static let correctedVoid = "정정 결과 · 무효"
        public static func approved(_ refund: SupplementalRefundStatus) -> String {
            switch refund {
            case .none: return "승인됨"
            case .pending: return "승인됨 · 추가 환불 예정"
            case .succeeded: return "승인됨 · 추가 환불 완료"
            case .delayed: return "승인됨 · 추가 환불 지연"
            }
        }
        public static func resultLabel(_ raw: String) -> String {
            switch raw {
            case "pass": return "지킴"
            case "void": return "무효"
            case "fail": return "놓침"
            default: return raw
            }
        }
    }

    public enum Cancel {
        public static let cta = "약속 그만하기"
        public static let selfConfirm = "이미 시작된 회차는 그대로 두고,\n앞으로의 약속을 그만할게요."
        public static let moneyNotice = "취소는 24시간 뒤 적용돼요."
        public static func moneyBinding(_ n: Int) -> String { "그전에 시작되는 \(n)번은 그대로 진행돼요." }
        public static func moneyRefund(_ n: Int, _ amount: String) -> String {
            "이후 \(n)번의 약속금 \(amount)원은 최종 정산 때 환불돼요."
        }
        public static let confirm = "그만할게요"
        public static let keep = "계속 지킬게요"
        public static let scheduled = "취소 예정"
        public static func effective(_ when: String) -> String { "적용 시각 \(when)" }
        public static func remaining(_ n: Int) -> String { "남은 진행 회차 \(n)번" }
        public static func futureRefund(_ amount: String) -> String { "최종 정산 때 환불 예정 \(amount)원" }
    }

    public enum Notify {
        public static let deadline = "약속 시간이 다가오고 있어요"
        public static let signature = "서명을 마쳐주세요"
        public static let refundDone = "환불 처리가 완료됐어요"
        public static let refundDelayed = "환불 처리가 늦어지고 있어요"
        public static let appeal = "이의 제기 결과가 도착했어요"
        public static let recap = "지난주 약속을 정리했어요"
        public static let retryTitle = "다시 보냈어요"
        public static let retryBody = "전송에 실패했던 알림과 삭제를 유지보수가 다시 처리했어요."
        public static let section = "알림"
        public static let enable = "알림 허용"
        public static let deadlinePref = "약속 마감"
        public static let signaturePref = "서명 만료"
        public static let refundPref = "환불"
        public static let appealPref = "이의 제기"
        public static let recapPref = "주간 정리"
        public static let recapCta = "지난주 정리"
    }

    public enum Recap {
        public static let nav = "지난주 정리"
        public static let title = "지난주 약속을 정리했어요"
        public static func weekLine(_ start: String) -> String { "\(start)부터 일주일" }
        public static func counts(due: Int, pass: Int, fail: Int, void: Int, unresolved: Int) -> String {
            "예정 \(due) · 지킴 \(pass) · 놓침 \(fail) · 무효 \(void) · 미결 \(unresolved)"
        }
        public static func rate(_ value: Double?) -> String {
            guard let value else { return "성공률은 아직 없어요." }
            return "성공률 \(Int((value * 100).rounded()))%"
        }
        public static func kept(_ krw: String) -> String { "지킨 약속금 \(krw)원" }
        public static func forfeited(_ krw: String) -> String { "정산된 손실 \(krw)원" }
        public static func refundPending(_ krw: String) -> String { "환불 대기 \(krw)원" }
    }

    public enum Evidence {
        public static let title = "증거"
        public static let deleted = "보관 기간이 지나 삭제된 증거예요."
    }

    // MARK: - Days
    public static let weekdayShort: [String: String] = [
        "MON": "월", "TUE": "화", "WED": "수", "THU": "목",
        "FRI": "금", "SAT": "토", "SUN": "일",
    ]

    public static func weekdayShortList(_ days: [String]) -> String {
        days.compactMap { weekdayShort[$0] }.joined(separator: "·")
    }
}
