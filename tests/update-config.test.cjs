const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');

/* 5.0.5 갱신: 예전 GitHub 배포 주소·quitAndInstall 기대는 현재 설계와 다르다.
   - 기본 빌드(package.json build.publish)는 바른 서버(barunarc.co.kr) generic 피드를 https 로만 본다.
   - 정식 5(electron-builder.official5.json)는 publish:null 로 자동업데이트를 쓰지 않는다(분리 설치판).
   - 받아 둔 업데이트는 작업 도중 quitAndInstall 로 끊지 않고, 앱을 닫을 때 autoInstallOnAppQuit 로 적용한다. */
test('online updater uses the Barun generic https update feed',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.build.publish.length,1);
  assert.equal(pkg.build.publish[0].provider,'generic');
  assert.match(pkg.build.publish[0].url,/^https:\/\/barunarc\.co\.kr\//);
  const official=JSON.parse(fs.readFileSync(path.join(root,'electron-builder.official5.json'),'utf8'));
  assert.equal(official.publish,null);
});

test('updates download in the background and install only when the app closes',()=>{
  const source=fs.readFileSync(path.join(root,'desktop.cjs'),'utf8');
  assert.match(source,/autoDownload\s*=\s*true/);
  assert.match(source,/autoInstallOnAppQuit\s*=\s*true/);
  assert.match(source,/setInterval\(\(\)=>up\.checkForUpdates\(\)/);
  assert.doesNotMatch(source,/quitAndInstall\(/);
  assert.match(source,/official5Runtime\(\)\)return/);
});
