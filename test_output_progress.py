"""Progress is observational: identical payloads produce byte-identical outputs."""
import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from reportlab import rl_config
from pypdf import PdfReader
import batch_converter
import exchange
import output_jobs
import pdf_service
import server
from test_critic_e import LiveServer, doc
from test_critic_e2 import register, SECRET


def broken(_):
    raise RuntimeError('presentation failed')


class ProgressTests(unittest.TestCase):
    def setUp(self):
        output_jobs.clear()
        # Only tests freeze metadata. Production PDF settings are untouched.
        self.invariant = patch.object(rl_config, 'invariant', 1)
        self.invariant.start()
        self.addCleanup(self.invariant.stop)
        Path('tmp').mkdir(exist_ok=True)

    def test_registry_claim_bounds_snapshot_and_expiry(self):
        job = output_jobs.create('pdf'); jid = job['job_id']
        self.assertFalse(output_jobs.claim(jid, 'export'))
        self.assertTrue(output_jobs.claim(jid, 'pdf'))
        self.assertFalse(output_jobs.claim(jid, 'pdf'))
        for i in range(450):
            output_jobs.update(jid, phase='render', current=i+1, total=450, name=str(i), completed=True)
        snap = output_jobs.status(jid)
        self.assertEqual(len(snap['events']), 200)
        snap['events'][0]['name'] = 'changed outside registry'
        self.assertNotEqual(snap['events'], output_jobs.status(jid)['events'])
        self.assertEqual(output_jobs.finish(jid)['status'], 'finished')
        output_jobs.update(jid, phase='render')
        self.assertEqual(output_jobs.status(jid)['status'], 'finished')
        orphan = output_jobs.create('export')['job_id']
        now = output_jobs.time.monotonic()
        with patch.object(output_jobs.time, 'monotonic', return_value=now+output_jobs.QUEUED_TTL+1):
            self.assertIsNone(output_jobs.status(orphan))
            self.assertIsNotNone(output_jobs.create('pdf'))
        for _ in range(output_jobs.MAX_FINISHED+3):
            output_jobs.finish(output_jobs.create('pdf')['job_id'])
        self.assertLessEqual(sum(j.status == 'finished' for j in output_jobs._jobs.values()), output_jobs.MAX_FINISHED)

    def plot(self):
        return {'action':'plot', 'size':[297,210], 'margin':0, 'denominator':100,
                'bounds':{'minX':0,'minY':0,'maxX':1000,'maxY':1000},
                'entities':[{'type':'line','points':[{'x':0,'y':0},{'x':1000,'y':1000}]}],
                'bookmark':'A-01 평면도', 'stamp':False}

    def compare_pdf(self, request, total):
        before = pdf_service.process(request)['data']
        seen = []
        self.assertEqual(before, pdf_service.process(request, seen.append)['data'])
        self.assertEqual(before, pdf_service.process(request, broken)['data'])
        pages = PdfReader(io.BytesIO(base64.b64decode(before))).pages
        self.assertEqual(len(pages), total)
        starts = [e for e in seen if e.get('phase') == 'render' and not e.get('completed')]
        done = [e for e in seen if e.get('completed')]
        self.assertEqual([e['current'] for e in starts], list(range(1, total+1)))
        self.assertEqual([e['current'] for e in done], list(range(1, total+1)))
        self.assertTrue(all(e['total'] == total for e in starts+done))
        return seen

    def test_single_and_multi_plot_bytes_and_invalid_page(self):
        self.compare_pdf(self.plot(), 1)
        self.compare_pdf({'action':'plots','pages':[self.plot(),self.plot()]}, 2)
        with self.assertRaisesRegex(ValueError, '페이지 형식'):
            pdf_service.process({'action':'plots','pages':[None]}, lambda _: None)

    def test_200_real_sheets_have_exact_completion_sequence_and_same_bytes(self):
        sheets = [{'number':f'A-{i+1:03}', 'title':'평면도', 'bounds':self.plot()['bounds'],
                   'entities':self.plot()['entities'], 'stamp':False} for i in range(200)]
        events = self.compare_pdf({'action':'render','sheets':sheets}, 200)
        self.assertEqual(events[0]['name'], 'A-001 평면도')
        self.assertTrue(any(e.get('name') == 'A-200 평면도' and e.get('completed') for e in events))

    def test_tiles_report_guide_and_each_real_sheet_without_changing_bytes(self):
        from test_plot_tiles import A1
        self.compare_pdf({**A1, 'stamp':None, 'tile':{'paper':'A4','overlap':10}}, 10)

    def test_dwg_callback_preserves_converter_input_and_output_bytes(self):
        source = b'0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'
        expected = b'AC1032\x00fixed converter output\xff'
        inputs = []
        def convert(data):
            inputs.append(Path(data['_source_path']).read_bytes())
            path = Path(data['folder'])/'save.dwg'; path.write_bytes(expected)
            return {'path':str(path), 'after':1, 'sourceEntities':1, 'engine':'fixture'}
        with tempfile.TemporaryDirectory(dir='tmp') as folder, patch.object(batch_converter.tempfile,'tempdir',folder), patch.object(batch_converter,'process',side_effect=convert):
            # 시간 기록(timings_ms)은 매번 달라지므로 빼고 비교한다.
            plain = lambda r: (r[0], {k:v for k,v in r[1].items() if k != 'timings_ms'})
            before = plain(batch_converter.dxf_to_dwg(source))
            events = []
            self.assertEqual(before, plain(batch_converter.dxf_to_dwg(source, progress=events.append)))
            self.assertEqual(before, plain(batch_converter.dxf_to_dwg(source, progress=broken)))
        self.assertEqual(before[0], expected)
        self.assertEqual(inputs, [source]*3)
        self.assertEqual(events[-1]['bytes'], len(expected))

    def post(self, live, route, data, job=None, token=None):
        headers = {'Content-Type':'application/json','Origin':live.origin,'X-CAD-Token':token or server.TOKEN}
        if job: headers['X-CAD-Output-Job'] = job
        request = Request(live.origin+'/api/'+route, json.dumps(data).encode(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_http_export_and_registered_file_bytes_are_identical_with_observer(self):
        source = doc('P', 3)
        dxf, warnings = exchange.export_dxf(source)
        dwg = b'AC1032\x00unchanged converter bytes'
        with patch.object(exchange,'export_dxf',return_value=(dxf,warnings)), patch.object(batch_converter,'dxf_to_dwg',return_value=(dwg,{'warnings':[]})), patch.object(server,'SHELL_SECRET',SECRET), patch.object(server.file_care,'warm_in_background',return_value=None), LiveServer() as live, tempfile.TemporaryDirectory(dir='tmp') as folder:   # 저장 뒤 캐시 데우기가 가짜 DWG 를 열어 두면 정리 때 파일이 잠긴다(캐시가 비은 PC 에서도)
            for fmt in ('dxf','dwg','bcad'):
                with self.subTest(format=fmt):
                    payload = {'document':source,'format':fmt}
                    code, before = self.post(live,'export',payload); self.assertEqual(code,200,before)
                    code, job = self.post(live,'output-jobs',{'action':'create','kind':'export'}); self.assertEqual(code,200)
                    code, after = self.post(live,'export',payload,job['job_id']); self.assertEqual(code,200,after)
                    self.assertEqual(before['data'], after['data'])
                    self.assertEqual(after['_outputProgress']['status'],'finished')
                    target = (Path(folder)/('actual.'+fmt)).resolve()
                    code, registered = register(live,str(target),fmt); self.assertEqual(code,200,registered)
                    _, job = self.post(live,'output-jobs',{'action':'create','kind':'export'})
                    code, saved = self.post(live,'export',{**payload,'saveToken':registered['saveToken']},job['job_id'])
                    self.assertEqual(code,200,saved)
                    self.assertEqual(target.read_bytes(), base64.b64decode(before['data']))
            self.assertEqual(self.post(live,'output-jobs',{'action':'create','kind':'pdf'},token='wrong')[0],403)
            self.assertEqual(self.post(live,'output-jobs',{'action':'status','jobId':'missing'})[0],404)
            _, job = self.post(live,'output-jobs',{'action':'create','kind':'pdf'})
            code, bad = self.post(live,'pdf',{'action':'plots','pages':[]},job['job_id'])
            self.assertEqual(code,400); self.assertEqual(bad['_outputProgress']['status'],'failed')

if __name__ == '__main__':
    unittest.main()
