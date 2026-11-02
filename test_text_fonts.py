"""문자 글꼴(2026-09-26): DXF 저장 때 문자 스타일·글꼴을 유지하고(예전: 모두 BARUN_TEXT·맑은 고딕), PDF 는 원래 글꼴을 쓴다."""
import os,tempfile,unittest
import ezdxf
import exchange,pdf_service

def _read(raw):
    handle=tempfile.NamedTemporaryFile(suffix='.dxf',delete=False);handle.write(raw);handle.close()
    try:return ezdxf.readfile(handle.name)
    finally:os.unlink(handle.name)

class TextFontTests(unittest.TestCase):
    def test_text_style_and_font_survive_dxf_export(self):
        model={'version':2,'units':'mm','linetypeScale':1,'blocks':[],'layers':[{'id':'L0','name':'0','color':'#ffffff','visible':True,'locked':False}],
            'entities':[{'id':'a','type':'text','layer':'L0','position':{'x':0,'y':0},'text':'ROOM','height':250,'textStyle':'TITLE','sourceFont':'romans.shx','sourceBigFont':'whgtxt.shx'},
                        {'id':'b','type':'text','layer':'L0','position':{'x':0,'y':500},'text':'거실','height':250,'textStyle':'KOR','sourceFont':'gulim.ttc'},
                        {'id':'c','type':'text','layer':'L0','position':{'x':0,'y':900},'text':'무명','height':250}]}
        doc=_read(exchange.export_dxf(model)[0])
        styles={e.dxf.text:e.dxf.style for e in doc.modelspace() if e.dxftype()=='TEXT'}
        self.assertEqual(styles,{'ROOM':'TITLE','거실':'KOR','무명':'BARUN_TEXT'})
        self.assertEqual(doc.styles.get('TITLE').dxf.font,'romans.shx');self.assertEqual(doc.styles.get('TITLE').dxf.bigfont,'whgtxt.shx')
        self.assertEqual(doc.styles.get('KOR').dxf.font,'gulim.ttc')

    def test_standard_style_gets_the_text_font_and_same_name_different_fonts_split(self):
        # 검토 4: STYLE 로 'Standard' 스타일을 받은 한글 문자가 기본 STANDARD(txt, 큰 글꼴 없음)로 나가 ?로 보이던 문제.
        model={'version':2,'units':'mm','linetypeScale':1,'blocks':[],'layers':[{'id':'L0','name':'0','color':'#ffffff','visible':True,'locked':False}],
            'entities':[{'id':'a','type':'text','layer':'L0','position':{'x':0,'y':0},'text':'거실','height':250,'textStyle':'Standard','sourceFont':'malgun.ttf'},
                        {'id':'b','type':'text','layer':'L0','position':{'x':0,'y':500},'text':'A','height':250,'textStyle':'OLD','sourceFont':'romans.shx','sourceBigFont':'whgtxt.shx'},
                        {'id':'c','type':'text','layer':'L0','position':{'x':0,'y':900},'text':'B','height':250,'textStyle':'OLD','sourceFont':'malgun.ttf'}]}
        doc=_read(exchange.export_dxf(model)[0])
        styles={e.dxf.text:e.dxf.style for e in doc.modelspace() if e.dxftype()=='TEXT'}
        self.assertEqual(doc.styles.get(styles['거실']).dxf.font,'malgun.ttf')
        self.assertEqual(doc.styles.get(styles['A']).dxf.font,'romans.shx');self.assertEqual(doc.styles.get(styles['A']).dxf.bigfont,'whgtxt.shx')
        self.assertNotEqual(styles['A'],styles['B'],'글꼴이 다르면 변형 스타일로 나눈다')
        self.assertEqual(doc.styles.get(styles['B']).dxf.font,'malgun.ttf')
        self.assertEqual(doc.styles.get(styles['B']).dxf.get('bigfont',''),'')

    def test_pdf_font_follows_source_font_and_keeps_hangul_readable(self):
        pdf_service.font()
        self.assertEqual(pdf_service.text_font({'sourceFont':''},'x'),pdf_service.FONT)
        latin=pdf_service.text_font({'sourceFont':'romans.shx'},'ROOM')
        hangul=pdf_service.text_font({'sourceFont':'romans.shx'},'거실')
        if os.path.exists(os.path.join(os.environ.get('WINDIR','C:/Windows'),'Fonts','ARIALN.TTF')):self.assertEqual(latin,'CAD_arialn')
        self.assertNotEqual(hangul,'CAD_arialn','한글이 있으면 라틴 전용 글꼴을 쓰지 않는다')

if __name__=='__main__':unittest.main()
