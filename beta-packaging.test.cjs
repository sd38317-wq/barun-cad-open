const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Beta 5 installer is isolated from the regular Barun CAD installation',()=>{
 const config=JSON.parse(read('electron-builder.beta.json'));
 assert.equal(config.appId,'kr.barun.cad.beta5');
 assert.equal(config.productName,'arun CAD Beta 5');
 assert.equal(config.artifactName,'arun CAD Setup 5.exe');
 assert.equal(config.extraMetadata.version,'5.0.3-beta.12');
 assert.equal(config.directories.output,'installer-beta5');
 assert.equal(config.fileAssociations,undefined);
 assert.equal(config.publish,null);
 assert.deepEqual(config.extraResources,[{from:'desktop-backend-beta/arun-cad-beta-server',to:'backend-beta',filter:['**/*']}]);
 const installer=read('build/installer-beta.nsh');
 assert.match(installer,/Barun\\arun CAD Beta 5/);
 assert.match(installer,/arun CAD Beta 5\.lnk/);
 assert.doesNotMatch(installer,/바른 CAD\.lnk/);
});

test('Beta desktop runtime uses its own data, backend, port and UI marker',()=>{
 const desktop=read('desktop.cjs');
 assert.match(desktop,/betaRuntime=\(\)=>app\.isPackaged&&\/beta\/i\.test\(packagedExecutableName\(\)\)/);
 assert.match(desktop,/betaRuntime\(\)\?18766:official5Runtime\(\)\?18767:official6Runtime\(\)\?18768:18765/);
 assert.match(desktop,/arun CAD Beta 5/);
 assert.match(desktop,/'backend-beta\/arun-cad-beta-server'/);
 assert.match(desktop,/\?beta=5/);
 // 베타·5 는 자동 업데이트를 하지 않는다(6 은 자동 업데이트).
 assert.match(desktop,/if\(!app\.isPackaged\|\|betaRuntime\(\)\|\|official5Runtime\(\)\)return;/);
 const build=read('build_desktop.py');
 assert.match(build,/beta='--beta' in sys\.argv/);
 assert.match(build,/electron-builder\.beta\.json/);
 assert.match(build,/arun CAD Setup 5\.exe/);
});
