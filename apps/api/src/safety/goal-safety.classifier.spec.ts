import { RuleBasedGoalSafetyClassifier } from './goal-safety.classifier';

describe('RuleBasedGoalSafetyClassifier (Korean corpus)', () => {
  const svc = new RuleBasedGoalSafetyClassifier();

  it('allows benign Korean goals', async () => {
    for (const title of ['일찍 일어나기', '헬스장 가기', '책 30페이지 읽기', '명상 20분']) {
      const r = await svc.classify(title);
      expect(r.decision).toBe('safe');
    }
  });

  it('blocks self-harm phrasing', async () => {
    for (const title of ['자살 준비', '자해 시도 매일', '오늘 자살']) {
      const r = await svc.classify(title);
      expect(r.decision).toBe('blocked');
      expect(r.reasonCode).toBe('SELF_HARM');
      expect(r.userMessage).toContain('1393');
    }
  });

  it('blocks extreme fasting variants', async () => {
    for (const title of ['금식 5일 유지', '3일 굶기', '무조건 단식']) {
      const r = await svc.classify(title);
      expect(['blocked', 'stake_disallowed']).toContain(r.decision);
    }
  });

  it('blocks illegal activities', async () => {
    const r = await svc.classify('마약 매일 하기');
    expect(r.decision).toBe('blocked');
    expect(r.reasonCode).toBe('ILLEGAL');
  });

  it('blocks reckless driving', async () => {
    const r = await svc.classify('과속 매일');
    expect(r.decision).toBe('blocked');
    expect(r.reasonCode).toBe('RECKLESS_DRIVING');
  });

  it('blocks medication-stop', async () => {
    const r = await svc.classify('처방약 중단하기');
    expect(r.decision).toBe('blocked');
    expect(r.reasonCode).toBe('MEDICATION_STOP');
  });

  it('marks extreme-diet goals as stake_disallowed but not blocked', async () => {
    const r = await svc.classify('10kg 감량');
    expect(r.decision).toBe('stake_disallowed');
    expect(r.reasonCode).toBe('EXTREME_DIET');
  });

  it('user-facing messages are Korean and calm', async () => {
    const r = await svc.classify('자살');
    expect(/^[\uAC00-\uD7A3\s\d\.\,]/.test(r.userMessage)).toBe(true);
    expect(r.userMessage).not.toMatch(/error|forbidden|unsafe/i);
  });
});
