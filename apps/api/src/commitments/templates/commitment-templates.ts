import { CommitmentCategory, CommitmentDirection, ScheduleType, VerificationMethod } from '@prisma/client';

/**
 * Data-driven commitment templates.
 *
 * The wizard renders required configuration steps based on `requiredInputs`.
 * Adding a new template later must not require touching the wizard code — new
 * `InputKey` values may be introduced, and only then the wizard learns how to
 * render them. Templates are static in MVP but the shape is table-ready.
 */

export type InputKey =
  // Schedule
  | 'scheduleType'
  | 'daysOfWeek'
  | 'timesPerWeek'
  | 'dateRange'
  | 'windowStartLocalTime'
  | 'proofDeadlineLocalTime'
  // Verification-specific
  | 'gpsTarget'
  | 'gpsRadiusM'
  | 'timerRequiredSeconds';

export interface CommitmentTemplate {
  id: string;
  category: CommitmentCategory;
  title: string;
  /** Short 1-line pitch shown in the picker. */
  pitch: string;
  direction: CommitmentDirection;
  /** Schedule types that make sense for this goal. */
  supportedScheduleTypes: ScheduleType[];
  defaultScheduleType: ScheduleType;
  /** Ordered list — first is the recommended method (visually emphasized). */
  recommendedVerification: VerificationMethod[];
  defaultVerification: VerificationMethod;
  /** Static default proof rule; wizard may override user-controlled subfields. */
  defaultProofRule: Record<string, unknown>;
  suggestedStakeKrw: number[];
  defaultStakeKrw: number;
  /** Inputs the wizard must present in addition to base steps. */
  requiredInputs: InputKey[];
  /** Copy shown on the "Proof Rule" step to explain what earns PASS. */
  proofExplanationTemplate: string;
}

const BASE_INPUTS: InputKey[] = [
  'scheduleType',
  'windowStartLocalTime',
  'proofDeadlineLocalTime',
];

export const COMMITMENT_TEMPLATES: CommitmentTemplate[] = [
  {
    id: 'wakeup',
    category: 'wakeup',
    title: '일찍 일어나기',
    pitch: '정한 시간까지 일어나서 사진으로 증명해요.',
    direction: 'do_action',
    supportedScheduleTypes: ['daily', 'specific_days'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['photo', 'self'],
    defaultVerification: 'photo',
    defaultProofRule: { hint: '기상 후 아침 식탁 또는 창밖 사진' },
    suggestedStakeKrw: [3_000, 5_000, 10_000],
    defaultStakeKrw: 3_000,
    requiredInputs: [...BASE_INPUTS, 'daysOfWeek'],
    proofExplanationTemplate: '오전 {windowStartLocalTime}에 일어나서\n{proofDeadlineLocalTime}까지 사진을 찍어요.',
  },
  {
    id: 'workout',
    category: 'workout',
    title: '운동하기',
    pitch: '지정한 헬스장에 다녀와서 GPS로 증명해요.',
    direction: 'do_action',
    supportedScheduleTypes: ['specific_days', 'x_per_week'],
    defaultScheduleType: 'specific_days',
    recommendedVerification: ['gps', 'photo'],
    defaultVerification: 'gps',
    defaultProofRule: { radius_m: 150 },
    suggestedStakeKrw: [5_000, 10_000, 20_000],
    defaultStakeKrw: 5_000,
    requiredInputs: [...BASE_INPUTS, 'daysOfWeek', 'gpsTarget', 'gpsRadiusM'],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 지정한 장소 {gpsRadiusM}m 안에 들어오면 돼요.',
  },
  {
    id: 'study',
    category: 'study',
    title: '공부하기',
    pitch: '집중 타이머로 목표 시간을 채워요.',
    direction: 'do_action',
    supportedScheduleTypes: ['daily', 'specific_days', 'x_per_week'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['timer', 'photo'],
    defaultVerification: 'timer',
    defaultProofRule: { required_seconds: 60 * 60 },
    suggestedStakeKrw: [3_000, 5_000, 10_000],
    defaultStakeKrw: 3_000,
    requiredInputs: [...BASE_INPUTS, 'timerRequiredSeconds'],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 앱 타이머로 {timerRequiredMinutes}분을 채워요.',
  },
  {
    id: 'read',
    category: 'read',
    title: '책 읽기',
    pitch: '읽은 페이지 사진으로 증명해요.',
    direction: 'do_action',
    supportedScheduleTypes: ['daily', 'specific_days'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['photo', 'timer'],
    defaultVerification: 'photo',
    defaultProofRule: { hint: '읽은 페이지 사진' },
    suggestedStakeKrw: [3_000, 5_000],
    defaultStakeKrw: 3_000,
    requiredInputs: [...BASE_INPUTS],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 읽은 페이지 사진을 찍어요.',
  },
  {
    id: 'meditate',
    category: 'meditate',
    title: '명상하기',
    pitch: '집중 타이머로 정한 시간만큼 명상해요.',
    direction: 'do_action',
    supportedScheduleTypes: ['daily', 'specific_days'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['timer'],
    defaultVerification: 'timer',
    defaultProofRule: { required_seconds: 20 * 60 },
    suggestedStakeKrw: [3_000, 5_000],
    defaultStakeKrw: 3_000,
    requiredInputs: [...BASE_INPUTS, 'timerRequiredSeconds'],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 앱 타이머로 {timerRequiredMinutes}분을 채워요.',
  },
  {
    id: 'screen',
    category: 'screen',
    title: 'SNS 덜 보기',
    pitch: '하루 사용시간을 직접 확인해요.',
    direction: 'avoid',
    supportedScheduleTypes: ['daily'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['self', 'photo'],
    defaultVerification: 'self',
    defaultProofRule: { hint: '스크린타임 스크린샷' },
    suggestedStakeKrw: [3_000, 5_000],
    defaultStakeKrw: 3_000,
    requiredInputs: [...BASE_INPUTS],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 오늘 사용시간을 직접 확인해요.',
  },
  {
    id: 'no-delivery',
    category: 'custom',
    title: '배달음식 줄이기',
    pitch: '오늘 배달음식을 시키지 않았는지 확인해요.',
    direction: 'avoid',
    supportedScheduleTypes: ['daily', 'specific_days'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['self', 'friend'],
    defaultVerification: 'self',
    defaultProofRule: {},
    suggestedStakeKrw: [5_000, 10_000],
    defaultStakeKrw: 5_000,
    requiredInputs: [...BASE_INPUTS],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 오늘 배달음식을 시키지 않았는지 확인해요.',
  },
  {
    id: 'custom',
    category: 'custom',
    title: '직접 만들기',
    pitch: '내가 원하는 약속을 자유롭게 만들어요.',
    direction: 'do_action',
    supportedScheduleTypes: ['one_time', 'daily', 'specific_days', 'x_per_week'],
    defaultScheduleType: 'daily',
    recommendedVerification: ['photo', 'gps', 'timer', 'self'],
    defaultVerification: 'photo',
    defaultProofRule: {},
    suggestedStakeKrw: [3_000, 5_000, 10_000, 20_000],
    defaultStakeKrw: 5_000,
    requiredInputs: [...BASE_INPUTS],
    proofExplanationTemplate: '{proofDeadlineLocalTime}까지 약속을 지키고 증명해요.',
  },
];

export function findTemplate(id: string): CommitmentTemplate | undefined {
  return COMMITMENT_TEMPLATES.find((t) => t.id === id);
}
