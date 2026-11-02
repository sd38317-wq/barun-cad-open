import base64, io, unittest
from pdf_service import process
import pdf_service
from pypdf import PdfReader

def page(text,size):
    return dict(action='plot',size=size,margin=10,denominator=10,
                bounds=dict(minX=0,minY=0,maxX=1000,maxY=1000),
                entities=[dict(type='text',text=text,position=dict(x=100,y=100),height=40,color='#000000')])

class MultiPlotTest(unittest.TestCase):
    def test_order_and_individual_paper_sizes(self):
        result=process(dict(action='plots',pages=[page('FIRST',[420,297]),page('SECOND',[210,297])]))
        pages=PdfReader(io.BytesIO(base64.b64decode(result['data']))).pages
        self.assertEqual(len(pages),2)
        for p,text,width in zip(pages,['FIRST','SECOND'],[420,210]):
            self.assertIn(text,p.extract_text())
            self.assertAlmostEqual(float(p.mediabox.width),width*72/25.4,places=3)
    def test_invalid_page_fails_whole_export(self):
        for pages in [[],[{}],[page('OK',[420,297]),page('BAD',[1,1])]]:
            with self.assertRaises(ValueError):process(dict(action='plots',pages=pages))

if __name__=='__main__':unittest.main()


class PlotPlacementTest(unittest.TestCase):
    def test_offset_and_mirror_are_accepted_and_bad_offset_is_refused(self):
        base=dict(action='plot',size=[420,297],margin=10,denominator=100,bounds={'minX':0,'minY':0,'maxX':10000,'maxY':5000},
                  entities=[{'type':'line','points':[{'x':0,'y':0},{'x':10000,'y':5000}],'color':'#000000','lineweight':.25}])
        for extra in ({},{'center':False,'offsetX':5,'offsetY':7},{'mirror':True}):
            self.assertTrue(pdf_service.render_plot({**base,**extra}).startswith(b'%PDF'))
        with self.assertRaises(ValueError):pdf_service.render_plot({**base,'center':False,'offsetX':float('nan')})
