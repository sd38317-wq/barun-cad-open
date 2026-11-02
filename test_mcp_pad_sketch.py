"""패드 원획 읽기 도구: 브라우저·외부 연결은 mock으로 검사한다."""
import copy
import io
import json
import unittest
from unittest.mock import patch

import bridge
import mcp_server


@patch('miri_account_service.require_ai_login', new=lambda: None)
class PadSketchMcpTest(unittest.TestCase):
    def test_schema_is_object_and_tool_is_read_only(self):
        tool = next(t for t in bridge.TOOLS if t['name'] == 'cad_get_pad_sketch')
        schema = tool['inputSchema']
        self.assertEqual(schema['type'], 'object')
        self.assertFalse(schema['additionalProperties'])
        self.assertFalse({'oneOf', 'anyOf', 'allOf'} & schema.keys())
        self.assertIn('target', schema['properties'])
        self.assertNotIn('target', schema['required'])
        self.assertNotIn(tool['name'], bridge.MUTATING_TOOLS)
        self.assertEqual(schema['properties']['size']['maximum'], 2048)

    def test_call_dispatches_read_only_without_new_edit_operation(self):
        args = {'sketch_id': 'sketch-1', 'include_image': True, 'size': 512, 'target': {'mock': True}}
        result = {'sketches': [], 'applied': False, 'image': {'mimeType': 'image/png', 'data': 'UE5H'}}
        original = copy.deepcopy(args)
        with patch.object(bridge, 'dispatch', return_value=result) as dispatch:
            self.assertEqual({k:v for k,v in bridge.call('cad_get_pad_sketch',args,allow_edit=False).items() if k!='destination'}, result)
        dispatch.assert_called_once_with('cad_get_pad_sketch', args)
        self.assertEqual(args, original)
        with patch.object(bridge, 'dispatch', return_value={'sketches': [], 'sketch_id': None}) as dispatch:
            self.assertIsNone(bridge.call('cad_get_pad_sketch', {})['sketch_id'])
        dispatch.assert_called_once_with('cad_get_pad_sketch', {})

    def test_invalid_options_fail_before_browser_dispatch(self):
        for args in ({'size': 255}, {'size': 2049}, {'size': True}, {'size': 512.5}, {'include_image': 'false'}, {'sketch_id': ''}, {'sketch_id': 1}):
            with self.subTest(args=args), patch.object(bridge, 'dispatch') as dispatch:
                with self.assertRaises(ValueError):
                    bridge.call('cad_get_pad_sketch', args)
                dispatch.assert_not_called()

    def test_stdio_returns_same_image_and_text_shape_as_drawing_view(self):
        metadata = {'sketches': [{'id': 'sketch-1', 'bounds': {'minX': -1, 'minY': 0, 'maxX': 2, 'maxY': 3}}],
                    'window': {'minX': -2, 'minY': -1, 'maxX': 3, 'maxY': 4}, 'mmPerPixel': 0.1, 'width': 50, 'height': 50, 'applied': False}
        image = {'mimeType': 'image/png', 'data': 'UE5H'}
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'cad_get_pad_sketch', 'arguments': {}}}
        output = io.StringIO()
        with patch.object(mcp_server, 'call', return_value={**metadata, 'image': image}) as call, patch('sys.stdin', io.StringIO(json.dumps(request) + '\n')), patch('sys.stdout', output):
            mcp_server.serve()
        call.assert_called_once_with('cad_get_pad_sketch', {})
        result = json.loads(output.getvalue())['result']
        self.assertFalse(result['isError'])
        self.assertEqual(json.loads(result['content'][0]['text']), metadata)
        self.assertEqual(result['content'][1], {'type': 'image', **image})

    def test_browser_errors_become_mcp_tool_errors(self):
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'cad_get_pad_sketch', 'arguments': {'sketch_id': 'missing'}}}
        output = io.StringIO()
        with patch.object(mcp_server, 'call', side_effect=ValueError('패드 스케치가 없거나 지워졌습니다.')), patch('sys.stdin', io.StringIO(json.dumps(request) + '\n')), patch('sys.stdout', output):
            mcp_server.serve()
        self.assertTrue(json.loads(output.getvalue())['result']['isError'])


if __name__ == '__main__':
    unittest.main()
