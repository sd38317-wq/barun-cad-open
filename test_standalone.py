"""Regression checks for local exports without development tools/accounts."""
import base64,io,json,tempfile,unittest,zipfile,os
from pathlib import Path
from unittest.mock import patch
import excel_service

class StandaloneExportTest(unittest.TestCase):
    def test_export_without_home_runtime_or_process(self):
        with tempfile.TemporaryDirectory() as home,patch.dict(os.environ,{'USERPROFILE':home,'HOME':home,'PATH':''}),patch('subprocess.run',side_effect=AssertionError('External process')):
            payload=json.loads(Path('test-fixtures/exchange/workflows-table.json').read_text(encoding='utf8'))
            payload['rows'][1][1]=20
            result=excel_service.process(payload)
            self.assertAlmostEqual(excel_service.read_xlsx(base64.b64decode(result['data']))['rows'][9][1],81.375)
            self.assertEqual(result['warnings'],[])
    def test_literal_formula_and_unsupported_formula(self):
        from openpyxl import load_workbook
        result=excel_service.process({'action':'export','rows':[['=1+2',3]],'formulas':[{'cell':'B2','formula':'=SUM(B1:B1)'}]})
        book=load_workbook(io.BytesIO(base64.b64decode(result['data'])))
        self.assertEqual(book.active['A1'].data_type,'s')
        self.assertEqual(book.active['B2'].value,'=SUM(B1:B1)')
        self.assertTrue(result['warnings'])
    def test_circular_formula_does_not_hang(self):
        result=excel_service.process({'action':'export','rows':[[1,2]],'formulas':[{'cell':'A1','formula':'=B1'},{'cell':'B1','formula':'=A1'}]})
        self.assertTrue(result['warnings'])
    def test_request_cannot_write_arbitrary_output(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'keep.txt';target.write_text('keep')
            excel_service.process({'action':'export','rows':[[1]],'output':str(target),'preview':str(target)})
            self.assertEqual(target.read_text(),'keep')

if __name__=='__main__':unittest.main()
