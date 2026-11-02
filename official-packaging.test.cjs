const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('official 5 installer stays beside 3.4.5 without taking its associations or updater',()=>{
 const config=JSON.parse(read('electron-builder.official5.json'));
 assert.equal(config.appId,'kr.barun.cad.v5');
 assert.equal(config.productName,'Barun CAD 5');
 assert.equal(config.extraMetadata.version,'5.0.7');
 assert.equal(config.directories.output,'installer-5.0.7');
 assert.equal(config.artifactName,'Barun CAD 5 Setup 5.0.7.exe');
 assert.equal(config.fileAssociations,undefined);
 assert.equal(config.publish,null);
 assert.deepEqual(config.extraResources,[{from:'desktop-backend-5.0.7/barun-cad-5-server',to:'backend',filter:['**/*']}]);
 const installer=read('build/installer-official5.nsh');
 assert.match(installer,/Barun\\Barun CAD 5/);
 assert.match(installer,/바른 CAD 5\.lnk/);
 assert.doesNotMatch(installer,/Delete "\$DESKTOP\\바른 CAD\.lnk"/);
});

test('official 5 runtime has separate user data, engine, port and no file-association takeover',()=>{
 const desktop=read('desktop.cjs'),build=read('build_desktop.py');
 assert.match(desktop,/packagedExecutableName=\(\)=>path\.basename\(process\.execPath,'\.exe'\)/);
 assert.match(desktop,/official5Runtime\(\)\?18767/);
 assert.match(desktop,/Barun CAD 5/);
 assert.match(desktop,/backend\/barun-cad-5-server\.exe/);
 assert.match(desktop,/betaRuntime\(\)\|\|official5Runtime\(\)/);
 assert.match(build,/official5='--official5' in sys\.argv/);
 assert.match(build,/electron-builder\.official5\.json/);
 assert.match(build,/Barun CAD 5 Setup \{version\}\.exe/);
});
