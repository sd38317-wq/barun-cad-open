import {referenceCommands} from './reference-command-catalog.js';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const CATEGORY_COLORS=Object.freeze({
 '기타':'#77c7bd','자르기 및 끌기':'#ef8f73','도형 및 선':'#76aef7','면적 및 계산':'#c6a8ff',
 '열기, 닫기 및 설정':'#e4b96a','멀티도구':'#77d38b','그리기':'#66cbe8','블럭 및 외부참조':'#dc96ca',
 '문자 수정':'#f0a276','선택':'#83c7f4','레이어':'#77d8b0','종이공간':'#b0a7ef','문자 생성 및 증가':'#f0c96e',
 '기호':'#f08da3','출력 및 저장':'#9eb4c6','치수':'#b4d877','해치 및 표':'#d7ad75','도곽 관련':'#86b9e6','도형 및 기호':'#a6cf82'
});

// The main glyph always describes the CAD subject. Random per-command marks are
// intentionally avoided: equal objects keep the same visual language everywhere.
// 24-unit grid, single-colour outline (stroke inherits currentColor).
const SUBJECT_GLYPHS=Object.freeze({
 settings:'<path d="M10.3 4.3c.4-1.8 3-1.8 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.4 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.5.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-3 0-3.4a1.7 1.7 0 0 0 1-2.5c-.9-1.6.9-3.3 2.4-2.4 1 .6 2.3.1 2.6-1.1z"/><circle cx="12" cy="12" r="3"/>',
 object:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
 selection:'<path d="M5 4l13 4.5-5.5 2L18 16l-2 2-5.5-5.5-2 5.5z"/>',
 line:'<path d="M6.1 17.9L17.9 6.1"/><circle cx="5" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
 polyline:'<path d="M3 17l5-9 6 8 7-11"/>',
 curve:'<path d="M4 18c2-10 14-10 16 0"/>',
 circle:'<circle cx="12" cy="12" r="8"/><path d="M12 12h.01"/>',
 rectangle:'<rect x="4" y="6" width="16" height="12" rx="1"/>',
 polygon:'<path d="M12 3.5l8 6-3 9.5H7l-3-9.5z"/>',
 area:'<path d="M5 19l2-13 11 2 2 11z"/><path d="M9 15h7M10 11h5"/>',
 calculator:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8v3H8zM8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01M16 17h.01"/>',
 measure:'<path d="M4 15L15 4l5 5L9 20z"/><path d="M8 11l2 2M11 8l2 2M14 5l1.5 1.5M5 14l1.5 1.5"/>',
 file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
 folder:'<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/>',
 printer:'<path d="M17 17h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2M17 9V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v4"/><rect x="7" y="13" width="10" height="8" rx="2"/>',
 block:'<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="8" y="8" width="8" height="8"/>',
 xref:'<path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6M11 13l9-9M15 4h5v5"/>',
 group:'<rect x="3" y="3" width="11" height="11" rx="1"/><path d="M17 10h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-3"/>',
 text:'<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
 number:'<path d="M4 8l2-2v12M10 8.5a2.5 2.5 0 0 1 5 0c0 3-5 5-5 9.5h5M18 6h3l-2 4a2.5 2.5 0 1 1-2.2 4"/>',
 layer:'<path d="M12 4L4 8l8 4 8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
 layout:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
 viewport:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9" r="1"/>',
 dimension:'<path d="M4 7v10M20 7v10M4 12h16M7 9.5L4 12l3 2.5M17 9.5l3 2.5-3 2.5"/>',
 leader:'<path d="M5 19l8-8h6M5 19l1-4M5 19l4-1"/>',
 hatch:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12l8-8M4 20L20 4M12 20l8-8"/>',
 table:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M3 15h18M9 5v14M15 5v14"/>',
 frame:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M13 15h8M13 15v5M6 8h5"/>',
 axis:'<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/>',
 arrow:'<path d="M5 19L19 5M10 5h9v9"/>',
 symbol:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
 level:'<path d="M3 16h18M8.5 10h7L12 16z"/>',
 slope:'<path d="M3 19h18L3 7z"/><path d="M7 19a4 4 0 0 0-1.5-3.2"/>',
 section:'<path d="M3 12h18M6 8v8M18 8v8M6 8L3 10M18 16l3-2"/>',
 cloud:'<path d="M6.7 18C4.1 18 2 15.9 2 13.4s2.1-4.6 4.7-4.6C7.1 6 9.5 4 12.3 4c3 0 5.5 2.2 5.8 5.2 2.1.3 3.9 2.1 3.9 4.3 0 2.5-2 4.5-4.4 4.5z"/>',
 wall:'<rect x="3" y="6" width="18" height="12"/><path d="M3 12h18M9 6v6M15 12v6"/>',
 door:'<path d="M4 20h16M6 20V6"/><path d="M6 6a14 14 0 0 1 14 14"/>',
 window:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
 stair:'<path d="M3 20h4v-4h4v-4h4V8h4V4h2"/>',
 'curved-stair':'<path d="M4 20A16 16 0 0 1 20 4M9 20A11 11 0 0 1 20 9M14 20a6 6 0 0 1 6-6"/>',
 column:'<rect x="8" y="5" width="8" height="14"/><path d="M5 5h14M5 19h14"/>',
 beam:'<path d="M3 8h18M3 16h18M6 8v8M18 8v8"/>',
 steel:'<path d="M6 4h12M6 20h12M12 4v16"/>',
 truss:'<path d="M3 18h18L12 6z"/><path d="M7.5 12l4.5 6 4.5-6"/>',
 railing:'<path d="M3 7h18M6 7v12M10 7v12M14 7v12M18 7v12"/>',
 parking:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
 vehicle:'<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17H3v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2M9 17h6M6 11h12"/>',
 elevator:'<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M10 10l2-2 2 2M10 14l2 2 2-2"/>',
 ramp:'<path d="M3 19h18V7z"/><path d="M9 15.5l6-3.5"/>',
 escalator:'<path d="M3 17h4l9-10h5M3 21h5l9-10h4"/>',
 insulation:'<path d="M3 9c2-3 4 3 6 0s4 3 6 0 4 3 6 0M3 16c2-3 4 3 6 0s4 3 6 0 4 3 6 0"/>',
 drainage:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v5M12 15v5M4 12h5M15 12h5"/>',
 furniture:'<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v3h12v-3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v6H3zM5 17v2M19 17v2"/>',
 qr:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 20h2M18 18v2h2"/>',
 calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
 flag:'<path d="M5 21V4M5 4c3-2 6 2 9 0s4-1 5 0v9c-1-1-2-2-5 0s-6-2-9 0"/>',
 contour:'<path d="M3 8c4-3 6 2 10 0s6-2 8 0M3 13c4-3 6 2 10 0s6-2 8 0M3 18c4-3 6 2 10 0s6-2 8 0"/>',
 grid:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
 stamp:'<path d="M5 20h14M6 16h12v4H6zM9 16l1-5h4l1 5M10 11a3 3 0 1 1 4 0"/>',
 mask:'<rect x="4" y="5" width="16" height="14" rx="2" fill="currentColor" fill-opacity=".15"/><path d="M8 10h8M8 14h5"/>',
 generic:'<path d="M5.2 15.9L8 10.5M9.3 10.3l4.4 5.4M15.3 15.2l3.5-8.4"/><circle cx="4.5" cy="17.5" r="1.5"/><circle cx="8.5" cy="9" r="1.5"/><circle cx="14.5" cy="17" r="1.5"/><circle cx="19.5" cy="5" r="1.5"/>'
});

// The small accent badge in the bottom-right says what happens to that subject.
const ACTION_GLYPHS=Object.freeze({
 settings:'<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h11M19 18h1"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
 add:'<path d="M12 5v14M5 12h14"/>',draw:'<path d="M4 20l1-4L16 5l3 3L8 19zM14 20h6"/>',edit:'<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
 delete:'<path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',cut:'<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6L20 18M8.6 15.4L20 6"/>',
 extend:'<path d="M4 20L18 6M12 6h6v6"/>',join:'<path d="M3 12h7M21 12h-7M7 8l4 4-4 4M17 8l-4 4 4 4"/>',split:'<path d="M12 4v16M3 12h6M15 12h6M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
 copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',move:'<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
 rotate:'<path d="M19 12a7 7 0 1 1-2-5M19 4v4h-4"/>',mirror:'<path d="M12 3v18M9 7l-5 5 5 5zM15 7l5 5-5 5z"/>',scale:'<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
 offset:'<path d="M4 16L16 4M8 20L20 8"/>',align:'<path d="M4 4v16M8 7h12M8 12h8M8 17h10"/>',convert:'<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
 replace:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M14 6h4v4M10 18H6v-4"/>',
 open:'<path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1M3 17l3-7h15l-3 8H4a1 1 0 0 1-1-1"/>',close:'<path d="M6 6l12 12M18 6L6 18"/>',
 save:'<path d="M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1M8 4v5h7V4M8 20v-6h8v6"/>',backup:'<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4l3 2"/>',
 export:'<path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',import:'<path d="M12 3v12M8 11l4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
 print:'<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="13" width="10" height="8" rx="1"/>',
 refresh:'<path d="M20 11A8 8 0 0 0 5 8M4 4v4h4M4 13a8 8 0 0 0 15 3M20 20v-4h-4"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
 unlock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',freeze:'<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M10 4l2 2 2-2M10 20l2-2 2 2"/>',
 thaw:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
 show:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',hide:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M4 4l16 16"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>',list:'<path d="M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01"/>',count:'<path d="M5 9h14M5 15h14M11 4L9 20M15 4l-2 16"/>',
 measure:'<path d="M4 16L16 4l4 4L8 20zM8 12l2 2M11 9l2 2M14 6l2 2"/>',calculate:'<path d="M5 7h6M8 4v6M14 7h6M5 13l5 5M10 13l-5 5M14 14h6M14 18h6"/>',
 increase:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',decrease:'<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>',reverse:'<path d="M7 4L4 7l3 3M4 7h16M17 20l3-3-3-3M20 17H4"/>',
 random:'<path d="M3 7h3a5 5 0 0 1 4 2l4 6a5 5 0 0 0 4 2h3M18 14l3 3-3 3M3 17h3a5 5 0 0 0 4-2M14 9a5 5 0 0 1 4-2h3M18 4l3 3-3 3"/>',
 verify:'<path d="M5 12l5 5L20 7"/>',inspect:'<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
 purge:'<path d="M19 20H8.5l-4.2-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4L12 20M18 13.3L11.7 7"/>',explode:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
 mask:'<rect x="4" y="5" width="16" height="14" rx="2" style="fill:var(--icon-accent,#bedb71);fill-opacity:.3"/><path d="M8 10h8M8 14h5"/>',none:''
});

const SUBJECT_RULES=Object.freeze([
 ['qr',/QR\s*코드/i],['calendar',/날짜|달력/],['flag',/태극기/],['parking',/주차/],['vehicle',/차량|동선/],
 ['escalator',/에스컬레이터/],['elevator',/엘리베이터/],['stair',/계단/],['door',/(?:간단|상세|평면)?문\s*(?:그리기|회전)|문짝/],
 ['window',/창호|미서기창|간단창|개구부/],['wall',/커튼월|벽체|벽그리기|벽\s*그리기/],['railing',/난간/],['furniture',/주방가구|화장실/],
 ['insulation',/단열재|바닥난방|XL파이프/],['drainage',/배수|우오수/],['truss',/트러스/],['column',/기둥/],['beam',/보\s*(?:배근|스케쥴|일람표)|철골보/],['steel',/H빔|C채널|L형강/],
 ['contour',/등고선|사면/],['cloud',/구름형/],['section',/절단면|단면도|입면/],['level',/레벨/],['slope',/경사도/],['arrow',/화살표|방향/],
 ['axis',/작업축|중심선/],['stamp',/도장/],['mask',/마스크|음영|배경/],['frame',/도곽/],['viewport',/뷰포트|Viewport/i],['layout',/종이공간|배치|탭이름/],
 ['xref',/외부참조|xref|Xclip/i],['block',/블럭|블록|WBLOCK/i],['leader',/지시선/],['dimension',/치수/],['hatch',/해치|솔리드|콘크리트|줄눈|잡석/],
 ['table',/테이블|표를|표로|표\s*만들|면적표|구적표|목록표|스케쥴|일람표/],['layer',/레이어|\bLayer\b|\b켜\b|켜설정|켜상태|켜색|켜로|켜를/i],
 ['number',/숫자|수치|소숫점|소수점|사칙연산|천단위/],['text',/문자|글씨|문장|글꼴|제목|접두어|접미어|스타일/],['printer',/출력|플롯/i],['folder',/폴더|탐색기/],
 ['file',/파일|도면\s*(?:열기|닫기|저장|백업)|저장없이/],['area',/면적|구적/],['measure',/거리|길이|가로X세로|축척\s*확인/],['selection',/선택|골라/],['grid',/그리드|격자/],
 ['circle',/원\s*그리기|접원|원형|호를/],['rectangle',/사각형|박스/],['polygon',/삼각형|도형안|폴리도형/],['polyline',/폴리선|Pline|폴리/],['curve',/곡선|곡면|호\b/],
 ['group',/그룹/],['settings',/설정|초기|단축키|사용환경/]
]);

const CATEGORY_SUBJECT=Object.freeze({
 '기타':'object','자르기 및 끌기':'line','도형 및 선':'line','면적 및 계산':'calculator','열기, 닫기 및 설정':'file','멀티도구':'object','그리기':'object',
 '블럭 및 외부참조':'block','문자 수정':'text','선택':'selection','레이어':'layer','종이공간':'layout','문자 생성 및 증가':'text','기호':'symbol',
 '출력 및 저장':'file','치수':'dimension','해치 및 표':'hatch','도곽 관련':'frame','도형 및 기호':'symbol'
});

const ACTION_RULES=Object.freeze([
 ['backup',/백업/],['print',/출력|플롯/i],['export',/내보내기|외부파일로|엑셀로 보내기|파일로 분리/],['import',/불러오기|훔쳐오기|가져오기|삽입하기|캐드.*보내기/],
 ['save',/저장/],['open',/열기|탐색기/],['close',/닫기/],['refresh',/다시\s*읽기|업데이트|복구|재열기/],['purge',/퍼지|정리하기|자동 정리/],['explode',/폭파|분해/],
 ['delete',/삭제|지우기|제거/],['cut',/자르|절단|끊기/],['extend',/연장/],['offset',/옵셋|offset|간격\s*띄우기|띄우기/i],['join',/합치|병합|이어주기|연결/],
 ['split',/분리|분할|나누기|잘라서/],['copy',/복사/],['rotate',/회전/],['mirror',/미러|반전/],['scale',/축척\s*(?:변경|수정)?|크기변경|확대/],['move',/이동|보내기/],
 ['align',/정렬|원위치|중심으로/],['replace',/교체|찾아\s*바꾸기/],['convert',/변환|->|로\s*변경|로\s*바꾸기|일반.*로|다행.*로/],['lock',/잠금/],['unlock',/풀림|잠금해제/],
 ['freeze',/얼림|동결/],['thaw',/녹임|해동/],['hide',/끄기|꺼진|\bOFF\b|감추기|제외하고\s*끔|선택\s*끔/i],['show',/켜기|\bON\b|표시|보이기/i],['search',/찾기|찾아|골라/],
 ['list',/목록|리스트|창고/],['count',/세기|개수/],['calculate',/계산|연산|합산|더해서|배분/],['increase',/증가/],['decrease',/감소/],['random',/무작위/],
 ['reverse',/순서\s*바꾸기|서로\s*교체/],['mask',/마스크|음영|배경/],['verify',/검토|확인/],['inspect',/정보|상태|연관\s*객체/],['settings',/설정|초기/],
 ['edit',/수정|변경|조정|보정/],['add',/입력|넣기|삽입|포함시키기|생성|기입/],['draw',/그리기|작성|만들기|표현하기/],['measure',/거리|길이|면적|축척/]
]);

const CATEGORY_ACTION=Object.freeze({
 '기타':'edit','자르기 및 끌기':'cut','도형 및 선':'edit','면적 및 계산':'calculate','열기, 닫기 및 설정':'settings','멀티도구':'edit','그리기':'draw',
 '블럭 및 외부참조':'edit','문자 수정':'edit','선택':'search','레이어':'edit','종이공간':'edit','문자 생성 및 증가':'add','기호':'draw',
 '출력 및 저장':'save','치수':'edit','해치 및 표':'edit','도곽 관련':'edit','도형 및 기호':'draw'
});

const OVERRIDES=Object.freeze({
 '기타|DTS':{subject:'calendar',action:'add',modifiers:[]},'도형 및 선|PAA':{subject:'arrow',action:'draw'},'도형 및 선|PC':{subject:'polyline',action:'close'},
 '도형 및 선|PV':{subject:'polyline',action:'add'},'도형 및 선|PVV':{subject:'polyline',action:'delete'},'도형 및 선|DRL':{subject:'line',action:'reverse'},
 '자르기 및 끌기|BAT':{subject:'line',action:'cut',modifiers:['edit']},'자르기 및 끌기|XT':{subject:'line',action:'cut',modifiers:['extend']},
 '멀티도구|CR':{subject:'object',action:'copy',modifiers:['rotate']},'멀티도구|OE':{subject:'polyline',action:'offset',modifiers:['delete']},
 '멀티도구|OC':{subject:'polyline',action:'offset',modifiers:['join']},'멀티도구|SB':{subject:'object',action:'move'},
 '그리기|CW':{subject:'wall',action:'draw'},'그리기|D1':{subject:'door',action:'draw'},'그리기|D2, D3':{subject:'door',action:'draw'},
 '그리기|W1':{subject:'window',action:'draw'},'그리기|W2,W3':{subject:'window',action:'draw'},'그리기|QRC':{subject:'qr',action:'draw'},
 '블럭 및 외부참조|B2X':{subject:'block',action:'convert',modifiers:['export']},'블럭 및 외부참조|BEX':{subject:'block',action:'export'},
 '블럭 및 외부참조|QWB':{subject:'block',action:'export'},'레이어|LTG':{subject:'layer',action:'reverse'},'레이어|LO':{subject:'layer',action:'show'},
 '레이어|LOO':{subject:'layer',action:'thaw'},'레이어|LK':{subject:'layer',action:'lock'},'레이어|LU':{subject:'layer',action:'unlock'},'레이어|LLL':{subject:'layer',action:'freeze'},
 '종이공간|VL':{subject:'viewport',action:'lock'},'종이공간|VU':{subject:'viewport',action:'unlock'},'출력 및 저장|BAK':{subject:'file',action:'backup',modifiers:[]},
 '출력 및 저장|PPP':{subject:'printer',action:'print',modifiers:['list']},'출력 및 저장|SVS':{subject:'file',action:'export',modifiers:['split']},
 '출력 및 저장|PB':{subject:'rectangle',action:'draw',modifiers:['print']},'해치 및 표|C2E':{subject:'table',action:'export'},'해치 및 표|E2C':{subject:'table',action:'import'},
  '도곽 관련|DBC':{subject:'frame',action:'copy'},'도곽 관련|DBS':{subject:'frame',action:'align'},'도곽 관련|DFS':{subject:'frame',action:'verify',modifiers:['scale']}
 ,'그리기|DOOR':{subject:'door',action:'draw'},'그리기|WINDOW':{subject:'window',action:'draw'},'그리기|STAIR':{subject:'stair',action:'draw'},
 '그리기|CURVESTAIR':{subject:'curved-stair',action:'draw'},'그리기|COLUMN':{subject:'column',action:'draw'},'그리기|ELEVATOR':{subject:'elevator',action:'draw'},
 '그리기|RAMP':{subject:'ramp',action:'draw'},'그리기|INSULATION':{subject:'insulation',action:'draw'}
 });

const subjectFor=command=>{
 for(const [subject,pattern] of SUBJECT_RULES)if(pattern.test(command.label))return subject;
 return CATEGORY_SUBJECT[command.category]||'generic';
};

const actionsFor=command=>{
 const result=[];
 for(const [action,pattern] of ACTION_RULES)if(pattern.test(command.label)&&!result.includes(action))result.push(action);
 return result.length?result:[CATEGORY_ACTION[command.category]||'edit'];
};

export function referenceCommandIconDescriptor(command){
 const detected=actionsFor(command),override=OVERRIDES[`${command.category}|${command.alias}`]||{};
 const subject=override.subject||subjectFor(command),action=override.action||detected[0];
 const modifiers=(override.modifiers||detected.filter(item=>item!==action)).slice(0,2);
 return {subject,action,modifiers,color:CATEGORY_COLORS[command.category]||'#9dc8d7'};
}

export const referenceCommandIconFamily=command=>referenceCommandIconDescriptor(command).subject;

const actionGlyph=name=>ACTION_GLYPHS[name]??ACTION_GLYPHS.edit;

const RESULT_ACTIONS=new Set(['copy','move','mirror','scale','offset','align','convert','replace','export','import']);
const DESTRUCTIVE_ACTIONS=new Set(['delete','cut','split','purge','explode']);
const FILE_ACTIONS=new Set(['open','close','save','backup','print','export','import']);

const QUALIFIER_RULES=Object.freeze([
 ['all',/모든|전체|일괄/],['multiple',/여러|다중|복수|연속/],['inside',/안의|내부|안쪽/],['outside',/외부|밖/],
 ['current',/현재/],['same',/같은|동일/],['zero',/\b0\b|0으로/],['value',/값|수치/],['center',/중심|가운데/],
 ['end',/끝점|단부|모서리/],['direction',/방향|순서/],['sheet',/도면|배치|종이/],['selected',/선택|골라/]
]);

const QUALIFIER_GLYPHS=Object.freeze({
 all:'<path d="M1 3h8M1 6h8M1 9h8"/>',multiple:'<rect x="1" y="2" width="6" height="6"/><rect x="4" y="5" width="6" height="6"/>',
 inside:'<rect x="1" y="1" width="10" height="10"/><circle cx="6" cy="6" r="2"/>',outside:'<rect x="3" y="3" width="6" height="6"/><circle cx="1" cy="1" r="1"/><circle cx="11" cy="11" r="1"/>',
 current:'<path d="M1 6h10M6 1v10"/><circle cx="6" cy="6" r="3"/>',same:'<path d="M1 4h10M1 8h10"/>',
 zero:'<circle cx="6" cy="6" r="5"/><path d="M2 10L10 2"/>',value:'<path d="M1 2h10L8 6l3 4H1l3-4z"/>',
 center:'<circle cx="6" cy="6" r="4"/><circle cx="6" cy="6" r="1"/>',end:'<path d="M1 10L10 1"/><circle cx="10" cy="1" r="2"/>',
 direction:'<path d="M1 6h10M7 2l4 4-4 4"/>',sheet:'<path d="M2 1h7l2 2v8H2zM9 1v3h2"/>',selected:'<path d="M1 1l4 10 2-4 4-2z"/>'
});

const qualifiersFor=command=>{
 const result=[];
 for(const [name,pattern] of QUALIFIER_RULES)if(pattern.test(command.label)&&!result.includes(name))result.push(name);
 return result.slice(0,2);
};

const sourceIndexFor=command=>{
 const exact=referenceCommands.findIndex(item=>item.id===command.id);
 if(exact>=0)return exact+1;
 let hash=0;
 for(const char of `${command.category}|${command.alias}|${command.label}`)hash=((hash*31)+char.codePointAt(0))>>>0;
 return (hash%511)+1;
};

// A 3x3 CAD-node strip is a secondary identification mark. It never replaces
// the semantic drawing, but guarantees that commands with similar wording are
// still visually distinguishable at a glance.
const identityNodes=(command,color)=>{
 const value=sourceIndexFor(command);
 let dots='';
 for(let bit=0;bit<9;bit++){
  const x=45+(bit%3)*4,y=45+Math.floor(bit/3)*4;
  dots+=`<circle cx="${x}" cy="${y}" r="${value&(1<<bit)?1.35:.65}" ${value&(1<<bit)?`fill="${color}"`:`fill="none" stroke="${color}" stroke-opacity=".38"`}/>`;
 }
 return `<g class="icon-identity" data-icon-index="${value}">${dots}</g>`;
};

const qualifierMarkup=(qualifiers,color)=>qualifiers.map((name,index)=>`<g class="icon-qualifier" data-qualifier="${name}" transform="translate(${7+(index*14)} 44)" fill="none" stroke="${color}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${QUALIFIER_GLYPHS[name]}</g>`).join('');

// Subject sits in the top-left 42 units; the action badge takes the bottom-right corner in the accent colour.
const semanticScene=(subject,action)=>{
 const core=SUBJECT_GLYPHS[subject]||SUBJECT_GLYPHS.generic;
 const actionCore=actionGlyph(action);
 return `<g class="icon-subject" transform="translate(4 4) scale(1.75)" stroke-width="1.25">${core}</g>${actionCore?`<g class="icon-action" data-action="${action}" transform="translate(44 44) scale(.75)" stroke-width="2" style="stroke:var(--icon-accent,#bedb71)">${actionCore}</g>`:''}`;
};

export function referenceCommandVisualKey(command){
 const {subject,action,modifiers}=referenceCommandIconDescriptor(command);
 return [subject,action,command.aliases?.[0]||command.alias||'CAD',command.id].join('|');
}

export function referenceCommandIconSvg(command,{compact=false}={}){
 const {subject,action,modifiers,color}=referenceCommandIconDescriptor(command);
 const alias=escape((command.aliases?.[0]||command.alias||'CAD').slice(0,8)),label=escape(command.label);
 const scene=semanticScene(subject,action);
 const visualKey=escape(referenceCommandVisualKey(command));
 return `<svg data-command-id="${escape(command.id)}" data-icon-family="${escape(subject)}" data-icon-subject="${escape(subject)}" data-icon-action="${escape(action)}" data-icon-visual-key="${visualKey}" class="reference-command-icon${compact?' compact':''}" viewBox="0 0 64 64" role="img" aria-label="${label}"><title>${label} · ${alias}</title><g class="icon-scene" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${scene}</g></svg>`;
}

export function validateReferenceCommandIcons(){
 const icons=referenceCommands.map(command=>referenceCommandIconSvg(command));
 const descriptors=referenceCommands.map(referenceCommandIconDescriptor);
 const combinations=descriptors.map(item=>[item.subject,item.action,...item.modifiers].join('|'));
 const visualKeys=referenceCommands.map(referenceCommandVisualKey);
 return {total:icons.length,unique:new Set(icons).size,uniqueVisuals:new Set(visualKeys).size,families:new Set(descriptors.map(item=>item.subject)).size,subjects:new Set(descriptors.map(item=>item.subject)).size,actions:new Set(descriptors.map(item=>item.action)).size,combinations:new Set(combinations).size,valid:icons.every(icon=>/^<svg/.test(icon)&&/<title>/.test(icon)&&!/<script|onload=|javascript:/i.test(icon))};
}
