// 계정 팝오버(작은 창) — 한 줄 요약 규칙. DOM 없음(Node 시험 가능).
// 판단은 model.mjs(buildView)가 한 값을 그대로 쓰고, 여기서는 팝오버 한 줄에 들어갈 짧은 글자만 만든다.
// 모르는 값은 모른다고 쓴다(코인 0·모델 이름 추측 금지 — model.mjs와 같은 원칙).

export const POPOVER_ROWS = Object.freeze(['coin', 'ai', 'update', 'repair']);
export const AI_MODE_SHORT = Object.freeze({ managed: '미리 제공', personal: '내 모델' });

const SUBLINE = {
  signed_out: '바른 앱 모두 한 번에 연결',
  authenticating: '브라우저에서 로그인을 마쳐 주세요',
  connected: '바른 계정으로 연결됨',
  expired: '로그인이 만료됐습니다',
  offline: '인터넷 연결을 확인해 주세요',
  error: '계정 서버를 확인하지 못했습니다',
  locally_disconnected: '이 앱에서 로그아웃됨',
};

export function coinValue(view, state) {
  if (view.account.walletKnown) return `${view.account.walletValue} 코인`;
  if (state.session.state !== 'connected') return '로그인 후';
  if (state.wallet.state === 'loading') return '확인 중';
  return '불러오지 못함';
}

export function updateBadge(state) {
  const up = state.update;
  if (up.phase === 'downloading') return Number.isFinite(up.percent) ? `받는 중 ${Math.round(up.percent)}%` : '받는 중';
  if (up.phase === 'downloaded') return '설치 준비됨';
  if (up.phase === 'installing') return '설치 중';
  if (up.state === 'checking') return '확인 중';
  if (up.state === 'up_to_date') return '최신';
  if (up.state === 'error') return '확인 실패';
  if (up.state === 'available') return up.nextVersion ? `새 버전 v${up.nextVersion}` : '새 버전';
  if (up.development) return '개발 실행';
  return '확인 전';
}

const REPAIR = { idle: '문서·설정은 그대로', diagnosing: '진단 중…', awaiting_consent: '확인 필요', repairing: '복구 중…', verifying: '확인 중…', succeeded: '이상 없음', partial: '확인 필요', failed: '진단 실패' };

// buildView 결과(view)와 normalizeState 결과(state)로 팝오버 한 벌을 만든다.
export function summarize(view, state) {
  const session = state.session.state;
  const connected = session === 'connected';
  const version = view.header.version;
  const badge = updateBadge(state);
  return {
    header: {
      avatar: view.account.avatar,
      name: view.account.name,
      subline: SUBLINE[session] || SUBLINE.error,
      showLogin: !connected,
      connected,
    },
    coin: { value: coinValue(view, state), known: view.account.walletKnown },
    ai: {
      modes: view.ai.modes.map((m) => ({ ...m, short: AI_MODE_SHORT[m.id] || m.label })),
      status: view.ai.status,
      statusState: view.ai.statusState,
    },
    update: { value: version ? `${version} · ${badge}` : badge, badge, attention: badge.startsWith('새 버전') || badge === '설치 준비됨' },
    repair: { value: REPAIR[state.repair.state] || REPAIR.idle },
    footer: { logoutVisible: connected, manageEnabled: !!view.enabled['account.manage'], historyEnabled: !!view.enabled['wallet.openHistory'] },
  };
}

// 팝오버 자리: 여는 단추 바로 아래, 화면 안쪽으로 밀어 넣는다. 꼬리(caret)는 단추 가운데를 가리킨다.
// 계정 단추는 제목줄 오른쪽에 있으므로 꼬리가 팝오버 오른쪽(끝에서 60px)에 오도록 먼저 놓고, 화면 밖이면 밀어 넣는다.
export function placePopover(anchor, viewport, { width = 410, margin = 8, gap = 10, caretInset = 22, caretFromRight = 60 } = {}) {
  const w = Math.min(width, Math.max(0, viewport.width - margin * 2));
  const center = anchor.left + anchor.width / 2;
  const left = Math.round(Math.max(margin, Math.min(center - (w - caretFromRight), viewport.width - margin - w)));
  const top = Math.round(anchor.bottom + gap);
  const caret = Math.round(Math.max(caretInset, Math.min(center - left, w - caretInset)));
  return { left, top, width: w, caret, maxHeight: Math.max(160, Math.round(viewport.height - top - margin)) };
}

// 버튼을 숨기지 않고 실제로 누를 수 없는 이유를 바로 보여 준다.
export function loginAvailability(state, { busy = false, supported = true, reason = null } = {}) {
  if (!supported) return { disabled: true, reason: reason || '이 앱에서는 아직 지원하지 않습니다.' };
  if (busy) return { disabled: true, reason: '요청을 처리하고 있습니다.' };
  const reasons = {
    authenticating: '브라우저에서 로그인을 마쳐 주세요.',
    connected: '이미 로그인되어 있습니다.',
    offline: '인터넷 연결을 확인해 주세요.',
    error: '계정 서버를 확인하지 못했습니다. 다시 열어 주세요.',
  };
  return { disabled: !!reasons[state.session.state], reason: reasons[state.session.state] || '' };
}
