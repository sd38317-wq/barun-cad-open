"""IMAGE output: actual PDF pixels verify fade and ink over raster."""
import base64
import io
import unittest
from PIL import Image
import pymupdf
import pdf_service

class ImagePlotTests(unittest.TestCase):
    def test_pdf_image_fade_and_line_over_it(self):
        image=Image.new('RGB',(100,100),'black');source=io.BytesIO();image.save(source,format='PNG')
        raster={'type':'image','data':'data:image/png;base64,'+base64.b64encode(source.getvalue()).decode(),
                'position':{'x':0,'y':0},'width':100,'height':100,'rotation':0,'fade':40,'opacity':1}
        line={'type':'line','points':[{'x':0,'y':50},{'x':100,'y':50}], 'color':'#00ff00','lineweight':2}
        job={'size':[120,120],'margin':0,'denominator':1,'bounds':{'minX':0,'minY':0,'maxX':100,'maxY':100},'entities':[raster,line]}
        raw=pdf_service.render_plot(job)
        with pymupdf.open(stream=raw,filetype='pdf') as pdf:
            page=pdf[0];pix=page.get_pixmap(matrix=pymupdf.Matrix(1/pdf_service.MM,1/pdf_service.MM),alpha=False)
            rgb=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
            self.assertTrue(all(abs(v-102)<=3 for v in rgb.getpixel((40,40))))
            self.assertEqual(rgb.getpixel((40,60)),(0,255,0))
        raster['fade']=90
        raw=pdf_service.render_plot(job)
        with pymupdf.open(stream=raw,filetype='pdf') as pdf:
            pix=pdf[0].get_pixmap(matrix=pymupdf.Matrix(1/pdf_service.MM,1/pdf_service.MM),alpha=False)
            rgb=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
            self.assertTrue(all(abs(v-230)<=3 for v in rgb.getpixel((40,40))))

if __name__=='__main__':unittest.main()
