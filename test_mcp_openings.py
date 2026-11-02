"""MCP contract tests for the AI opening suggestion tools.

These tests deliberately mock the CAD bridge boundary.  They verify that the
transport and bridge enforce the read/edit split without requiring a browser.
"""
import copy
import io
import json
import time
import unittest
import uuid
import threading
from unittest.mock import patch

import bridge
import mcp_server


@patch('miri_account_service.require_ai_login', new=lambda: None)
class McpOpeningsTest(unittest.TestCase):
    def setUp(self):
        with bridge.lock:
            bridge.clients.clear()
            bridge.queue.clear()
            bridge.results.clear()
            bridge.pending_requests.clear()
            bridge.active = None
        self.session = str(uuid.uuid4())
        self.document = {
            "entities": [
                {"id": "room", "type": "polyline", "layer": "A-AREA-LIVING"},
                {"id": "wall", "type": "wall", "points": [{"x": 0, "y": 0}, {"x": 4000, "y": 0}], "openings": []},
            ]
        }
        with bridge.lock:
            bridge.clients[self.session] = {
                "protocol_version": 1,
                "document_generation": str(uuid.uuid4()),
                "snapshot_id": str(uuid.uuid4()),
                "revision": 0,
                "document_revision": 0,
                "document": copy.deepcopy(self.document),
                "seen": time.monotonic(),
            }
            bridge.active = self.session
        self.target = bridge.snapshot()["target"]

    def tearDown(self):
        with bridge.lock:
            bridge.clients.clear(); bridge.queue.clear(); bridge.results.clear(); bridge.pending_requests.clear(); bridge.active = None

    def test_schemas_are_flat_and_apply_is_bound_edit(self):
        for name in ("cad_suggest_openings", "cad_check_daylight", "cad_apply_openings"):
            tool = next(t for t in bridge.TOOLS if t["name"] == name)
            schema = tool["inputSchema"]
            self.assertEqual(schema["type"], "object")
            self.assertFalse(any(k in schema for k in ("oneOf", "anyOf", "allOf")))
        apply = next(t for t in bridge.TOOLS if t["name"] == "cad_apply_openings")
        self.assertIn("target", apply["inputSchema"]["required"])
        self.assertIn("expectedRevision", apply["inputSchema"]["required"])
        self.assertIn("cad_apply_openings", bridge.MUTATING_TOOLS)
        self.assertEqual(bridge.BOUND_ALIASES["cad_apply_openings_bound"], "cad_apply_openings")
        self.assertNotIn("cad_apply_openings_bound", {t["name"] for t in bridge.TOOLS})

    def test_read_tools_dispatch_and_preserve_editor_session(self):
        for name, args in (
            ("cad_suggest_openings", {"rooms": ["room"], "north": 90, "editor_session": self.session}),
            ("cad_check_daylight", {"editor_session": self.session}),
        ):
            with self.subTest(name=name), patch.object(bridge, "dispatch", return_value={"ok": True}) as dispatch:
                self.assertEqual({k:v for k,v in bridge.call(name,args).items() if k!="destination"}, {"ok": True})
                dispatch.assert_called_once_with(name, args)

    def test_read_dispatch_resolves_named_nonactive_editor_and_rejects_bad_session(self):
        other = str(uuid.uuid4())
        with bridge.lock:
            bridge.clients[other] = {**bridge.clients[self.session], "document": {"entities": [{"id": "other"}]},
                                     "document_generation": str(uuid.uuid4()), "snapshot_id": str(uuid.uuid4())}
            # Keep self.session active so this proves the explicit session is honored.
        captured = {}
        def invoke():
            captured["value"] = bridge.call("cad_suggest_openings", {"editor_session": other})
        worker = threading.Thread(target=invoke); worker.start()
        with bridge.lock:
            while not bridge.queue.get(other): bridge.lock.wait(0.01)
            request = bridge.queue[other][0]
            self.assertEqual(request["args"]["editor_session"], other)
            bridge.results[request["id"]] = {"result": {"rooms": []}}
            bridge.lock.notify_all()
        worker.join(2)
        self.assertEqual({k:v for k,v in captured["value"].items() if k!="destination"}, {"rooms": []})
        self.assertEqual(captured["value"]["destination"]["editor_session"],other)
        for bad in ("not-a-uuid", str(uuid.uuid4())):
            with self.assertRaises(ValueError): bridge.call("cad_suggest_openings", {"editor_session": bad})

    def test_apply_requires_target_and_expected_revision_before_dispatch(self):
        proposal = [{"room": "room", "kind": "WINDOW", "wallId": "wall", "offset": 1000, "width": 1200}]
        with patch.object(bridge, "dispatch", return_value={"applied": True}) as dispatch:
            value = bridge.call("cad_apply_openings", {"target": self.target, "expectedRevision": 0, "proposals": proposal})
            self.assertEqual({k:v for k,v in value.items() if k!="destination"}, {"applied": True})
            self.assertEqual(value["destination"]["editor_session"],self.session)
            dispatch.assert_called_once()
        for missing in ({"expectedRevision": 0, "proposals": proposal}, {"target": self.target, "proposals": proposal}):
            with self.subTest(missing=missing), patch.object(bridge, "dispatch") as dispatch:
                with self.assertRaises(ValueError): bridge.call("cad_apply_openings", missing)
                dispatch.assert_not_called()

    def test_apply_rejects_read_only_mode_and_stale_revision(self):
        args = {"target": self.target, "expectedRevision": 0, "proposals": []}
        with patch.object(bridge, "dispatch") as dispatch:
            with self.assertRaises(ValueError): bridge.call("cad_apply_openings", args, allow_edit=False)
            dispatch.assert_not_called()
        stale = {**args, "expectedRevision": 1}
        with patch.object(bridge, "dispatch") as dispatch:
            with self.assertRaises(ValueError): bridge.call("cad_apply_openings", stale)
            dispatch.assert_not_called()

    def test_mcp_transport_routes_new_tools_with_read_and_edit_timeouts(self):
        state = {"url": "http://127.0.0.1:1", "token": "mock"}
        for name, timeout in (("cad_suggest_openings", 30), ("cad_check_daylight", 30), ("cad_apply_openings", 30)):
            with self.subTest(name=name), patch.object(mcp_server, "_grant", return_value="test-grant"), patch.object(mcp_server, "find_connection", return_value=state), patch.object(mcp_server, "_alive", return_value=True), patch("urllib.request.urlopen", return_value=io.BytesIO(b"{}")) as urlopen:
                self.assertEqual({k:v for k,v in mcp_server.call(name,{}).items() if k!="destination"}, {})
                self.assertEqual(urlopen.call_args.kwargs["timeout"], timeout)
                self.assertEqual(json.loads(urlopen.call_args.args[0].data), {"name": name, "arguments": {}})

    def test_tools_list_exposes_opening_tools(self):
        stdin = io.StringIO(json.dumps({"id": 1, "method": "tools/list"}) + "\n")
        stdout = io.StringIO()
        with patch.object(mcp_server.sys, "stdin", stdin), patch.object(mcp_server.sys, "stdout", stdout):
            mcp_server.serve()
        names = {t["name"] for t in json.loads(stdout.getvalue())["result"]["tools"]}
        self.assertTrue({"cad_suggest_openings", "cad_check_daylight", "cad_apply_openings"} <= names)


class ImportedDaylightTest(unittest.TestCase):
    def test_usertest_w1_linework_is_connected_after_dxf_import(self):
        import subprocess
        from pathlib import Path
        import exchange
        root = Path(__file__).resolve().parent
        # 주택_저장.dxf의 실제 안방·남창·WALDRAW/FT 벽만 추출(원래 사용자시험.dxf는 빈 R12 파일).
        doc = exchange.import_file((root / 'tools/fixtures/usertest-daylight.dxf').read_bytes(), '.dxf')['document']
        self.assertTrue(any(e['id'] == 'b2d6d45e-f47b-48a1-a90b-0a085a9525ad' for e in doc['entities']))
        script = """
import {readFileSync} from 'node:fs';
import {checkDaylight,roomWallContacts} from './compute/opening-planner.js';
const doc=JSON.parse(readFileSync(0,'utf8')),before=JSON.stringify(doc);
const unknown=checkDaylight(doc,{rooms:['안방']}),contacts=roomWallContacts(doc);
const unchanged=JSON.stringify(doc)===before;
for(const e of doc.entities.filter(e=>doc.layers.find(l=>l.id===e.layer)?.name==='A-GLAZ')){e.height=1500;e.openableRatio=0;}
console.log(JSON.stringify({unknown,contacts,unchanged,known:checkDaylight(doc,{rooms:['안방']})}));
"""
        run = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(doc), text=True,
                             encoding='utf-8', capture_output=True, cwd=root, timeout=30, check=True)
        result = json.loads(run.stdout)
        self.assertTrue(result['unchanged'])
        self.assertFalse(any(n['key'] == 'windows' for n in result['unknown']['needs']))
        self.assertTrue(any(n['key'] == 'windowDimensions' for n in result['unknown']['needs']))
        self.assertEqual(result['unknown']['checks'][0]['daylight']['provided'], 0)
        self.assertTrue(any(c['exterior'] and abs(c['end']-c['start']-2400) < .01 for c in result['contacts']))
        self.assertEqual(result['known']['checks'][0]['daylight']['provided'], 3.6)
        self.assertEqual(result['known']['checks'][0]['ventilation']['provided'], 0)


if __name__ == "__main__":
    unittest.main()
