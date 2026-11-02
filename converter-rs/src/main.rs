//! barun-dwg2dxf: DWG 를 DXF 로 바꾸는 보조 엔진(기본 엔진 ACadSharp 가 실패했을 때).
//! acadrust(MPL-2.0)를 고치지 않고 의존성으로만 쓴다. 라이선스와 소스 위치는 동봉 고지에 둔다.
//! DWG 처리는 `convert` 하나(바이트 → 바이트) 뒤에 둔다. 손상된 DWG 가 수천 배로 부풀지 않게 크기 상한을 둔다.
//! 사용: barun-dwg2dxf [--as r2018] -o out.dxf in.dwg   (끝나면 표준 출력에 JSON 한 줄)
use acadrust::entities::{BoundaryEdge, EntityType};
use acadrust::{CadDocument, DwgReader, DxfVersion, DxfWriter};
use acadrust::io::dwg::DwgReadOptions;
use std::io::Cursor;
use std::process::ExitCode;

const MAX_DWG: u64 = 512 * 1024 * 1024; // 입력 DWG 상한
const MAX_DXF: usize = 1024 * 1024 * 1024; // 변환 DXF 상한

// Windows uses the parent Job; Unix installs guards before reading DWG.
// fork 뒤 Python 콜백을 실행하지 않으므로 다중 스레드 서버에서도 교착 위험을 더하지 않는다.
#[cfg(any(unix, test))]
const MAX_PROCESS_MEMORY: u64 = 4 * 1024 * 1024 * 1024;

#[cfg(any(unix, test))]
fn capped_memory_limit(hard: u64, infinity: u64) -> u64 {
    if hard == infinity { MAX_PROCESS_MEMORY } else { hard.min(MAX_PROCESS_MEMORY) }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn limit_process_memory() {
    // 지원되지 않거나 설정할 권한이 없으면 기존 한도를 그대로 둔다.
    unsafe {
        let mut current = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        if libc::getrlimit(libc::RLIMIT_AS, &mut current) != 0 { return; }
        let cap = capped_memory_limit(current.rlim_max as u64, libc::RLIM_INFINITY as u64);
        let limit = libc::rlimit { rlim_cur: cap as libc::rlim_t, rlim_max: cap as libc::rlim_t };
        let _ = libc::setrlimit(libc::RLIMIT_AS, &limit);
    }
}

#[cfg(not(unix))]
fn limit_process_memory() {}


// macOS does not provide an enforceable RLIMIT_AS ceiling. Track Rust heap
// requests synchronously and sample resident bytes every 50 ms. The RSS check
// can overshoot between samples; this is not a hard total-process memory cap.
#[cfg(any(target_os = "macos", test))]
mod memory_guard {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub struct Budget { used: AtomicUsize, limit: usize }
    impl Budget {
        pub const fn new(limit: usize) -> Self { Self { used: AtomicUsize::new(0), limit } }
        pub fn reserve(&self, bytes: usize) -> bool {
            self.used.fetch_update(Ordering::SeqCst, Ordering::SeqCst,
                |used| used.checked_add(bytes).filter(|next| *next <= self.limit)).is_ok()
        }
        pub fn release(&self, bytes: usize) { self.used.fetch_sub(bytes, Ordering::SeqCst); }
    }
    pub struct GuardedAllocator(pub Budget);
    unsafe impl GlobalAlloc for GuardedAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            if !self.0.reserve(layout.size()) { stop(71); }
            let ptr = System.alloc(layout);
            if ptr.is_null() { self.0.release(layout.size()); }
            ptr
        }
        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            if !self.0.reserve(layout.size()) { stop(71); }
            let ptr = System.alloc_zeroed(layout);
            if ptr.is_null() { self.0.release(layout.size()); }
            ptr
        }
        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            System.dealloc(ptr, layout);
            self.0.release(layout.size());
        }
        unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            let growth = size.saturating_sub(layout.size());
            if !self.0.reserve(growth) { stop(71); }
            let next = System.realloc(ptr, layout, size);
            if next.is_null() { self.0.release(growth); }
            else if size < layout.size() { self.0.release(layout.size() - size); }
            next
        }
    }
    pub fn resident_status(bytes: Option<u64>, cap: u64) -> Result<(), i32> {
        match bytes { None => Err(72), Some(n) if n > cap => Err(71), Some(_) => Ok(()) }
    }
    #[cfg(target_os = "macos")]
    fn stop(code: i32) -> ! {
        let message: &[u8] = if code == 71 { b"barun_memory_limit_exceeded\n" }
            else { b"barun_memory_monitor_unavailable\n" };
        // No allocations, formatting, locks or destructors on the OOM path.
        unsafe { libc::write(2, message.as_ptr().cast(), message.len()); libc::_exit(code) }
    }
    #[cfg(not(target_os = "macos"))]
    fn stop(code: i32) -> ! { std::process::exit(code) }

    #[cfg(target_os = "macos")]
    fn resident_bytes() -> Option<u64> {
        // Apple xnu bsd/sys/proc_info.h: PROC_PIDTASKINFO=4, proc_taskinfo
        // comprises six uint64_t fields followed by twelve int32_t fields.
        #[repr(C)]
        struct TaskInfo { counters: [u64; 6], statistics: [i32; 12] }
        #[link(name = "proc")]
        extern "C" {
            fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut std::ffi::c_void, size: i32) -> i32;
        }
        let mut info = TaskInfo { counters: [0; 6], statistics: [0; 12] };
        let size = std::mem::size_of::<TaskInfo>() as i32;
        let got = unsafe { proc_pidinfo(libc::getpid(), 4, 0, (&mut info as *mut TaskInfo).cast(), size) };
        if got == size { Some(info.counters[1]) } else { None }
    }
    #[cfg(target_os = "macos")]
    pub fn start() {
        if let Err(code) = resident_status(resident_bytes(), super::MAX_PROCESS_MEMORY) { stop(code); }
        if std::thread::Builder::new().name("memory-guard".into()).spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if let Err(code) = resident_status(resident_bytes(), super::MAX_PROCESS_MEMORY) { stop(code); }
        }).is_err() { stop(72); }
    }
}
#[cfg(target_os = "macos")]
#[global_allocator]
static MEMORY_ALLOCATOR: memory_guard::GuardedAllocator =
    memory_guard::GuardedAllocator(memory_guard::Budget::new(MAX_PROCESS_MEMORY as usize));

#[cfg(target_os = "macos")]
fn limit_process_memory() { memory_guard::start(); }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stray_block_owned_entity_leaves_model_space_but_real_ones_stay() {
        let dxf = b"0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n5\n30\n8\n0\n10\n0\n20\n0\n30\n0\n11\n1\n21\n0\n31\n0\n0\nLINE\n5\n31\n8\n0\n10\n5\n20\n5\n30\n0\n11\n6\n21\n5\n31\n0\n0\nLINE\n5\n32\n8\n0\n10\n9\n20\n9\n30\n0\n11\n9\n21\n8\n31\n0\n0\nENDSEC\n0\nEOF\n";
        let mut doc = acadrust::DxfReader::from_reader(Cursor::new(dxf.to_vec())).unwrap().read().unwrap();
        let handles: Vec<_> = doc.model_space_entities().map(|e| e.common().handle).collect();
        assert_eq!(handles.len(), 3);
        doc.get_entity_mut(handles[0]).unwrap().common_mut().entity_mode = Some(0); // 주인 블록을 못 찾아 모델로 온 것
        doc.get_entity_mut(handles[1]).unwrap().common_mut().entity_mode = Some(2); // DWG 의 진짜 모델 객체
        assert_eq!(drop_stray_model_entities(&mut doc), 1);
        let left: Vec<_> = doc.model_space_entities().map(|e| e.common().handle).collect();
        assert_eq!(left, vec![handles[1], handles[2]]); // 모드 2 와 모드 없음(DXF 출신)은 남음
        assert_eq!(drop_stray_model_entities(&mut doc), 0);
    }
    #[test]
    fn block_point_and_hatch_are_already_covered_by_entities_mut() {
        // A named BLOCK containing a POINT and elliptic HATCH, no model entities.
        let dxf = b"0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nANGLE_BLOCK\n70\n0\n10\n0\n20\n0\n30\n0\n0\nPOINT\n5\n20\n8\n0\n10\n1\n20\n2\n30\n0\n50\n90\n0\nHATCH\n5\n21\n8\n0\n100\nAcDbEntity\n100\nAcDbHatch\n10\n0\n20\n0\n30\n0\n210\n0\n220\n0\n230\n1\n2\nSOLID\n70\n1\n71\n0\n91\n1\n92\n1\n93\n1\n72\n3\n10\n0\n20\n0\n11\n2\n21\n0\n40\n0.5\n50\n0\n51\n360\n73\n1\n97\n0\n75\n0\n76\n1\n98\n0\n0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
        let mut doc = acadrust::DxfReader::from_reader(Cursor::new(dxf.to_vec())).unwrap().read().unwrap();
        assert_eq!(doc.entities_in_block("ANGLE_BLOCK").count(), 2);
        assert_eq!(doc.model_space_entities().count(), 0);
        // Populate the radian values produced by the DWG reader, by handle.
        let handles: Vec<_> = doc.entities_in_block("ANGLE_BLOCK").map(|e| e.common().handle).collect();
        for handle in handles {
            match doc.get_entity_mut(handle).unwrap() {
                EntityType::Point(p) => p.x_axis_angle = std::f64::consts::FRAC_PI_2,
                EntityType::Hatch(h) => match &mut h.paths[0].edges[0] {
                    BoundaryEdge::EllipticArc(a) => { a.start_angle = std::f64::consts::PI; a.end_angle = std::f64::consts::TAU; }
                    _ => panic!("expected elliptic boundary"),
                },
                _ => panic!("unexpected block member"),
            }
        }
        let before = doc.entities_in_block("ANGLE_BLOCK").find_map(|e| match e {
            EntityType::Point(p) => Some(p.x_axis_angle), _ => None,
        }).unwrap();
        fix_for_dxf(&mut doc);
        let after = doc.entities_in_block("ANGLE_BLOCK").find_map(|e| match e {
            EntityType::Point(p) => Some(p.x_axis_angle), _ => None,
        }).unwrap();
        assert!((after - before.to_degrees()).abs() < 1e-9);
        assert!((after - 90.0).abs() < 1e-9);
        let hatch = doc.entities_in_block("ANGLE_BLOCK").find_map(|e| match e {
            EntityType::Hatch(h) => Some(h), _ => None,
        }).unwrap();
        match &hatch.paths[0].edges[0] {
            BoundaryEdge::EllipticArc(a) => { assert!((a.start_angle - 180.0).abs() < 1e-9); assert!((a.end_angle - 360.0).abs() < 1e-9); }
            _ => panic!("expected elliptic boundary"),
        }
    }

    #[test]
    fn allocator_realloc_and_dealloc_restore_budget() {
        use std::alloc::{GlobalAlloc, Layout};
        let alloc = memory_guard::GuardedAllocator(memory_guard::Budget::new(64));
        unsafe {
            let small = Layout::from_size_align(8, 8).unwrap();
            let large = Layout::from_size_align(32, 8).unwrap();
            let p = alloc.alloc_zeroed(small);
            assert!(!p.is_null());
            assert_eq!(*p, 0);
            let p = alloc.realloc(p, small, 32);
            assert!(!p.is_null());
            assert!(!alloc.0.reserve(33));
            let p = alloc.realloc(p, large, 8);
            assert!(!p.is_null());
            alloc.dealloc(p, small);
            assert!(alloc.0.reserve(64));
        }
    }

    #[test]
    fn heap_budget_is_atomic_and_rejects_overflow_without_reserving() {
        let budget = memory_guard::Budget::new(64);
        assert!(budget.reserve(32));
        assert!(budget.reserve(32));
        assert!(!budget.reserve(1));
        assert!(!budget.reserve(usize::MAX));
        budget.release(32);
        assert!(budget.reserve(32));
    }
    #[test]
    fn resident_measurement_failure_is_not_reported_as_oom() {
        assert_eq!(memory_guard::resident_status(None, 64), Err(72));
        assert_eq!(memory_guard::resident_status(Some(65), 64), Err(71));
        assert_eq!(memory_guard::resident_status(Some(64), 64), Ok(()));
    }

    #[test]
    fn memory_limit_is_four_gibibytes_for_an_unlimited_process() {
        assert_eq!(capped_memory_limit(u64::MAX, u64::MAX), 4_294_967_296);
    }
    #[test]
    fn memory_limit_preserves_a_stricter_inherited_ceiling() {
        assert_eq!(capped_memory_limit(512 * 1024 * 1024, u64::MAX), 512 * 1024 * 1024);
        assert_eq!(capped_memory_limit(8 * 1024 * 1024 * 1024, u64::MAX), MAX_PROCESS_MEMORY);
    }
}

fn version(name: &str) -> Option<DxfVersion> {
    Some(match name.to_ascii_lowercase().trim_start_matches('r') {
        "12" => DxfVersion::AC1009,
        "14" => DxfVersion::AC1014,
        "2000" => DxfVersion::AC1015,
        "2004" => DxfVersion::AC1018,
        "2007" => DxfVersion::AC1021,
        "2010" => DxfVersion::AC1024,
        "2013" => DxfVersion::AC1027,
        "2018" => DxfVersion::AC1032,
        _ => return None,
    })
}

struct Converted {
    dxf: Vec<u8>,
    entities: usize,
    recovered: usize,
    skipped: usize,
    diagnostics: usize,
    stray_dropped: usize,
    source_version: String,
}

/// acadrust 0.6.4 DXF 쓰기의 단위·이름 실수를 쓰기 전에 문서 쪽에서 맞춘다(acadrust 는 고치지 않는다).
/// - HATCH 타원 경계 시작·끝각(50/51)과 POINT 각도(50)를 라디안 그대로 쓴다 → DXF 는 도. 우리 도면 #65 에서
///   한 바퀴 타원 경계(끝각 2π)가 2π° 로 읽혀 해치 19개가 빠졌다.
/// - $DWGCODEPAGE 에 'KOREAN' 같은 비표준 이름을 쓴다 → 표준 'ANSI_949' 등.
fn fix_for_dxf(doc: &mut CadDocument) {
    for entity in doc.entities_mut() {
        match entity {
            EntityType::Point(point) => point.x_axis_angle = point.x_axis_angle.to_degrees(),
            EntityType::Hatch(hatch) => {
                for path in hatch.paths.iter_mut().chain(hatch.mpolygon_invalid_loops.iter_mut()) {
                    for edge in path.edges.iter_mut() {
                        if let BoundaryEdge::EllipticArc(arc) = edge {
                            arc.start_angle = arc.start_angle.to_degrees();
                            arc.end_angle = arc.end_angle.to_degrees();
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let standard = match doc.header.code_page.as_str() {
        "KOREAN" => "ANSI_949",
        "JOHAB" => "ANSI_1361",
        "BIG5" => "ANSI_950",
        "GB2312" => "ANSI_936",
        _ => return,
    };
    doc.header.code_page = standard.to_string();
}

/// 주인 블록이 따로 적힌 객체(DWG entity_mode 0)가 모델 공간 목록에 들어 있으면 뺀다.
/// acadrust 0.6.4 는 주인 블록을 못 찾으면 그 객체를 모델 공간에 넣는데, AutoCAD 는 그리지 않는다.
/// 온천동주복(2022.09.21) 도면: DGN 선 모양 조각 53,486개가 원점에 그려져 도면이 깨져 보였다(2026-10-27).
/// 모델 공간의 진짜 객체는 entity_mode 2 라 남는다.
fn drop_stray_model_entities(doc: &mut CadDocument) -> usize {
    let stray: std::collections::HashSet<_> = match doc.block_records.get("*Model_Space") {
        Some(ms) => ms.entity_handles.iter().copied()
            .filter(|h| doc.get_entity(*h).map_or(false, |e| e.common().entity_mode == Some(0)))
            .collect(),
        None => return 0,
    };
    if let Some(ms) = doc.block_records.get_mut("*Model_Space") {
        ms.entity_handles.retain(|h| !stray.contains(h));
    }
    stray.len()
}

/// 바이트로 받은 DWG 를 DXF 바이트로. 파일·프로세스 일은 main 이 한다.
fn convert(dwg: &[u8], target: Option<DxfVersion>) -> Result<Converted, String> {
    let mut reader = DwgReader::from_stream_with_options(Cursor::new(dwg), DwgReadOptions::failsafe());
    let outcome = reader.read_with_stats().map_err(|e| format!("DWG 읽기 실패: {e}"))?;
    let mut doc = outcome.document;
    let stats = outcome.stats;
    if let Some(v) = target {
        doc.version = v;
    }
    fix_for_dxf(&mut doc);
    let stray = drop_stray_model_entities(&mut doc);
    let mut out = Cursor::new(Vec::new());
    DxfWriter::new(&doc).write_to_writer(&mut out).map_err(|e| format!("DXF 쓰기 실패: {e}"))?;
    let dxf = out.into_inner();
    if dxf.len() > MAX_DXF {
        return Err(format!("변환 결과가 상한을 넘습니다({} MB > 1024 MB) — 손상된 DWG 일 수 있습니다", dxf.len() / 1048576));
    }
    Ok(Converted {
        entities: doc.entities().count(),
        recovered: stats.recovered_errors,
        skipped: stats.skipped_source_records,
        diagnostics: stats.diagnostics.len(),
        stray_dropped: stray,
        source_version: stats.source_version,
        dxf,
    })
}

fn json_text(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn fail(message: &str) -> ExitCode {
    println!("{{\"ok\":false,\"error\":{}}}", json_text(message));
    ExitCode::from(1)
}

fn main() -> ExitCode {
    limit_process_memory();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut input, mut output, mut target) = (None, None, None);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-o" if i + 1 < args.len() => { output = Some(args[i + 1].clone()); i += 1; }
            "--as" if i + 1 < args.len() => {
                match version(&args[i + 1]) { Some(v) => target = Some(v), None => return fail("--as 는 r12·r14·r2000·r2004·r2007·r2010·r2013·r2018") }
                i += 1;
            }
            "-v0" => {}
            a if !a.starts_with('-') => input = Some(a.to_string()),
            _ => return fail("사용법: barun-dwg2dxf [--as r2018] -o out.dxf in.dwg"),
        }
        i += 1;
    }
    let (Some(input), Some(output)) = (input, output) else { return fail("사용법: barun-dwg2dxf [--as r2018] -o out.dxf in.dwg") };
    match std::fs::metadata(&input) {
        Ok(m) if m.len() > MAX_DWG => return fail(&format!("DWG 가 상한을 넘습니다({} MB > 512 MB)", m.len() / 1048576)),
        Ok(_) => {}
        Err(e) => return fail(&format!("DWG 를 열 수 없습니다: {e}")),
    }
    let dwg = match std::fs::read(&input) { Ok(b) => b, Err(e) => return fail(&format!("DWG 를 읽을 수 없습니다: {e}")) };
    match convert(&dwg, target) {
        Ok(c) => {
            if let Err(e) = std::fs::write(&output, &c.dxf) { return fail(&format!("DXF 를 쓸 수 없습니다: {e}")); }
            println!("{{\"ok\":true,\"engine\":\"acadrust 0.6.4\",\"source_version\":{},\"entities\":{},\"recovered_errors\":{},\"skipped_records\":{},\"diagnostics\":{},\"stray_dropped\":{},\"bytes\":{}}}",
                json_text(&c.source_version), c.entities, c.recovered, c.skipped, c.diagnostics, c.stray_dropped, c.dxf.len());
            ExitCode::SUCCESS
        }
        Err(e) => fail(&e),
    }
}
