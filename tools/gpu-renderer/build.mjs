import { build } from '../../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
await build({absWorkingDir:root,entryPoints:['tools/gpu-renderer/entry.js'],bundle:true,format:'esm',platform:'browser',outfile:'vendor/mlightcad.js',minify:true,legalComments:'linked',alias:{'three/examples/jsm/controls/OrbitControls':root+'tools/gpu-renderer/node_modules/three/examples/jsm/controls/OrbitControls.js'}});

