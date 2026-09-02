/**
 * Rule-based goal-safety classifier for MVP. Provides a stable interface so
 * an LLM classifier can be plugged in later without changing callers.
 *
 * Returns one of:
 *  - `safe`               — allow with stake
 *  - `stake_disallowed`   — allow the goal, but block monetary stake
 *  - `blocked`            — do not create commitment at all
 *
 * Categories reflected here mirror PRD §15 (self-harm, extreme diet, medication
 * withdrawal, dangerous exercise, illegal, reckless driving).
 */
export type SafetyDecision = 'safe' | 'stake_disallowed' | 'blocked';

export interface SafetyResult {
  decision: SafetyDecision;
  reasonCode: string;
  userMessage: string;
  matchedTerms: string[];
}

export abstract class GoalSafetyClassifier {
  abstract classify(title: string, description?: string | null): Promise<SafetyResult>;
}

interface Rule {
  terms: string[];
  decision: SafetyDecision;
  reasonCode: string;
  userMessage: string;
}

const RULES: Rule[] = [
  {
    terms: ['자해', '자살'],
    decision: 'blocked',
    reasonCode: 'SELF_HARM',
    userMessage: '자해와 관련된 약속은 만들 수 없어요. 도움이 필요하면 1393(자살예방상담전화)로 연락하세요.',
  },
  {
    terms: ['단식', '굶기', '금식 3일', '금식 4일', '금식 5일'],
    decision: 'blocked',
    reasonCode: 'EXTREME_FASTING',
    userMessage: '극단적인 단식 약속은 만들 수 없어요.',
  },
  {
    terms: ['약 끊', '처방약 중단', '약물 중단'],
    decision: 'blocked',
    reasonCode: 'MEDICATION_STOP',
    userMessage: '처방약 중단과 관련된 약속은 만들 수 없어요.',
  },
  {
    terms: ['음주운전', '무면허', '과속'],
    decision: 'blocked',
    reasonCode: 'RECKLESS_DRIVING',
    userMessage: '위험 운전 약속은 만들 수 없어요.',
  },
  {
    terms: ['도둑질', '절도', '마약'],
    decision: 'blocked',
    reasonCode: 'ILLEGAL',
    userMessage: '불법 행위와 관련된 약속은 만들 수 없어요.',
  },
  {
    terms: ['다이어트', '체중감량', '단식', '5kg', '10kg'],
    decision: 'stake_disallowed',
    reasonCode: 'EXTREME_DIET',
    userMessage: '건강과 관련된 목표에는 약속금을 걸 수 없어요. 약속금 없이 이어갈 수 있어요.',
  },
];

export class RuleBasedGoalSafetyClassifier extends GoalSafetyClassifier {
  async classify(title: string, description?: string | null): Promise<SafetyResult> {
    const haystack = `${title}\n${description ?? ''}`.toLowerCase();
    const matches: Rule[] = [];
    for (const r of RULES) {
      if (r.terms.some((t) => haystack.includes(t.toLowerCase()))) {
        matches.push(r);
      }
    }
    if (matches.length === 0) {
      return { decision: 'safe', reasonCode: 'OK', userMessage: '', matchedTerms: [] };
    }
    // If any blocked rule matches, block.
    const blocking = matches.find((m) => m.decision === 'blocked');
    if (blocking) {
      return {
        decision: 'blocked',
        reasonCode: blocking.reasonCode,
        userMessage: blocking.userMessage,
        matchedTerms: blocking.terms,
      };
    }
    const stakeless = matches[0];
    return {
      decision: 'stake_disallowed',
      reasonCode: stakeless.reasonCode,
      userMessage: stakeless.userMessage,
      matchedTerms: stakeless.terms,
    };
  }
}
