const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {forbiddenDataPath,assertPackagedDataExcluded}=require('./build/packaged-data-policy.cjs');
test('release source configuration explicitly selects app files and no external collection',()=>{
 const configs=[require('./package.json').build,...['official5','official6','beta'].map(name=>JSON.parse(fs.readFileSync('electron-builder.'+name+'.json','utf8')))];
 for(const config of configs){assert.ok(config.files.length);for(const file of config.files){const pattern=typeof file==='string'?file:file.from;assert.ok(!forbiddenDataPath(pattern),pattern);assert.ok(pattern!=='**/*'&&pattern!=='.',pattern);}for(const extra of config.extraResources||[]){assert.ok(!forbiddenDataPath(typeof extra==='string'?extra:extra.from));assert.ok(!forbiddenDataPath(extra.to||''));}}
 assert.match(fs.readFileSync('build/verify-packaged.cjs','utf8'),/assertPackagedDataExcluded/);
});
test('a loose collection or a collection inside app.asar blocks packaging',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'barun-data-policy-'));try{fs.mkdirSync(path.join(root,'backend'));assert.doesNotThrow(()=>assertPackagedDataExcluded(root));fs.mkdirSync(path.join(root,'backend','data'));assert.throws(()=>assertPackagedDataExcluded(root),/외부 자료/);fs.rmdirSync(path.join(root,'backend','data'));fs.writeFileSync(path.join(root,'app.asar'),'test');assert.throws(()=>assertPackagedDataExcluded(root,{listPackage:()=>['/data/lh-2025/catalog.json']}),/외부 자료/);for(const name of ['/law-changes.json','/rules/knowledge/details/steel.json','/country/kor/details/fire.json'])assert.throws(()=>assertPackagedDataExcluded(root,{listPackage:()=>[name]}),/외부 자료/);assert.doesNotThrow(()=>assertPackagedDataExcluded(root,{listPackage:()=>['/desktop.cjs']}));}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('server-only detail unit and jutong original directories are excluded in loose files and ASAR',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'barun-server-assets-policy-'));try{
 for(const name of ['cad-assets','_바른표준','standard-details','단위세대','동평면','주동','unit-library','jutong-library']){
  assert.ok(forbiddenDataPath('backend/'+name+'/index.json'),name);
  fs.mkdirSync(path.join(root,name));assert.throws(()=>assertPackagedDataExcluded(root),/외부 자료/);fs.rmdirSync(path.join(root,name));
  fs.writeFileSync(path.join(root,'app.asar'),'test');assert.throws(()=>assertPackagedDataExcluded(root,{listPackage:()=>['/'+name+'/index.json']}),/외부 자료/);fs.unlinkSync(path.join(root,'app.asar'));
 }
 for(const code of ['cad_asset_client.py','unit_library.py','jutong_library.py','detail-search-panel.js'])assert.equal(forbiddenDataPath(code),false,code);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
