import { NotificationCategory } from '@prisma/client';

/** Lock-screen copy. Never includes goal text, evidence, or money amounts. */
export const PUSH_COPY: Record<NotificationCategory, { title: string; body: string }> = {
  deadline_reminder: { title: '약속 시간이 다가오고 있어요', body: '지금 앱에서 확인해주세요.' },
  signature_expiry: { title: '서명을 마쳐주세요', body: '지금 앱에서 확인해주세요.' },
  refund: { title: '환불 처리가 완료됐어요', body: '지금 앱에서 확인해주세요.' },
  appeal: { title: '이의 제기 결과가 도착했어요', body: '지금 앱에서 확인해주세요.' },
  weekly_recap: { title: '지난주 약속을 정리했어요', body: '지금 앱에서 확인해주세요.' },
  friend_request: { title: '친구 요청이 도착했어요', body: '지금 앱에서 확인해주세요.' },
  friend_accepted: { title: '친구가 되었어요', body: '지금 앱에서 확인해주세요.' },
  shared_invite: { title: '같이 할 약속 초대가 있어요', body: '지금 앱에서 확인해주세요.' },
  shared_accepted: { title: '친구가 같이 하기로 했어요', body: '지금 앱에서 확인해주세요.' },
  accountability_partner: { title: '친구가 진행을 공유했어요', body: '지금 앱에서 확인해주세요.' },
  shared_progress: { title: '친구 약속에 변화가 있어요', body: '지금 앱에서 확인해주세요.' },
};

export const REFUND_DELAYED_COPY = {
  title: '환불 처리가 늦어지고 있어요',
  body: '지금 앱에서 확인해주세요.',
};

const FORBIDDEN = /원|₩|KRW|\d{3,}/i;

export function assertGenericLockScreen(title: string, body: string): void {
  const text = `${title}\n${body}`;
  if (FORBIDDEN.test(text)) {
    throw new Error('lock-screen copy must not include money amounts');
  }
}
