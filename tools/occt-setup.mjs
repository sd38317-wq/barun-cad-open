/**
 * Reproducible, isolated dependency install. Never touches the shared root node_modules.
 * Run only in an environment where npm registry access is permitted.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const prefix=fileURLToPath(new URL('../vendor/occt-pkg/',import.meta.url));
const cache=fileURLToPath(new URL('../tmp/occt-spike/npm-cache/',import.meta.url));
await mkdir(cache,{recursive:true});
const npmCli=process.env.npm_execpath ??
  fileURLToPath(new URL('./node_modules/npm/bin/npm-cli.js',pathToFileURL(process.execPath)));
const child=spawn(process.execPath,[npmCli,'install','--prefix',prefix,
  'replicad-opencascadejs@1.1.0','--save-exact','--ignore-scripts','--no-audit','--no-fund',
  '--cache',cache,'--fetch-retries=0','--fetch-timeout=15000'],{cwd:root,windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
