import ezdxf
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import exchange


def _model(entity):
    return {
        'units': 'mm',
        'layers': [{'id': 'underlay', 'name': '밑그림', 'color': '#808080', 'plot': False}],
        'entities': [dict(entity, layer='underlay', id='image-1')],
    }


def test_image_exports_as_external_image_and_imagedef(tmp_path):
    image = tmp_path / 'plan.jpg'
    image.write_bytes(b'fake')
    raw, warnings = exchange.export_dxf(_model({
        'type': 'image', 'path': str(image), 'position': {'x': 10, 'y': 20},
        'width': 300, 'height': 150, 'rotation': 12, 'fade': 73,
        'pixelWidth': 1200, 'pixelHeight': 600,
    }))
    out = tmp_path / 'out.dxf'
    out.write_bytes(raw)
    doc = ezdxf.readfile(out)
    images = list(doc.modelspace().query('IMAGE'))
    assert len(images) == 1
    assert images[0].dxf.insert.x == 10
    assert images[0].dxf.insert.y == 20
    assert images[0].dxf.image_size.x == 1200
    assert images[0].dxf.fade == 73
    assert doc.layers.get('밑그림').dxf.plot == 0
    assert doc.objects.query('IMAGEDEF')[0].dxf.filename == str(image)
    assert warnings == []


def test_embedded_image_is_warned_and_skipped_from_dxf():
    raw, warnings = exchange.export_dxf(_model({
        'type': 'image', 'data': 'data:image/png;base64,AAAA',
        'position': {'x': 0, 'y': 0}, 'width': 10, 'height': 10,
        'pixelWidth': 10, 'pixelHeight': 10,
    }))
    assert b'\nIMAGE\n' not in raw
    assert any('내장 데이터' in warning for warning in warnings)


def test_repeated_image_paths_share_one_definition_per_export(tmp_path):
    entity = {'type': 'image', 'path': str(tmp_path / 'photo.png'),
              'pixelWidth': 200, 'pixelHeight': 100,
              'position': {'x': 0, 'y': 0}, 'width': 200, 'height': 100}
    model = _model(entity)
    model['entities'] += [dict(model['entities'][0], id='image-2'),
                          dict(model['entities'][0], id='image-3', path=str(tmp_path / 'other.png'))]
    for i in range(2):
        raw, warnings = exchange.export_dxf(model)
        path = tmp_path / f'out-{i}.dxf'
        path.write_bytes(raw)
        doc = ezdxf.readfile(path)
        images = list(doc.modelspace().query('IMAGE'))
        assert len(images) == 3
        assert len(doc.objects.query('IMAGEDEF')) == 2
        assert images[0].dxf.image_def_handle == images[1].dxf.image_def_handle
        assert images[0].dxf.image_def_handle != images[2].dxf.image_def_handle
        assert warnings == []

