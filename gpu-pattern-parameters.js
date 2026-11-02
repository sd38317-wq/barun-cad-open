import {THREE} from './vendor/mlightcad.js';

const finite=v=>Number.isFinite(v), shaderError=message=>{throw Error(`pattern parameter shader: ${message}`);};
export function buildPatternParameterTable(items){
 if(!Array.isArray(items)||!items.length)throw Error('pattern parameter items required');
 const first=items[0],fm=first?.material,fl=fm?.uniforms?.u_patternLines?.value;
 if(!Array.isArray(fl)||!fl.length)throw Error('pattern families required');
 const families=fl.length,dashes=fm.defines?.MAX_PATTERN_SEGMENT_COUNT;
 if(!Number.isInteger(dashes)||dashes<2)throw Error('pattern segment count invalid');
 const stride=6+dashes,width=Math.ceil((4+families*stride)/4),data=new Float32Array(width*items.length*4);
 for(let row=0;row<items.length;row++){
  const m=items[row]?.material,u=m?.uniforms,lines=u?.u_patternLines?.value,color=u?.u_color?.value,angle=u?.u_patternAngle?.value;
  if(!Array.isArray(lines)||lines.length!==families||m.defines?.MAX_PATTERN_SEGMENT_COUNT!==dashes)throw Error('pattern shape mismatch');
  if(!color||![color.r,color.g,color.b].every(finite)||!finite(angle))throw Error('nonfinite pattern color or angle');
  const base=row*width*4;data.set([color.r,color.g,color.b,angle],base);
  lines.forEach((p,index)=>{
   if(!p||!Array.isArray(p.dashLengths)||p.dashLengths.length!==dashes||!p.base||!p.offset)throw Error('pattern dash padding mismatch');
   const values=[p.angle,p.base.x,p.base.y,p.offset.x,p.offset.y,p.patternLength,...p.dashLengths];
   if(values.some(v=>!finite(v)))throw Error('nonfinite pattern parameter');data.set(values,base+4+index*stride);
  });
 }
 const texture=new THREE.DataTexture(data,width,items.length,THREE.RGBAFormat,THREE.FloatType);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 return {texture,width,data,install(shader){
  if(!shader?.uniforms||typeof shader.vertexShader!=='string'||typeof shader.fragmentShader!=='string')shaderError('invalid shader');
  if(!shader.vertexShader.includes('void main() {'))shaderError('missing vertex main anchor');
  if(!shader.vertexShader.includes('cadLineSlot'))shaderError('missing cadLineSlot anchor');
  const familyAnchor=`uniform PatternLine u_patternLines[${families}];`;
  for(const anchor of ['uniform vec3 u_color;', 'uniform float u_patternAngle;',familyAnchor])if(!shader.fragmentShader.includes(anchor))shaderError(`missing ${anchor}`);
  shader.uniforms.cadPatternTable={value:texture};shader.uniforms.cadPatternRows={value:items.length};shader.vertexShader='flat varying float vCadPatternSlot;\n'+shader.vertexShader.replace('void main() {','void main() { vCadPatternSlot=cadLineSlot;');
  shader.fragmentShader=`flat varying float vCadPatternSlot;\nuniform sampler2D cadPatternTable;\nuniform float cadPatternRows;\nvec4 cadPatternTexel(float column){return texture2D(cadPatternTable,vec2((column+0.5)/${width}.0,(vCadPatternSlot+0.5)/cadPatternRows));}\nfloat cadPatternScalar(int offset){vec4 v=cadPatternTexel(floor(float(offset)/4.0));int lane=offset%4;return lane==0?v.x:lane==1?v.y:lane==2?v.z:v.w;}\n`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('uniform vec3 u_color;','#define u_color cadPatternTexel(0.0).rgb').replace('uniform float u_patternAngle;','#define u_patternAngle cadPatternTexel(0.0).a').replace(familyAnchor,`PatternLine cadPatternLine(int index){ int offset=4+index*${stride};PatternLine p; p.angle=cadPatternScalar(offset);p.base=vec2(cadPatternScalar(offset+1),cadPatternScalar(offset+2));p.offset=vec2(cadPatternScalar(offset+3),cadPatternScalar(offset+4));p.patternLength=cadPatternScalar(offset+5);for(int j=0;j<MAX_PATTERN_SEGMENT_COUNT;j++)p.dashLengths[j]=cadPatternScalar(offset+6+j);return p;}`);
  shader.fragmentShader=shader.fragmentShader.replaceAll('#pragma unroll_loop_start','').replaceAll('#pragma unroll_loop_end','').replaceAll('u_patternLines.length()',String(families)).replace(/u_patternLines\[([^\]]+)\]/g,'cadPatternLine($1)');
  if(shader.fragmentShader.includes('u_patternLines'))shaderError('pattern table replacement incomplete');
 }};
}
