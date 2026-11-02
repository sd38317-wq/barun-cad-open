import json,unittest
from pathlib import Path
from miriboda_service import sunlight_pages,local_pdf

class SunlightDrawingTest(unittest.TestCase):
 def test_sheet_required_and_provider_limits(self):
  root=Path('test-fixtures/site-plan-v053')
  report=json.loads((root/'DEMO-CORNER-01_report.json').read_text(encoding='utf8'))
  site=json.loads((root/'demo_site.json').read_text(encoding='utf8'))['site']
  entities=json.loads((root/'DEMO-CORNER-01_entities.json').read_text(encoding='utf8'))['entities']
  review={'sunlight':report['sunlight'],'limits':[e for e in entities if e['layer']=='A-ENV-SUN' and e['type']=='LWPOLYLINE']}
  with self.assertRaises(ValueError):sunlight_pages(site,report,None)
  with self.assertRaises(ValueError):sunlight_pages(site,report,review)
  review['section']={'height':16,'credit':0,'floors':[],'cutX':8}
  pages=sunlight_pages(site,report,review)
  self.assertIn('정북 일조 검토도',pages[0]);self.assertIn('polygon',pages[0]);self.assertIn('1층',pages[0])
  self.assertTrue(local_pdf(pages).startswith(b'%PDF'))
  self.assertIn('단면검토',pages[-1])
  self.assertEqual(sunlight_pages(site,report,{'sunlight':{'applies':False}}),[])

 def test_report_section_and_neighbor_shadow_page(self):
  # 미리 일조 보고서(2026-10-30): 화면 없이 엔진 결과로 A–A 단면을 만들고, 이웃 필지별 동지 일조 쪽을 더한다
  from miriboda_service import sunlight_section,shadow_pages
  root=Path('test-fixtures/site-plan-v053')
  report=json.loads((root/'DEMO-CORNER-01_report.json').read_text(encoding='utf8'))
  site=json.loads((root/'demo_site.json').read_text(encoding='utf8'))['site']
  sun=report['sunlight'];section=sunlight_section(site,report['geometry'],sun)
  self.assertEqual({f['floor'] for f in section['floors']},set(range(1,len(report['geometry']['floors'])+1)))
  self.assertTrue(all(f['required']>0 and f['far']>=f['near'] for f in section['floors']))
  pages=shadow_pages({'okRatio':0.9,'cells':100,'cellSizeMm':285,'neighbors':[{'jibun':'213-16','cells':40,'okRatio':0.75,'minContinuousMin':70,'minTotalMin':130},{'jibun':'214','cells':0}],'worst':[]},'괴정동')
  self.assertIn('기준 미달 · 213-16',pages[0]);self.assertIn('1시간 10분',pages[0]);self.assertIn('범위 밖(우리 건물 그림자가 닿지 않는 먼 필지) 1필지',pages[0]);self.assertNotIn('>214',pages[0])
  self.assertTrue(local_pdf(sunlight_pages(site,report,{'sunlight':sun,'limits':[],'limitsFrom':'section','section':section})+pages).startswith(b'%PDF'))
  from miriboda_service import pages_dxf
  import ezdxf,io
  all_pages=sunlight_pages(site,report,{'sunlight':sun,'limits':[],'limitsFrom':'section','section':section})+pages
  msp=ezdxf.read(io.StringIO(pages_dxf(all_pages).decode())).modelspace()
  frames=[e for e in msp if e.dxf.layer=='A-ANNO-FRAME'];self.assertEqual(len(frames),len(all_pages),'쪽마다 A4 한 장')
  self.assertTrue(any(e.dxftype()=='TEXT' and '213-16' in e.dxf.text for e in msp))

if __name__=='__main__':unittest.main()
