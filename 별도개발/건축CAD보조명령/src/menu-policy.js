import {allCommands} from './menu-catalog.js';

export function validateCatalog(catalog){
 const groups=new Set(),ids=new Set(),aliases=new Set(),errors=[];
 for(const group of catalog){if(groups.has(group.id))errors.push('메뉴 그룹 ID 중복: '+group.id);groups.add(group.id);if(!group.label||!group.sections?.length)errors.push('빈 메뉴 그룹: '+group.id);}
 for(const command of allCommands(catalog)){
  if(ids.has(command.id))errors.push('명령 ID 중복: '+command.id);ids.add(command.id);
  if(aliases.has(command.alias))errors.push('단축키 중복: '+command.alias);aliases.add(command.alias);
  if(!['ready','prototype','planned'].includes(command.status))errors.push('상태 오류: '+command.id);
  if(command.integration?.enabled)errors.push('승인 전 본체 연결 금지: '+command.id);
 }
 return {valid:errors.length===0,errors,commands:ids.size,aliases:aliases.size};
}

export function menuView(catalog,{query='',statuses=['ready','prototype','planned']}={}){
 const text=query.trim().toLocaleLowerCase('ko-KR'),allowed=new Set(statuses);
 return catalog.map(group=>({...group,sections:group.sections.map(section=>({...section,commands:section.commands.filter(command=>allowed.has(command.status)&&(!text||[command.id,command.label,command.alias].some(value=>value.toLocaleLowerCase('ko-KR').includes(text))))})).filter(section=>section.commands.length)})).filter(group=>group.sections.length);
}
