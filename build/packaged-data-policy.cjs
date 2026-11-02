'use strict';
const fs=require('node:fs'),path=require('node:path');
const FORBIDDEN=new Set(['data','lh-details','lh-2025','la-details','steel-details','jutong','kor - 상세 모음','cad-assets','_바른표준','standard-detail','standard-details','details-v2','unit-library','unit_library','jutong-library','jutong_library','단위세대','동평면','주동']);
function forbiddenDataPath(file){return String(file).replaceAll('\\','/').split('/').some(part=>FORBIDDEN.has(part.toLowerCase()));}
function protectedAssetPath(file){const parts=String(file).replaceAll('\\','/').split('/').filter(Boolean),leaf=parts.at(-1)?.toLowerCase()||'';return leaf.endsWith('.lsp')||['law-changes.json','generation-layer-standards.json','layer-standards-data.js'].includes(leaf)||(leaf.endsWith('.json')&&parts.slice(0,-1).some(p=>['rules','knowledge','details','country'].includes(p.toLowerCase())));}
function assertPackagedDataExcluded(resources,{listPackage}={}){
 const problems=[];
 function visit(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,entry.name),relative=path.relative(resources,full);if(forbiddenDataPath(relative)){problems.push(relative);continue;}if(entry.isDirectory())visit(full);else if(entry.name.endsWith('.asar')){const list=listPackage||require('@electron/asar').listPackage;for(const name of list(full))if(forbiddenDataPath(name)||protectedAssetPath(name))problems.push(relative+':'+name);}}}
 visit(resources);if(problems.length)throw Error('설치판에 외부 자료 폴더가 포함되었습니다: '+problems.slice(0,20).join(', '));
}
module.exports={forbiddenDataPath,protectedAssetPath,assertPackagedDataExcluded};
