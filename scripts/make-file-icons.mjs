// Windows 파일 종류 아이콘(build/file-*.ico)을 만든다 — 앱 아이콘(barun-cad.ico)과 같은 식구:
// 어두운 '문서' 모양(오른쪽 위 접힌 모서리) + 연두 테두리 + 아래 연두 빛 + 흰 "C." 표식 + 형식 색 배지(DWG 청록 · DXF 주황 · CAD 연두).
// 2026-09-30 사용자 시안 C 선택.
//
//   node scripts/make-file-icons.mjs                 build/file-*.ico 다시 만들기
//   node scripts/make-file-icons.mjs --preview DIR   크기별 PNG도 DIR에 남긴다(눈으로 확인용)
//   node scripts/make-file-icons.mjs --check         지금 파일이 이 스크립트 결과와 같은지만 확인(다르면 종료 코드 1)
//
// 만든 .ico 는 저장소에 넣어 두므로 설치 파일 빌드에는 이 스크립트가 필요 없다.
// 그리는 도구 @napi-rs/canvas 는 이 폴더에 없으면 바른 문서(D:\어플\바른문서) 것을 빌려 쓴다(개발 때만).
// 글꼴: Windows의 Segoe UI Bold 로 배지 글자를 그림으로 굳힌다(글꼴 파일은 싣지 않는다). 표식은 tools/icons/cad-mark.png.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const previewDir = argv.includes('--preview') ? path.resolve(argv[argv.indexOf('--preview') + 1]) : null;

function loadCanvas() {
  for (const base of [root, path.resolve(root, '..', '바른문서'), 'D:/어플/바른문서']) {
    try { return createRequire(path.join(base, 'package.json'))('@napi-rs/canvas'); } catch {}
  }
  throw new Error('@napi-rs/canvas 를 찾지 못했습니다 (이 폴더나 바른문서의 node_modules 필요)');
}
const { createCanvas, GlobalFonts, Path2D, loadImage } = loadCanvas();

const FONT_FILE = 'C:/Windows/Fonts/segoeuib.ttf';
if (!fs.existsSync(FONT_FILE)) throw new Error(`글꼴이 없습니다: ${FONT_FILE} (Windows에서 실행하세요)`);
GlobalFonts.registerFromPath(FONT_FILE, 'BarunIconBold');
const mark = await loadImage(path.join(root, 'tools', 'icons', 'cad-mark.png'));

// 파일 이름 → [배지 글자, 배지 밝은 색, 배지 짙은 색]. 테두리·빛은 모두 앱 연두.
const ICONS = {
  'file-dwg.ico': ['DWG', '#5fd4e0', '#1d9aa8'],
  'file-dxf.ico': ['DXF', '#ffcf5a', '#e0961f'],
  'file-bcad.ico': ['CAD', '#9dcbe0', '#4f8fae'],
};
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const LIGHT = '#9dcbe0', DEEP = '#4f8fae';   // 하늘색(바른 CAD 강조색) — 7.0.0 에서 연두에서 바꿈
// 64 단위 문서 모양: 오른쪽 위를 비스듬히 접은 둥근 네모.
const DOCUMENT = 'M14 2H40L60 22V46C60 57 55 62 44 62H20C9 62 4 57 4 46V18C4 7 7 2 14 2z';

const hexA = (hex, alpha) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; };

function draw(size, [label, light, deep]) {
  const canvas = createCanvas(size, size);
  const g = canvas.getContext('2d');
  const tiny = size <= 24, small = size <= 40;
  const grow = tiny ? 1.06 : 1;             // 작은 크기: 모양을 살짝 키워 가장자리 픽셀을 아낀다
  const k = (size / 64) * grow;
  g.translate(size / 2, size / 2); g.scale(k, k); g.translate(-32, -32);
  const shape = new Path2D(DOCUMENT);
  const bg = g.createLinearGradient(0, 0, 0, 64);
  bg.addColorStop(0, '#2c313b'); bg.addColorStop(1, '#1a1d23');
  g.fillStyle = bg; g.fill(shape);
  if (!tiny) {
    const glow = g.createRadialGradient(32, 64, 0, 32, 64, 51.2);
    glow.addColorStop(0, hexA(LIGHT, small ? 0.38 : 0.45)); glow.addColorStop(1, hexA(LIGHT, 0));
    g.fillStyle = glow; g.fill(shape);
  }
  const border = g.createLinearGradient(0, 0, 64, 64);
  border.addColorStop(0, LIGHT); border.addColorStop(1, DEEP);
  const px = size <= 16 ? 1.5 : size <= 24 ? 1.75 : size <= 48 ? 2 : null;
  g.save(); g.clip(shape);
  g.strokeStyle = border; g.lineWidth = 2 * (px ? px / k : 2.2); g.stroke(shape);
  g.restore();

  // 흰 "C." 표식(위쪽). 작은 크기는 배지 글자를 빼는 대신 표식을 키운다.
  const box = tiny ? 27 : 22, cy = tiny ? 23 : 25;
  const s = Math.min(box / mark.width, box / mark.height), mw = mark.width * s, mh = mark.height * s;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(mark, 32 - mw / 2, cy - mh / 2, mw, mh);

  // 형식 배지(아래): 색 띠. 32px 이상은 짙은 글자로 형식을 적는다.
  const badge = g.createLinearGradient(12, 0, 52, 0);
  badge.addColorStop(0, light); badge.addColorStop(1, deep);
  g.fillStyle = badge; g.beginPath();
  if (tiny) g.roundRect(10, 42, 44, 12, 3); else g.roundRect(12, 41, 40, 15, 4);
  g.fill();
  if (!tiny) {
    g.fillStyle = '#15171c'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    let font = 12; g.font = `${font}px BarunIconBold`;
    const maxWidth = small ? 36 : 34, w = g.measureText(label).width;
    if (w > maxWidth) { font = (font * maxWidth) / w; g.font = `${font}px BarunIconBold`; }
    const m = g.measureText(label);
    g.fillText(label, 32, 48.5 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }
  return canvas;
}

// ICO 항목: 256은 PNG, 나머지는 32비트 BMP(알파 + AND 마스크).
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  const rowBytes = Math.ceil(size / 32) * 4, mask = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const s = ((size - 1 - y) * size + x) * 4, d = (y * size + x) * 4;
    pixels[d] = rgba[s + 2]; pixels[d + 1] = rgba[s + 1]; pixels[d + 2] = rgba[s]; pixels[d + 3] = rgba[s + 3];
    if (rgba[s + 3] === 0) mask[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return Buffer.concat([header, pixels, mask]);
}
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
if (previewDir) fs.mkdirSync(previewDir, { recursive: true });
let changed = 0;
for (const [file, spec] of Object.entries(ICONS)) {
  const bytes = ico(SIZES.map((size) => {
    const canvas = draw(size, spec);
    const png = canvas.toBuffer('image/png');
    if (previewDir) fs.writeFileSync(path.join(previewDir, `${file.replace('.ico', '')}-${size}.png`), png);
    if (size >= 256) return { size, data: png };
    const { data } = canvas.getContext('2d').getImageData(0, 0, size, size);
    return { size, data: dib(size, data) };
  }));
  const target = path.join(root, 'build', file);
  const same = fs.existsSync(target) && sha256(fs.readFileSync(target)) === sha256(bytes);
  if (!same) changed++;
  if (!CHECK && !same) fs.writeFileSync(target, bytes);
  console.log(`${same ? '같음' : CHECK ? '다름' : '썼음'} build/${file} ${bytes.length}B sha256=${sha256(bytes).slice(0, 16)}…`);
}
if (CHECK) process.exit(changed ? 1 : 0);
