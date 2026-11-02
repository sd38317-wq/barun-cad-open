"""Exercise the actual C# extractor against the bundled object model, offline."""
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import pytest

ROOT = Path(__file__).resolve().parent


@pytest.fixture(scope="module", params=["source", "runtime"])
def dynamic_payload(request):
    sdk = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Microsoft/dotnet"
    dotnet = sdk / "dotnet.exe"
    if not dotnet.exists():
        pytest.skip(".NET 8 SDK unavailable")
    # Direct compilation avoids restore/network and uses precisely the shipped API.
    compilers = sorted((sdk / "sdk").glob("8.*/Roslyn/bincore/csc.dll"))
    if not compilers:
        pytest.skip(".NET 8 compiler unavailable")
    artifact_root = ROOT / ".artifact-runtime"
    artifact_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dynb-converter-", dir=artifact_root) as folder:
        output = Path(folder)
        sources = [ROOT / "converter/DynBlocks.cs", ROOT / "tests/fixtures/dynamic-parameters/GlobalUsings.cs",
                   ROOT / "tests/fixtures/dynamic-parameters/Program.cs"]
        if request.param == "runtime":
            bridge = output / "RuntimeBridge.cs"
            converter_path = str(ROOT / "dwg-runtime/BarunConverter.dll").replace('"', '""')
            bridge.write_text(
                'static class DynBlocks { public static int Write(ACadSharp.CadDocument doc, string path) {'
                ' var assembly = System.Reflection.Assembly.LoadFrom(@"' + converter_path + '");'
                ' return (int)assembly.GetType("DynBlocks")!.GetMethod("Write",'
                ' System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)!'
                '.Invoke(null, new object[]{doc, path})!; }}', encoding="utf-8")
            sources[0] = bridge
        command = [str(dotnet), str(compilers[-1]), "/noconfig", "/nostdlib", "/nullable:enable",
                   "/target:exe", "/out:" + str(output / "Probe.dll")]
        reference_packs = sorted((sdk / "packs/Microsoft.NETCore.App.Ref").glob("8.*/ref/net8.0"))
        assert reference_packs, "The .NET 8 reference pack is required"
        command += ["/r:" + str(path) for path in reference_packs[-1].glob("*.dll")]
        command += ["/r:" + str(ROOT / "dwg-runtime/ACadSharp.dll")]
        command += [str(source) for source in sources]
        built = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=60)
        assert built.returncode == 0, built.stdout.decode(errors="replace") + built.stderr.decode(errors="replace")
        shutil.copyfile(ROOT / "dwg-runtime/ACadSharp.dll", output / "ACadSharp.dll")
        (output / "Probe.runtimeconfig.json").write_text(json.dumps({"runtimeOptions": {
            "tfm": "net8.0", "framework": {"name": "Microsoft.NETCore.App", "version": "8.0.0"}}}))
        executed = subprocess.run([str(dotnet), str(output / "Probe.dll"), str(output / "dynamic.json")],
                                  cwd=ROOT, capture_output=True, timeout=30)
        assert executed.returncode == 0, executed.stdout.decode(errors="replace") + executed.stderr.decode(errors="replace")
        payload = json.loads((output / "dynamic.json").read_text(encoding="utf-8"))
        for suffix in ("empty", "missing", "invalid", "linked", "stale", "yonly", "unnamed"):
            payload["_" + suffix] = json.loads((output / ("dynamic.json." + suffix)).read_text(encoding="utf-8"))
        yield payload


def definition(payload):
    return payload["defs"]["A-DYNAMIC-TEST"]


def current(payload):
    return next(iter(payload["inserts"].values()))["values"]


def test_flip_definition_and_unknown_cache_are_safe(dynamic_payload):
    param = next(p for p in definition(dynamic_payload)["parameters"] if p["kind"] == "flip")
    assert param["value"] == 0
    assert param["labels"] == ["원래", "뒤집기"]
    assert param["p1"] == {"x": 3, "y": 4}
    assert param["p2"] == {"x": 3, "y": 9}
    action = next(a for a in definition(dynamic_payload)["actions"] if a["kind"] == "flip")
    assert action["param"] == 2 and len(action["handles"]) == 1
    assert current(dynamic_payload)["2"] is None  # Unknown flags must not become a length or guessed state.


def test_rotation_definition_and_reference_angle(dynamic_payload):
    param = next(p for p in definition(dynamic_payload)["parameters"] if p["kind"] == "rotation")
    assert param["value"] == pytest.approx(math.pi / 2)
    assert current(dynamic_payload)["3"] == pytest.approx(math.pi)
    action = next(a for a in definition(dynamic_payload)["actions"] if a["kind"] == "rotate")
    assert action["param"] == 3 and action["center"] == {"x": 10, "y": 20}


def test_xy_definition_current_value_and_both_connections(dynamic_payload):
    param = next(p for p in definition(dynamic_payload)["parameters"] if p["kind"] == "xy")
    assert param["value"] == {"x": 10, "y": -10}
    assert param["baseLocation"] == "MiddlePoint"
    assert (param["labelX"], param["labelY"]) == ("가로", "세로")
    assert current(dynamic_payload)["4"] == {"x": -20, "y": 30}
    actions = [a for a in definition(dynamic_payload)["actions"] if a["kind"] in ("move", "stretch")]
    assert len(actions) == 2
    for action in actions:
        assert action["xConnection"] == {"id": 4, "name": "EndXDelta"}
        assert action["yConnection"] == {"id": 4, "name": "EndYDelta"}


def test_existing_linear_and_unverified_lookup(dynamic_payload):
    assert current(dynamic_payload)["1"] == 50
    assert dynamic_payload["unsupported"]["BlockLookupParameter"] == 1


def test_missing_and_degenerate_values_never_reset_to_zero(dynamic_payload):
    for suffix in ("missing", "invalid"):
        values = current(dynamic_payload["_" + suffix])
        assert values["2"] is None
        assert values["3"] is None
        assert values["4"] is None


def test_plain_drawing_has_no_added_metadata(dynamic_payload):
    assert dynamic_payload["_empty"] == {"version": 1, "defs": {}, "inserts": {}, "unsupported": {}}


def test_unsupported_is_reported_per_definition(dynamic_payload):
    assert definition(dynamic_payload)["unsupported"] == ["BlockLookupParameter"]


def test_linked_rotation_center_and_flip_axis_are_reported_unsupported(dynamic_payload):
    blocked = definition(dynamic_payload["_linked"])
    assert "BlockRotationAction.LinkedBasePoint" in blocked["unsupported"]
    assert "BlockFlipAction.LinkedAxis" in blocked["unsupported"]
    assert not any(action["kind"] in ("rotate", "flip") for action in blocked["actions"])


def test_stale_and_unsupported_cache_types_are_not_guessed(dynamic_payload):
    values = current(dynamic_payload["_stale"])
    for key in ("91", "92", "93", "5"):
        assert values[key] is None, f"Unknown cache {key} must not become a reusable value"
    for key in ("2", "3", "4"):
        assert values[key] is None


def test_y_only_connections_do_not_export_invalid_x_ids(dynamic_payload):
    actions = [a for a in definition(dynamic_payload["_yonly"])["actions"]
               if a["kind"] in ("move", "stretch")]
    assert len(actions) == 2
    for action in actions:
        assert action["param"] == 4
        assert action["xConnection"] is None
        assert action["yConnection"] == {"id": 4, "name": "EndYDelta"}


def test_xy_representative_name_is_separate_from_axis_labels(dynamic_payload):
    for suffix in ("", "_yonly"):
        payload = dynamic_payload[suffix] if suffix else dynamic_payload
        param = next(p for p in definition(payload)["parameters"] if p["kind"] == "xy")
        assert param["label"] == "이동 거리"
        assert param["labelX"] == "가로"
    unnamed = next(p for p in definition(dynamic_payload["_unnamed"])["parameters"] if p["kind"] == "xy")
    assert unnamed["label"] == "가로·세로"
