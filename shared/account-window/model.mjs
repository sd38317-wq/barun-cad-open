// 공통 계정 및 업데이트 창 — 상태 판단 규칙 (DOM 없음, Node 시험 가능).
// 네 앱(바른문서·바른CAD·바른디자인·미리)이 이 파일과 contract/*.json을 그대로 쓴다. 앱별 차이는 adapter가 넘기는 값뿐이다.
// JSON은 코드나 권한이 아니다: enabledWhen 문자열은 아래 PREDICATES 표의 이름으로만 해석하고 eval하지 않는다.

export const RENDERER_VERSION = '2.1.0-r1+cad.2';
export const CONTRACT_SHA256 = Object.freeze({
  'account-window.json': '2c57536b0b2bd544136b7d376af557718e178f38dea3f3c7acab7a8374543803',
  'self-repair.json': '3596fb06bd3dde624f90b0358f1489abc59ecb033156b96b5354f8d310aefd1f',
  'sso-contract.json': '566d5d6d99935ea50f4c46c70d420c1d2773900c2effa2a043f1a258eaf1ef8f',
});
export const SECTION_ORDER = ['header', 'account', 'ai', 'update', 'footer'];
export const ALLOWED_APP_FIELDS = ['appId', 'displayName', 'officialIconAsset', 'installedVersion'];

const BUSY_REPAIR = new Set(['diagnosing', 'awaiting_consent', 'repairing', 'verifying']);

// 두 판 번호 비교(1.2.10 > 1.2.9). 숫자 외 꼬리표는 무시하지 않고 비교 불가로 본다.
export function compareVersions(a, b) {
  const parse = (v) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim()) || []).slice(1).map(Number);
  const x = parse(a), y = parse(b);
  if (x.length !== 3 || y.length !== 3) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

export const PREDICATES = Object.freeze({
  always: () => true,
  signedOutOrExpiredOrLocallyDisconnected: (s) => ['signed_out', 'expired', 'locally_disconnected'].includes(s.session.state),
  connected: (s) => s.session.state === 'connected',
  connectedAndWalletAvailable: (s) => s.session.state === 'connected' && s.wallet.state === 'ready',
  providerConfiguredAndNotBusy: (s) => !!currentAi(s).configured && currentAi(s).state !== 'checking',
  notChecking: (s) => s.update.state !== 'checking' && !['downloading', 'installing'].includes(s.update.phase),
  verifiedNewerVersion: (s) => s.update.state === 'available' && s.update.verified === true && compareVersions(s.update.nextVersion, s.app.installedVersion) === 1 && !['downloading', 'downloaded', 'installing'].includes(s.update.phase),
  notRepairing: (s) => !BUSY_REPAIR.has(s.repair.state),
});

export const predicateName = (enabledWhen) => String(enabledWhen || '').split(';')[0].trim();

export function validateContract(ui) {
  const problems = [];
  if (ui?.schemaVersion !== '2.0.0') problems.push('schemaVersion');
  if (JSON.stringify(ui?.sections?.map((s) => s.id)) !== JSON.stringify(SECTION_ORDER)) problems.push('section order');
  const ids = (ui?.actions || []).map((a) => a.id);
  if (new Set(ids).size !== ids.length) problems.push('duplicate action');
  for (const action of ui?.actions || []) if (!Object.hasOwn(PREDICATES, predicateName(action.enabledWhen))) problems.push(`unknown enabledWhen ${action.enabledWhen}`);
  const used = [];
  for (const section of ui?.sections || []) used.push(...(section.actions || []), ...(section.left?.actions || []), ...(section.right?.actions || []));
  for (const id of used) if (!ids.includes(id)) problems.push(`missing action ${id}`);
  if (!ui?.excluded?.includes('separate-small-login-dialog')) problems.push('exclusions');
  if (problems.length) throw new Error(`계정 창 계약이 올바르지 않습니다: ${problems.join(', ')}`);
  return ui;
}

// adapter 상태를 빈 칸 없이 채운다. 모르는 값은 모르는 값으로 둔다(0이나 추측 모델명으로 채우지 않음).
export function normalizeState(app, raw = {}) {
  const session = { state: 'signed_out', displayName: null, ...raw.session };
  if (!SESSION.includes(session.state)) session.state = 'error';
  const wallet = { state: 'unknown', balance: null, ...raw.wallet };
  if (session.state !== 'connected') Object.assign(wallet, { state: 'unknown', balance: null });
  if (wallet.state === 'ready' && !Number.isFinite(wallet.balance)) wallet.state = 'error';
  const aiMode = (mode) => ({ state: 'unconfigured', configured: false, providerDisplayName: null, actualModelId: null, selectedModelId: null, billingSource: null, ...(raw.ai?.modes?.[mode] || {}) });
  const ai = { activeMode: raw.ai?.activeMode === 'personal' ? 'personal' : 'managed', viewMode: null, modes: { managed: aiMode('managed'), personal: aiMode('personal') } };
  ai.viewMode = raw.ai?.viewMode === 'personal' || raw.ai?.viewMode === 'managed' ? raw.ai.viewMode : ai.activeMode;
  const update = { state: 'idle', phase: null, verified: false, nextVersion: null, percent: null, message: null, releaseNotes: [], ...raw.update };
  const repair = { state: 'idle', summary: null, ...raw.repair };
  return { app: { ...app }, session, wallet, ai, update, repair };
}
const SESSION = ['signed_out', 'authenticating', 'connected', 'expired', 'offline', 'error', 'locally_disconnected'];
const currentAi = (s) => s.ai.modes[s.ai.viewMode] || s.ai.modes.managed;

const SESSION_TEXT = {
  signed_out: [null, null],
  authenticating: ['로그인 진행 중', '브라우저에서 로그인을 마쳐 주세요.'],
  connected: [null, '바른 계정으로 연결되었습니다.'],
  expired: ['다시 로그인이 필요합니다', '로그인이 만료되었습니다. 다시 로그인해 주세요.'],
  offline: ['연결할 수 없음', '인터넷 연결을 확인해 주세요. 계정 정보는 그대로입니다.'],
  error: ['계정 확인 실패', '계정 서버 문제로 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'],
  locally_disconnected: ['이 앱에서 로그아웃됨', '다시 쓰려면 로그인 버튼을 눌러 주세요.'],
};
const AI_STATUS = { unconfigured: '연결 대기', checking: '확인 중', connected: '연결됨', offline: '연결 끊김', error: '오류' };
const UPDATE_TEXT = { checking: '새 업데이트를 확인하고 있습니다.', up_to_date: '최신 버전을 사용하고 있습니다.', error: '업데이트를 확인하지 못했습니다.' };

const fill = (template, s) => String(template).replace(/\{app\.displayName\}/g, s.app.displayName || '');
const formatCoins = (n) => `${Number(n).toLocaleString('ko-KR')}`;

// 화면에 그릴 값 한 벌. 렌더러는 이 값만 그린다.
export function buildView(contract, state) {
  const section = Object.fromEntries(contract.sections.map((s) => [s.id, s]));
  const actions = Object.fromEntries(contract.actions.map((a) => [a.id, a]));
  const enabled = (id) => !!actions[id] && PREDICATES[predicateName(actions[id].enabledWhen)](state);
  const acc = section.account;
  const [title, description] = SESSION_TEXT[state.session.state];
  const connected = state.session.state === 'connected';
  const name = connected ? (state.session.displayName || '사용자') : (title || acc.left.signedOutTitle);
  const walletKnown = state.wallet.state === 'ready';
  const ai = currentAi(state);
  const up = state.update;
  const newer = up.verified === true && compareVersions(up.nextVersion, state.app.installedVersion) === 1;
  let updateText = up.message && (up.state === 'error' || up.state === 'idle') ? up.message : UPDATE_TEXT[up.state] || section.update.unknownText;
  if (up.state === 'available' && newer) updateText = `새 버전 v${up.nextVersion}이 있습니다.`;
  if (up.phase === 'downloading') updateText = `업데이트 파일을 받고 있습니다${Number.isFinite(up.percent) ? ` (${Math.round(up.percent)}%)` : ''}.`;
  if (up.phase === 'downloaded') updateText = '받기를 마쳤습니다. 설치는 다시 시작할 때 진행합니다.';
  if (up.phase === 'installing') updateText = '업데이트를 적용하고 있습니다.';
  const version = state.app.installedVersion ? `v${state.app.installedVersion}` : '';
  const aiCaption = ai.providerDisplayName || ai.billingSource
    ? [ai.providerDisplayName && `제공: ${ai.providerDisplayName}`, ai.billingSource && `비용: ${ai.billingSource}`].filter(Boolean).join(' · ')
    : section.ai.description;
  return {
    header: { title: section.header.title, subtitle: section.header.subtitle, brand: state.app.displayName, version },
    account: {
      avatar: connected ? name.trim().charAt(0).toUpperCase() : '—',
      name, description: description || acc.left.description, sessionState: state.session.state,
      walletTitle: acc.right.title,
      walletValue: walletKnown ? formatCoins(state.wallet.balance) : acc.right.unknownValue,
      walletKnown,
      walletDescription: walletKnown ? '코인' : state.wallet.state === 'loading' ? '잔액을 확인하고 있습니다.' : state.wallet.state === 'error' ? '잔액을 불러오지 못했습니다. 0으로 표시하지 않습니다.' : acc.right.unknownDescription,
    },
    ai: {
      title: section.ai.title,
      modes: section.ai.modes.map((m) => ({ id: m.id, label: m.label, selected: m.id === state.ai.viewMode, active: m.id === state.ai.activeMode })),
      modelLabel: '사용 모델',
      model: ai.actualModelId || section.ai.unknownModel,
      modelKnown: !!ai.actualModelId,
      selectedModel: ai.selectedModelId && ai.selectedModelId !== ai.actualModelId ? `선택: ${ai.selectedModelId}` : '',
      status: AI_STATUS[ai.state] || AI_STATUS.error,
      statusState: ai.state,
      caption: aiCaption,
      showTest: !!ai.configured,
    },
    update: {
      title: fill(section.update.titleTemplate, state),
      text: updateText,
      current: version ? `현재 ${version}` : '',
      next: newer ? `새 버전 v${up.nextVersion}` : '',
      progress: up.phase === 'downloading' ? (Number.isFinite(up.percent) ? Math.max(0, Math.min(100, up.percent)) : -1) : null,
      showDownload: enabled('update.download'),
      // 선택 항목: 새 버전의 변경 내용(최대 5줄). 앱이 검증된 배포 정보에서 받은 글자만 넘긴다.
      notes: newer && Array.isArray(up.releaseNotes) ? up.releaseNotes.filter((n) => typeof n === 'string' && n.trim()).slice(0, 5).map((n) => n.slice(0, 300)) : [],
    },
    footer: { description: state.repair.summary || section.footer.description, preservation: section.footer.preservation },
    enabled: Object.fromEntries(contract.actions.map((a) => [a.id, enabled(a.id)])),
    labels: Object.fromEntries(contract.actions.map((a) => [a.id, a.label])),
    styles: Object.fromEntries(contract.actions.map((a) => [a.id, a.style])),
  };
}
