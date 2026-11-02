import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const number = value => Number(value).toFixed(6).replace(/\.?0+$/, '');
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const span = e => ((e.endAngle - e.startAngle) % 360 + 360) % 360 || 360;
function validate(doc, name) {
  if (!doc || doc.version !== 2 || doc.units !== 'mm' ||
      !Array.isArray(doc.layers) || !Array.isArray(doc.entities) || !doc.entities.length)
    throw new Error('A nonempty version 2 document in mm is required');
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Artifact name must be a simple ASCII filename');
  const ids = new Set();
  for (const layer of doc.layers) {
    if (ids.has(layer.id) || !/^[\x20-\x7e]+$/.test(layer.name)) throw new Error('Invalid/duplicate layer');
    ids.add(layer.id);
  }
  for (const e of doc.entities) {
    if (!ids.has(e.layer)) throw new Error('Unknown entity layer');
    if (!['line','polyline','arc'].includes(e.type)) throw new Error('Unsupported entity ' + e.type);
    if (e.type === 'arc') {
      if (!finitePoint(e.center) || !(Number.isFinite(e.radius) && e.radius > 0) ||
          !Number.isFinite(e.startAngle) || !Number.isFinite(e.endAngle)) throw new Error('Invalid arc');
    } else if (!Array.isArray(e.points) || !e.points.every(finitePoint) ||
        (e.type === 'line' ? e.points.length !== 2 : e.points.length < 2)) throw new Error('Invalid points');
  }
}
const weight = mm => Number.isFinite(mm) && mm >= 0 ? Math.round(mm * 100) : -1;
export function occtDocumentDxf(doc) {
  validate(doc, 'document');
  const layers = new Map(doc.layers.map(l => [l.id,l]));
  const data = [];
  const put = (...pairs) => data.push(...pairs.map(String));
  put(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1024',9,'$INSUNITS',70,4,
    9,'$MEASUREMENT',70,1,9,'$LUNITS',70,2,0,'ENDSEC',0,'SECTION',2,'TABLES',
    0,'TABLE',2,'LTYPE',70,2);
  for (const [name,description,pattern] of [
    ['CONTINUOUS','Continuous',[]],['HIDDEN','Hidden',[3,-1.5]],
  ]) {
    put(0,'LTYPE',100,'AcDbSymbolTableRecord',100,'AcDbLinetypeTableRecord',
      2,name,70,0,3,description,72,65,73,pattern.length,40,pattern.reduce((s,v)=>s+Math.abs(v),0));
    for (const value of pattern) put(49,value,74,0);
  }
  put(0,'ENDTAB',0,'TABLE',2,'LAYER',70,doc.layers.length);
  for (const layer of doc.layers) {
    put(0,'LAYER',100,'AcDbSymbolTableRecord',100,'AcDbLayerTableRecord',
      2,layer.name,70,0,62,7,6,layer.linetype || 'CONTINUOUS',370,weight(layer.lineweight));
    if (/^#[0-9a-f]{6}$/i.test(layer.color)) put(420,parseInt(layer.color.slice(1),16));
  }
  put(0,'ENDTAB',0,'ENDSEC',0,'SECTION',2,'ENTITIES');
  for (const e of doc.entities) {
    const layer = layers.get(e.layer);
    put(0,{line:'LINE',polyline:'LWPOLYLINE',arc:'ARC'}[e.type],100,'AcDbEntity',
      8,layer.name,6,e.linetype || layer.linetype || 'CONTINUOUS',370,weight(e.lineweight ?? layer.lineweight));
    if (e.type === 'line') {
      put(100,'AcDbLine',10,number(e.points[0].x),20,number(e.points[0].y),30,0,
        11,number(e.points[1].x),21,number(e.points[1].y),31,0);
    } else if (e.type === 'polyline') {
      put(100,'AcDbPolyline',90,e.points.length,70,e.closed?1:0);
      for (const p of e.points) put(10,number(p.x),20,number(p.y));
    } else {
      put(100,'AcDbCircle',10,number(e.center.x),20,number(e.center.y),30,0,40,number(e.radius),
        100,'AcDbArc',50,number(e.startAngle),51,number(e.endAngle));
    }
  }
  put(0,'ENDSEC',0,'EOF');
  return data.join('\r\n') + '\r\n';
}
function entityPoints(e) {
  if (e.type !== 'arc') return e.closed ? [...e.points,e.points[0]] : e.points;
  const count = Math.max(12,Math.ceil(span(e)/2));
  return Array.from({length:count+1},(_,i)=>{
    const a = (e.startAngle+span(e)*i/count)*Math.PI/180;
    return {x:e.center.x+e.radius*Math.cos(a),y:e.center.y+e.radius*Math.sin(a)};
  });
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i=0;i<8;i++) value=(value>>>1)^((value&1)?0xedb88320:0);
  }
  return (value^0xffffffff)>>>0;
}
function chunk(type,bytes) {
  const data=Buffer.alloc(bytes.length+12);
  data.writeUInt32BE(bytes.length,0);data.write(type,4,4,'ascii');bytes.copy(data,8);
  data.writeUInt32BE(crc32(data.subarray(4,bytes.length+8)),bytes.length+8);
  return data;
}
export function occtDocumentPng(doc) {
  validate(doc,'document');
  const layers = new Map(doc.layers.map(l=>[l.id,l]));
  const segments=[];
  for (const entity of doc.entities) {
    const points=entityPoints(entity),layer=layers.get(entity.layer);
    for(let i=1;i<points.length;i++)segments.push({
      a:points[i-1],b:points[i],weight:entity.lineweight??layer.lineweight??0.13,
      hidden:(entity.linetype??layer.linetype)==='HIDDEN',
    });
  }
  if (!segments.length) throw new Error('No drawable segments');
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const segment of segments)for(const p of [segment.a,segment.b]) {
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }
  const width=1400,height=900,padding=50;
  const scale=Math.min((width-2*padding)/(maxX-minX||1),(height-2*padding)/(maxY-minY||1));
  const dx=(width-(maxX-minX)*scale)/2,dy=(height-(maxY-minY)*scale)/2;
  const pixels=Buffer.alloc(width*height*3,255);
  const screen=p=>({x:dx+(p.x-minX)*scale,y:height-dy-(p.y-minY)*scale});
  for (const segment of segments) {
    const a=screen(segment.a),b=screen(segment.b),count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)));
    const radius=segment.weight>=0.35?1:0;
    for(let i=0;i<=count;i++) {
      if(segment.hidden && i%14>=9)continue;
      const x=Math.round(a.x+(b.x-a.x)*i/count),y=Math.round(a.y+(b.y-a.y)*i/count);
      for(let ox=-radius;ox<=radius;ox++)for(let oy=-radius;oy<=radius;oy++) {
        const px=x+ox,py=y+oy;
        if(px>=0&&px<width&&py>=0&&py<height) {
          const index=(py*width+px)*3;
          pixels[index]=pixels[index+1]=pixels[index+2]=segment.hidden?125:30;
        }
      }
    }
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);
  header[8]=8;header[9]=2;
  const raw=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++)pixels.copy(raw,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
    chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export async function writeOcctArtifacts(document,{directory,name='occt-artifact'}={}) {
  validate(document,name);
  if (!directory) throw new Error('Artifact output directory is required');
  // Validate and render both formats before touching output files.
  const dxf=occtDocumentDxf(document),png=occtDocumentPng(document);
  await mkdir(directory,{recursive:true});
  const dxfPath=path.join(directory,name+'.dxf'),pngPath=path.join(directory,name+'.png');
  await writeFile(dxfPath,dxf,'ascii');await writeFile(pngPath,png);
  return {dxfPath,pngPath};
}
