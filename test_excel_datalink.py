"""520 데이터 링크: excel_service 의 stat(원본 시각)·range(범위 다시 읽기). 기존 import/export 동작은 그대로인지도 본다."""
import base64,os,tempfile,time,unittest
from pathlib import Path
import excel_service


def workbook(path,sheets):
    from openpyxl import Workbook
    wb=Workbook();first=True
    for title,cells in sheets:
        ws=wb.active if first else wb.create_sheet();first=False
        ws.title=title
        for address,value in cells.items():ws[address]=value
    wb.save(path)


class DataLinkTest(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory();self.root=Path(self.dir.name)
        self.path=self.root/'면적표.xlsx'
        workbook(self.path,[('요약',{'A1':'무시'}),('실 면적',{'A1':'실명','B1':'면적','A2':'거실','B2':24.5,'A4':'침실','B4':12,'D4':'메모'})])

    def tearDown(self):self.dir.cleanup()

    def test_stat_reports_mtime_and_missing_file(self):
        st=excel_service.process({'action':'stat','path':str(self.path)})
        self.assertTrue(st['exists']);self.assertIsInstance(st['mtime'],int);self.assertGreater(st['size'],0)
        os.utime(self.path,ns=(1_700_000_000_000_000_000,1_700_000_000_000_000_000))
        self.assertEqual(excel_service.process({'action':'stat','path':str(self.path)})['mtime'],1_700_000_000_000)
        gone=excel_service.process({'action':'stat','path':str(self.root/'없음.xlsx')})
        self.assertFalse(gone['exists']);self.assertIsNone(gone['mtime'])
        for bad in ('',str(self.root/'a.csv'),'x\0.xlsx'):
            with self.assertRaises(ValueError):excel_service.process({'action':'stat','path':bad})

    def test_range_by_sheet_name_keeps_blank_rows_and_columns(self):
        r=excel_service.process({'action':'range','path':str(self.path),'range':"'실 면적'!A1:D4"})
        self.assertEqual(r['sheet'],'실 면적');self.assertEqual(r['range'],'A1:D4')
        self.assertEqual(r['rows'],[['실명','면적','',''],['거실',24.5,'',''],['','','',''],['침실',12,'','메모']])
        self.assertEqual(r['mtime'],excel_service.process({'action':'stat','path':str(self.path)})['mtime'])
        part=excel_service.process({'action':'range','path':str(self.path),'range':'실 면적!B2:A1'})
        self.assertEqual(part['rows'],[['실명','면적'],['거실',24.5]],'거꾸로 적은 범위도 바로잡음')
        self.assertEqual(excel_service.process({'action':'range','path':str(self.path),'range':'실 면적!$B$4'})['rows'],[[12]])

    def test_range_whole_sheet_and_first_sheet_default(self):
        whole=excel_service.process({'action':'range','path':str(self.path),'range':'실 면적'})
        self.assertEqual(len(whole['rows']),4);self.assertEqual(whole['range'],'A1:D4')
        first=excel_service.process({'action':'range','path':str(self.path),'range':''})
        self.assertEqual(first['sheet'],'요약');self.assertEqual(first['rows'],[['무시']])
        cells=excel_service.process({'action':'range','path':str(self.path),'range':'A1:B1'})
        self.assertEqual(cells['rows'],[['무시','']],'시트를 안 적으면 워크북 첫 시트')

    def test_range_errors_are_korean(self):
        with self.assertRaisesRegex(ValueError,'시트'):excel_service.process({'action':'range','path':str(self.path),'range':'없는시트!A1'})
        with self.assertRaisesRegex(ValueError,'찾을 수 없'):excel_service.process({'action':'range','path':str(self.root/'b.xlsx'),'range':''})
        with self.assertRaisesRegex(ValueError,'100열'):excel_service.process({'action':'range','path':str(self.path),'range':'A1:CW2'})
        with self.assertRaisesRegex(ValueError,'읽을 수 없'):excel_service.process({'action':'range','path':str(self.path),'range':'A1:B2:C3'})

    def test_parse_range(self):
        self.assertEqual(excel_service.parse_range("'it''s'!a1:c3"),("it's",(1,1,3,3)))
        self.assertEqual(excel_service.parse_range('B2'),(None,(2,2,2,2)))
        self.assertEqual(excel_service.parse_range('Sheet1!'),('Sheet1',None))
        self.assertEqual(excel_service.parse_range(''),(None,None))
        self.assertEqual(excel_service.column_letters(28),'AB')

    def test_existing_import_export_unchanged(self):
        exported=excel_service.process({'action':'export','rows':[['a','b'],[1,2]]})
        data=base64.b64decode(exported['data'])
        imported=excel_service.process({'action':'import','data':base64.b64encode(data).decode()})
        self.assertEqual(imported['rows'],[['a','b'],[1,2]])
        self.assertEqual(imported['sheets'][0]['title'],'도면표')
        with self.assertRaises(ValueError):excel_service.process({'action':'nope'})


if __name__=='__main__':unittest.main()
