"""Raster HTTP boundary and MCP schema, without live account or trial-server changes."""
import functools
import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import bridge
import image_service
import server


class ImageAPITests(unittest.TestCase):
    def test_mcp_schema_uses_pixel_and_drawing_tuples_and_bound_edit_rules(self):
        schema = next(t['inputSchema'] for t in bridge.TOOLS if t['name'] == 'cad_insert_image')
        self.assertIn('target', schema['required'])
        self.assertIn('cad_insert_image', bridge.MUTATING_TOOLS)
        self.assertEqual(bridge.BOUND_ALIASES['cad_insert_image_bound'], 'cad_insert_image')
        for name in ('imagePoints', 'drawingPoints'):
            pair = schema['properties']['align']['properties'][name]
            self.assertEqual((pair['minItems'], pair['maxItems']), (2, 2))
            self.assertEqual(pair['items']['type'], 'array')
            self.assertEqual(pair['items']['items']['type'], 'number')
        self.assertNotIn('cad_insert_image', {t['name'] for t in bridge.app_tools(allow_edit=False)})

    def test_rejects_traversal_disguised_payload_size_and_resolution(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'image.png'
            Image.new('RGB', (8, 4)).save(path)
            for value in (str(path.parent / '..' / path.parent.name / path.name),
                          '\\\\server\\image.png', str(path) + ':secret', 'relative.png'):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    image_service.validate_image_path(value)
            with patch.object(image_service, 'MAX_PIXELS', 10), self.assertRaises(ValueError):
                image_service.image_bytes(str(path))
            with self.assertRaises(ValueError):
                image_service.validate_image_path(str(path), max_bytes=1)
            path.write_bytes(b'private text disguised as a raster')
            with self.assertRaises(ValueError):
                image_service.image_bytes(str(path))

    def test_http_get_and_post_require_screen_credentials_and_return_verified_raster(self):
        class QuietHandler(server.Handler):
            def log_message(self, *args):
                pass

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'photo.png'
            Image.new('RGB', (7, 5), (30, 90, 120)).save(path)
            httpd = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(server.ROOT)))
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            self.addCleanup(httpd.server_close)
            self.addCleanup(httpd.shutdown)
            host = f'127.0.0.1:{httpd.server_port}'

            def request(method, route, payload=None, headers=None):
                conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port)
                try:
                    conn.request(method, route, json.dumps(payload) if payload else None, headers or {})
                    response = conn.getresponse()
                    return response.status, response.read()
                finally:
                    conn.close()

            from urllib.parse import quote
            route = '/api/image?path=' + quote(str(path))
            with patch.object(server, 'SHELL_SECRET', 'test-screen'):
                self.assertEqual(request('GET', route)[0], 403)
                self.assertEqual(request('GET', route, headers={'Sec-Fetch-Site': 'same-origin'})[0], 403)
                status, content = request('GET', route, headers={'Sec-Fetch-Site': 'same-origin', 'X-CAD-Token': server.TOKEN})
                self.assertEqual(status, 200)
                self.assertEqual(content, path.read_bytes())
                self.assertEqual(request('POST', '/api/image-read', {'path': str(path)})[0], 403)
                status, content = request('POST', '/api/image-read', {'path': str(path)},
                                          {'Origin': 'http://' + host, 'X-CAD-Token': server.TOKEN, 'Content-Type': 'application/json'})
                self.assertEqual(status, 200)
                result = json.loads(content)
                self.assertEqual((result['pixelWidth'], result['pixelHeight']), (7, 5))
                self.assertTrue(result['data'].startswith('data:image/png;base64,'))


if __name__ == '__main__':
    unittest.main()
