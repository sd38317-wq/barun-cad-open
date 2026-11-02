// 계정 창 공통 선 아이콘(직접 그린 일반 아이콘). 카카오 심볼·앱 아이콘은 공식 파일만 쓰므로 여기에 없다.
const svg = (body, size = 24) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = Object.freeze({
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  robot: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5M3 13v2M21 13v2"/><circle cx="12" cy="3.5" r="1"/>', 38),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>', 36),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 22),
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>', 22),
  check: svg('<path d="M5 12l4 4 10-10"/>', 20),
  alert: svg('<path d="M12 8v5M12 16.5h.01"/><circle cx="12" cy="12" r="9"/>', 20),
});
