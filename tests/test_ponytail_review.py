import copy
import hashlib
import io
import json
import uuid
from unittest.mock import MagicMock, patch

import pytest
import bridge
import image_service
import pdf_service


def test_pulse_excludes_nested_image_bytes_from_snapshot_and_digest():
    session = str(uuid.uuid4())
    photo = {'type': 'image', 'data': 'data:image/png;base64,AAAA', 'path': 'C:/photo.png'}
    document = {'entities': [photo, {'type': 'block', 'entities': [photo]}],
                'sharedBlocks': {'ref': {'entities': [photo]}}}
    before = copy.deepcopy(document)
    data = {'client': session, 'editor_session': session, 'protocol_version': 1,
            'document_generation': str(uuid.uuid4()), 'revision': 0, 'document_revision': 0,
            'document': document}
    with patch.dict(bridge.clients, {}, clear=True), patch.object(bridge, 'schedule_recovery'), patch.object(bridge, 'active', None):
        bridge.pulse(data)
        state = bridge.clients[session]
        stored = state['document']
        assert 'data' not in stored['entities'][0]
        assert stored['entities'][0]['hasData'] is True
        assert stored['entities'][0]['path'] == photo['path']
        assert 'data' not in stored['sharedBlocks']['ref']['entities'][0]
        assert 'data' not in stored['entities'][1]['entities'][0]
        assert state['document_digest'] == hashlib.sha256(json.dumps(stored, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()
        bridge.pulse({**data, 'document': stored})
    assert document == before


def test_image_service_pixel_limit(tmp_path):
    path = tmp_path / 'photo.png'
    path.write_bytes(b'placeholder')
    image = MagicMock(format='PNG', width=5000, height=5000)
    image.__enter__.return_value = image
    with patch('PIL.Image.open', return_value=image):
        assert image_service.image_bytes(str(path))[0] == b'placeholder'
        image.width = 5001
        with pytest.raises(ValueError, match='해상도'):
            image_service.image_bytes(str(path))


def test_pdf_rejects_large_embedded_image_before_loading_pixels():
    from reportlab.pdfgen.canvas import Canvas
    canvas = Canvas(io.BytesIO())
    image = MagicMock(width=5001, height=5000)
    image.__enter__.return_value = image
    entity = {'type': 'image', 'data': 'data:image/png;base64,AAAA'}
    with patch('PIL.Image.open', return_value=image):
        with pytest.raises(ValueError, match='too large'):
            pdf_service.draw(canvas, entity, 1, 'color')
    image.load.assert_not_called()
