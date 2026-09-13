import { POLICY_VERSIONS } from './mvp-scope';

export type PublicPageId = 'home' | 'terms' | 'privacy' | 'money-policy' | 'support';

const NAV = [
  ['/', '소개'],
  ['/terms', '이용약관'],
  ['/privacy', '개인정보'],
  ['/money-policy', '약속금 정책'],
  ['/support', '고객지원'],
] as const;

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function layout(title: string, version: string | null, body: string): string {
  const links = NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join(' · ');
  const ver = version ? `<p class="ver">문서 버전 ${escape(version)}</p>` : '';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escape(title)} · 지켜</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
      margin: 0 auto; max-width: 40rem; padding: 1.25rem; line-height: 1.6; color: #111; }
    nav { font-size: .9rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.4rem; }
    h2 { font-size: 1.1rem; margin-top: 1.5rem; }
    .muted, .ver, .ph { color: #555; font-size: .9rem; }
    .ph { background: #f4f4f4; padding: .15rem .35rem; border-radius: 4px; }
    ul { padding-left: 1.2rem; }
    a { color: #0a7a3e; }
  </style>
</head>
<body>
  <nav>${links}</nav>
  <h1>${escape(title)}</h1>
  ${ver}
  ${body}
  <p class="muted">본 문서는 제품 설명을 위한 공개 자료입니다. KCP·Apple·법률 승인을 주장하지 않습니다.</p>
</body>
</html>`;
}

const HOME = `
<p>지켜(JIKYEO)는 개인이 스스로 정한 약속을 지키고, 원할 때만 약속금을 걸 수 있는 서비스입니다.</p>
<p>친구에게 진행을 보여주거나 확인을 요청할 수 있지만, 친구는 돈을 받거나 빼앗거나 정산하지 않습니다.</p>
<ul>
  <li>SELF / SOCIAL / 친구 확인은 지금 사용할 수 있습니다.</li>
  <li>약속금(MONEY)은 선택이며, 실제 결제는 외부 심사와 계약이 끝난 뒤에만 열립니다.</li>
  <li>상금, 내기, 공동 판돈, 다른 사용자에게 지급하는 구조는 없습니다.</li>
</ul>`;

const TERMS = `
<p>지켜를 이용하면 아래 조건에 동의하는 것으로 봅니다. 법정 권리는 이 약관으로 줄어들지 않습니다.</p>
<h2>서비스</h2>
<ul>
  <li>사용자는 약속을 만들고, 정한 방식으로 지켰는지를 확인합니다.</li>
  <li>친구 기능은 진행 공유 또는 회차 확인만 합니다. 친구는 돈을 결정·수령하지 않습니다.</li>
  <li>사진 AI 판정 등 아직 실제 공급자가 없는 기능은 운영 앱에서 제공하지 않습니다.</li>
</ul>
<h2>약속금</h2>
<p>약속금은 선택입니다. 상세 규칙은 <a href="/money-policy">약속금 정책</a>을 따릅니다. 운영에서 실제 결제가 닫혀 있으면 금전 계약을 만들 수 없습니다.</p>
<h2>계정과 금지</h2>
<ul>
  <li>만 19세 미만은 약속금을 걸 수 없습니다.</li>
  <li>위험하거나 불법적인 목표는 거절될 수 있습니다.</li>
</ul>
<h2>문의</h2>
<p><a href="/support">고객지원</a>으로 연락해 주세요.</p>`;

export const MONEY_POLICY_BODY = `
<p>현재 출시 경로의 약속금 모델은 <strong>contract_v1</strong>입니다. 회차마다 돈을 나누거나 일부만 환불하지 않습니다.</p>
<ul>
  <li>약속금은 선택입니다.</li>
  <li>한 약속에 총 약속금 1건, 선결제 1회입니다. 회차별 금액이 없습니다.</li>
  <li>여유 횟수(Grace)는 결제 전에 서버가 계산해 고정합니다.</li>
  <li>한 회차의 실패만으로 바로 돈을 잃지 않습니다. 잠정 실패에는 이의 제기 기간이 있습니다.</li>
  <li>계약 성공이면 원래 결제 수단으로 전액 취소/환불합니다.</li>
  <li>최종 계약 실패이면 환불하지 않습니다.</li>
  <li>시작 전 취소는 전액 환불입니다.</li>
  <li>시작 후 자진 포기는 현 계약 기준으로 환불하지 않습니다.</li>
  <li>시스템·서비스 문제로 무효가 되면 사용자가 돈을 잃지 않습니다.</li>
  <li>상금, 내기, 공동 판돈, 친구/다른 사용자 지급이 없습니다. 다른 사람의 실패로 이득을 볼 수 없습니다.</li>
  <li>법정 권리는 그대로 유지됩니다.</li>
</ul>
<p class="muted">실제 카드/간편결제 연결은 외부 심사와 계약이 끝나기 전에는 열리지 않습니다.</p>`;

const PRIVACY = `
<p>지켜는 서비스 제공에 필요한 범위에서만 개인정보를 처리합니다.</p>
<h2>수집</h2>
<ul>
  <li>계정 식별 정보, 약속·회차·확인 결과</li>
  <li>위치 확인을 선택한 경우, 해당 회차 판정에 필요한 위치</li>
  <li>약속금을 쓰는 경우, 결제사에 필요한 거래 식별 정보</li>
</ul>
<h2>이용</h2>
<ul>
  <li>약속 수행 확인, 고객지원, 부정 이용 방지</li>
  <li>친구 확인은 표시 가능한 이름·약속 제목·회차 구간만 보여 줍니다. 금액·원본 증거·GPS 좌표는 공유하지 않습니다.</li>
</ul>
<h2>보관</h2>
<p>증명 자료는 정해진 기간 후 삭제되며, 이의 제기 등으로 보관이 필요하면 그 기간만 연장됩니다.</p>
<p>문의는 <a href="/support">고객지원</a>으로 해 주세요.</p>`;

const SUPPORT = `
<p>서비스 이용, 약속금, 이의 제기 관련 문의는 아래 채널로 받아 둡니다.</p>
<ul>
  <li>이메일: <span class="ph">운영 정보 입력 전</span></li>
  <li>운영 시간: <span class="ph">운영 정보 입력 전</span></li>
</ul>
<h2>사업자 정보</h2>
<p>실제 운영 값이 확정되기 전입니다. 아래는 자리 표시입니다.</p>
<ul>
  <li>상호: <span class="ph">운영 정보 입력 전</span></li>
  <li>대표: <span class="ph">운영 정보 입력 전</span></li>
  <li>사업자등록번호: <span class="ph">운영 정보 입력 전</span></li>
  <li>주소: <span class="ph">운영 정보 입력 전</span></li>
</ul>
<p class="muted">HTTPS 공개 URL과 실제 운영 정보는 출시 게이트가 닫히기 전에 채워집니다.</p>`;

export function renderPublicPage(id: PublicPageId): string {
  switch (id) {
    case 'home':
      return layout('지켜', null, HOME);
    case 'terms':
      return layout('이용약관', POLICY_VERSIONS.terms, TERMS);
    case 'privacy':
      return layout('개인정보 처리방침', POLICY_VERSIONS.privacy, PRIVACY);
    case 'money-policy':
      return layout('약속금 정책', POLICY_VERSIONS.moneyPolicy, MONEY_POLICY_BODY);
    case 'support':
      return layout('고객지원', null, SUPPORT);
  }
}

export function mountPublicPages(app: {
  get: (path: string, handler: (req: unknown, res: { setHeader: Function; status: Function; send: Function }) => void) => void;
}): void {
  const routes: Array<[string, PublicPageId]> = [
    ['/', 'home'],
    ['/terms', 'terms'],
    ['/privacy', 'privacy'],
    ['/money-policy', 'money-policy'],
    ['/support', 'support'],
  ];
  for (const [path, id] of routes) {
    app.get(path, (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(renderPublicPage(id));
    });
  }
}

export function launchCopyMentionsPartialRefund(text: string): boolean {
  return /비례|회차별\s*환불|부분\s*환급/.test(text);
}
