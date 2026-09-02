import { CommitmentCategory, VerificationMethod } from '@prisma/client';

/**
 * Data-driven commitment templates. The wizard renders required configuration
 * steps based on `requiredSteps`. Templates are static in MVP but the shape is
 * ready to be moved into a table later.
 */
export type WizardStepId =
  | 'goal'
  | 'schedule'
  | 'verification'
  | 'stake'
  | 'observer'
  | 'contract'
  | 'payment'
  | 'signature';

export interface CommitmentTemplate {
  id: string;
  category: CommitmentCategory;
  title: string;
  suggestedProof: {
    method: VerificationMethod;
    rule: Record<string, unknown>;
  };
  suggestedStakeKrw: number[];
  requiredSteps: WizardStepId[];
}

const BASE_STEPS: WizardStepId[] = [
  'goal',
  'schedule',
  'verification',
  'stake',
  'observer',
  'contract',
  'payment',
  'signature',
];

export const COMMITMENT_TEMPLATES: CommitmentTemplate[] = [
  {
    id: 'wakeup-7am',
    category: 'wakeup',
    title: '오전 7시까지 일어나기',
    suggestedProof: {
      method: 'photo',
      rule: { hint: '기상 후 아침 식탁 또는 창밖 사진' },
    },
    suggestedStakeKrw: [3_000, 5_000, 10_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'gym',
    category: 'workout',
    title: '헬스장 가기',
    suggestedProof: {
      method: 'gps',
      rule: { radius_m: 150 },
    },
    suggestedStakeKrw: [5_000, 10_000, 20_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'study-60m',
    category: 'study',
    title: '60분 공부하기',
    suggestedProof: {
      method: 'timer',
      rule: { required_seconds: 60 * 60 },
    },
    suggestedStakeKrw: [3_000, 5_000, 10_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'read-20p',
    category: 'read',
    title: '책 20페이지 읽기',
    suggestedProof: {
      method: 'photo',
      rule: { hint: '읽은 페이지 사진' },
    },
    suggestedStakeKrw: [3_000, 5_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'meditate-20m',
    category: 'meditate',
    title: '20분 명상하기',
    suggestedProof: {
      method: 'timer',
      rule: { required_seconds: 20 * 60 },
    },
    suggestedStakeKrw: [3_000, 5_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'screen-30m-instagram',
    category: 'screen',
    title: '인스타그램 30분 이하',
    suggestedProof: {
      method: 'self',
      rule: { hint: '스크린타임 스크린샷' },
    },
    suggestedStakeKrw: [3_000, 5_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'no-delivery',
    category: 'custom',
    title: '배달음식 주문하지 않기',
    suggestedProof: {
      method: 'self',
      rule: {},
    },
    suggestedStakeKrw: [5_000, 10_000],
    requiredSteps: BASE_STEPS,
  },
  {
    id: 'custom',
    category: 'custom',
    title: '직접 만들기',
    suggestedProof: {
      method: 'photo',
      rule: {},
    },
    suggestedStakeKrw: [3_000, 5_000, 10_000, 20_000],
    requiredSteps: BASE_STEPS,
  },
];

export function findTemplate(id: string): CommitmentTemplate | undefined {
  return COMMITMENT_TEMPLATES.find((t) => t.id === id);
}
