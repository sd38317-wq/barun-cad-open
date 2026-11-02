import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// 윈도우 PC 원본 위치. 맥 등 다른 PC 는 저장소 안 tools/details_v2/ 에 같은 파일을 두면 그것을 쓴다(OCCT_MODEL_PATH 가 가장 먼저).
export const SARIR0_MODEL = 'D:/어플/캐드/tools/details_v2/사리로64-1_단독주택_모델.json';
export const LOCAL_MODEL = fileURLToPath(new URL('./details_v2/사리로64-1_단독주택_모델.json', import.meta.url));
export async function readOcctFixture(filename=process.env.OCCT_MODEL_PATH??(existsSync(LOCAL_MODEL)?LOCAL_MODEL:SARIR0_MODEL)) {
  return JSON.parse(await readFile(filename,'utf8'));
}
