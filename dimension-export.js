// Save-only display geometry: native DXF dimensions keep the same appearance as the canvas.
import {dimensionParts} from './geometry.js';

export function prepareDimensionExport(document) {
 const entity = source => {
  let result = source;
  if (source.type === 'dimension' && (['arcLength','jogged','ordinateX','ordinateY'].includes(source.mode) || source.breaks?.length)) {
   result = {...source, dimensionDisplayParts: dimensionParts(source)};
  } else if (Object.hasOwn(source, 'dimensionDisplayParts')) {
   const {dimensionDisplayParts, ...rest} = source;result = rest;
  }
  if (Array.isArray(source.entities)) {
   const children = list(source.entities);
   if (children !== source.entities) result = {...result, entities: children};
  }
  return result;
 };
 const list = source => {
  if (!Array.isArray(source)) return source;
  let result = source;
  source.forEach((value, index) => {const next = entity(value);if (next !== value) {if (result === source) result = source.slice();result[index] = next;}});
  return result;
 };
 const entities = list(document.entities), blocks = list(document.blocks);
 let sharedBlocks = document.sharedBlocks;
 if (sharedBlocks) for (const [name, definition] of Object.entries(sharedBlocks)) {
  const next = entity(definition);
  if (next !== definition) {if (sharedBlocks === document.sharedBlocks) sharedBlocks = {...sharedBlocks};sharedBlocks[name] = next;}
 }
 return entities === document.entities && blocks === document.blocks && sharedBlocks === document.sharedBlocks ? document :
  {...document, entities, ...(blocks ? {blocks} : {}), ...(sharedBlocks ? {sharedBlocks} : {})};
}
