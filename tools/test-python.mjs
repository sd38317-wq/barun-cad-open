// 시험에서 쓸 파이썬. DXF 왕복(exchange)은 ezdxf 가 있는 파이썬이 필요하다.
// BARUN_PYTHON → 맥 개발 도구 모음(~/.barun-toolchain/venv-cad) → python(윈도우)/python3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const toolchain=path.join(os.homedir(),'.barun-toolchain','venv-cad','bin','python');
export const PYTHON=process.env.BARUN_PYTHON||(process.platform!=='win32'&&fs.existsSync(toolchain)?toolchain:process.platform==='win32'?'python':'python3');
