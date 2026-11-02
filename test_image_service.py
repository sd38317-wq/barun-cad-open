import base64
import tempfile
import unittest
from pathlib import Path
from PIL import Image

import image_service

class ImageServiceTests(unittest.TestCase):
    def test_link_resolving_to_outside_share_is_refused(self):
        # 검토 B7: 입력은 로컬 경로여도 링크를 따라간 끝이 바깥 주소 공유 폴더면 거절, 사무실 NAS 는 허락.
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / 'a.png'
            Image.new('RGB', (2, 2)).save(image)
            for target, refused in ((r'\\evil.com\s\a.png', True), (r'\\8.8.8.8\s\a.png', True), (r'\\192.168.0.10\개발\a.png', False), (r'\\NAS\share\a.png', False)):
                with self.subTest(target=target), patch.object(Path, 'resolve', lambda self, strict=False, t=target: Path(t) if self == image else self):
                    if refused:
                        with self.assertRaisesRegex(ValueError, '바깥 네트워크'):
                            image_service.validate_image_path(str(image))
                    else:
                        try:
                            image_service.validate_image_path(str(image))
                        except ValueError as error:
                            self.assertNotIn('바깥 네트워크', str(error))
    def test_rejects_relative_and_extension_traversal(self):
        with self.assertRaises(ValueError): image_service.validate_image_path('..\\secret.png')
        with self.assertRaises(ValueError): image_service.validate_image_path('C:\\x\\photo.gif')

    def test_reads_raster_metadata_and_data_url(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'photo.png'
            Image.new('RGB',(7,5),(20,30,40)).save(path)
            out=image_service.image_read(str(path))
            self.assertEqual((out['pixelWidth'],out['pixelHeight']),(7,5))
            self.assertTrue(base64.b64decode(out['data'].split(',',1)[1]))

if __name__=='__main__': unittest.main()
