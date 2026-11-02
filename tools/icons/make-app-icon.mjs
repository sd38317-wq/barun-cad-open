// 바른 CAD 앱 아이콘(barun-cad.ico, barun-cad-brand.png)을 만든다.
// 파일 종류 아이콘(build/file-*.ico)과 같은 틀: 어두운 둥근 네모 + 아래 하늘색 빛 + 하늘색 테두리 + 흰 "C." 표식.
// 표식은 tools/icons/cad-mark.png(흰색·투명도, 예전 로고에서 떼어 낸 모양)를 그대로 쓴다.
//
//   node tools/icons/make-app-icon.mjs                 barun-cad.ico, barun-cad-brand.png 다시 만들기
//   node tools/icons/make-app-icon.mjs --preview DIR   크기별 PNG도 DIR에 남긴다
//   node tools/icons/make-app-icon.mjs --check         지금 파일이 이 스크립트 결과와 같은지만 확인(다르면 종료 코드 1)
//
// 그림 도구 @napi-rs/canvas 는 바른 CAD 의존성이 아니다. 이 폴더에서 찾지 못하면 바른 문서(D:\어플\바른문서)의 것을 쓴다.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const canvasModule = (() => {
  for (const base of [path.join(root, 'package.json'), 'D:/어플/바른문서/package.json']) {
    try { return createRequire(base)('@napi-rs/canvas'); } catch {}
  }
  throw new Error('@napi-rs/canvas 를 찾지 못했습니다(바른 CAD 또는 D:\\어플\\바른문서 의 node_modules).');
})();
const { createCanvas, loadImage, Path2D } = canvasModule;

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const previewDir = argv.includes('--preview') ? path.resolve(argv[argv.indexOf('--preview') + 1]) : null;

const LIGHT = '#9dcbe0', DEEP = '#4f8fae'; // 하늘색(바른 CAD 강조색 #9dcbe0) 밝은·짙은 짝 — 7.0.0 에서 연두에서 바꿈
const SQUIRCLE = 'M32 2C9 2 2 9 2 32s7 30 30 30 30-7 30-30S55 2 32 2z'; // 파일 아이콘과 같은 64 단위 모양
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const mark = await loadImage(path.join(here, 'cad-mark.png'));

function draw(size) {
  const canvas = createCanvas(size, size), g = canvas.getContext('2d');
  const tiny = size <= 24, small = size <= 40;
  const k = (size / 64) * (tiny ? 1.06 : 1);
  g.save(); g.translate(size / 2, size / 2); g.scale(k, k); g.translate(-32, -32);
  const shape = new Path2D(SQUIRCLE);
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
  g.save(); g.clip(shape); g.strokeStyle = border; g.lineWidth = 2 * (px ? px / k : 2.2); g.stroke(shape); g.restore();
  g.restore();
  // 표식: 작은 크기일수록 칸을 더 채워 알아보기 쉽게 한다.
  const box = size * (tiny ? 0.66 : small ? 0.6 : 0.54), s = Math.min(box / mark.width, box / mark.height);
  const w = mark.width * s, h = mark.height * s;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(mark, (size - w) / 2, (size - h) / 2 + size * 0.01, w, h);
  return canvas;
}

// ICO 항목: 256은 PNG, 나머지는 32비트 BMP(DIB: 알파 + AND 마스크).
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

if (previewDir) fs.mkdirSync(previewDir, { recursive: true });
const outputs = {
  'barun-cad.ico': ico(ICO_SIZES.map((size) => {
    const canvas = draw(size), png = canvas.toBuffer('image/png');
    if (previewDir) fs.writeFileSync(path.join(previewDir, `barun-cad-${size}.png`), png);
    if (size >= 256) return { size, data: png };
    return { size, data: dib(size, canvas.getContext('2d').getImageData(0, 0, size, size).data) };
  })),
  'barun-cad-brand.png': draw(512).toBuffer('image/png'),
};
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
let changed = 0;
for (const [file, bytes] of Object.entries(outputs)) {
  const target = path.join(root, file);
  const same = fs.existsSync(target) && sha256(fs.readFileSync(target)) === sha256(bytes);
  if (!same) changed++;
  if (!CHECK && !same) fs.writeFileSync(target, bytes);
  console.log(`${same ? '같음' : CHECK ? '다름' : '썼음'} ${file} ${bytes.length}B sha256=${sha256(bytes).slice(0, 16)}…`);
}
if (CHECK) process.exit(changed ? 1 : 0);
