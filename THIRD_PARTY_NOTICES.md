# Third-party components

The application source in this directory was created for this project. It uses:

- **ACadSharp 3.8.0**, MIT license. Project: https://github.com/DomCR/ACadSharp. The self-contained `dwg-runtime` is the primary local DWG reader and includes `ACadSharp-LICENSE.txt` plus the .NET runtime notices. The separately tested 3.7.16 package is not included because the compatibility sample failed.
- **ezdxf 1.4.4**, MIT license. Project: https://github.com/mozman/ezdxf. It reads the generated DXF, maps editable objects, and preserves the DXF carrier used for safer round trips. Its distribution includes the applicable license and dependencies.
- **acadrust 0.6.4**, MPL-2.0, used unmodified by the separate `barun-dwg2dxf` auxiliary process. Source: https://github.com/hakanaktt/acadrust (exact published source: https://crates.io/crates/acadrust/0.6.4). The full MPL-2.0 text is bundled as `acadrust-runtime/LICENSE`; `NOTICE` lists every locked Cargo crate and source location. Dependency licenses include MIT/Apache-2.0 alternatives, Zlib, BSD-3-Clause, Unicode-3.0, 0BSD, Unlicense and BSL-1.0. Their full license and copyright texts are in `acadrust-runtime/THIRD_PARTY_LICENSES.txt`; target-specific/build-only crates are included in the inventory. The auxiliary result is checked against primary per-type counts when available, and empty results from large sources are rejected.
- **GEOS 3.13.1** (LGPL-2.1) inside the Shapely wheel, dynamically linked (`Shapely.libs`); license at `shapely-2.1.2.dist-info/licenses/LICENSE_GEOS`, source at https://libgeos.org. **PROJ 9.8.1** (MIT) inside pyproj.
- **Hatch pattern definitions** (172 ISO patterns in `hatch-pattern-library.js`) are taken from ezdxf's `ISO_PATTERN` table (MIT). Standard linetype names and dash lengths follow the published ISO/acadiso conventions; no Autodesk file is bundled.
- **Kakao Login symbol** (`shared/account-window/shared-assets/kakao-symbol-approved.svg`) is a Kakao trademark, used only on the Kakao login button under Kakao's login design guide.
- **PyInstaller bootloader** (GPL-2.0 with the bootloader exception): the exception permits distributing the packaged backend under any terms.
- **AutoCAD Core Console**, if already installed. Proprietary Autodesk component used only for explicit AutoLISP execution. It is not used for the normal DWG import path and is not bundled, installed, redistributed, or licensed by this project.
- **ODA File Converter**, optional external program. It is not bundled or installed by this project. Its separate license and installation conditions apply.
- **MLightCAD comparison renderer**, bundled under `vendor/mlightcad.js` for the GPU drawing path. Its bundled dependency notices and license text are in `vendor/mlightcad.NOTICE.txt` and `vendor/mlightcad.js.LEGAL.txt`; the source lockfile is `tools/gpu-renderer/package-lock.json`.

No cloud drawing conversion service is used. User-selected file bytes are sent only to the loopback server on the same machine.

`libdxfrw` and the LibreCAD application are not linked, copied, or bundled. libdxfrw was reviewed only as an independent GPL-2.0-or-later experimental DWG candidate and was not added to the product.


Desktop components: Electron (MIT, bundled Chromium notices in LICENSES.chromium.html), electron-builder (MIT, build only), NSIS (zlib/libpng license for installer system). Python distributions and their bundled dependencies retain their upstream notices. Additional dependencies: ReportLab (BSD), pypdf (BSD-3-Clause), pyshp (MIT), pyproj/PROJ (MIT), Shapely (BSD-3-Clause; GEOS LGPL-2.1). Installed package metadata and bundled GEOS/PROJ licenses govern redistribution. Codex and its artifact runtime are external installed components and are not redistributed by this installer. AI requests and selected drawing context are sent to the configured Codex service when the user invokes AI chat.
## Nanum Gothic

Barun CAD bundles Nanum Gothic for consistent Korean drawing text display.
Copyright (c) 2010, NAVER Corporation. Licensed under the SIL Open Font License 1.1.
The full license is included at `fonts/OFL-NanumGothic.txt`.
