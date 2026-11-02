"""Offline dimension compatibility for the bundled ACadSharp 3.8.0 writer.

DXF keeps the real LARGE_RADIAL_DIMENSION. Only the temporary DWG input is
lowered to a radial DIMENSION with the same handle, dimension picture and style.
This is a visible/editable fallback, not AutoCAD's native jogged-radius behavior.
"""
import math

JOGGED_APPID = 'BARUN_JOGGED_RADIUS'
JOGGED_SCHEMA = 'JOGGED_RADIUS_V1'
BREAK_APPID = 'BARUN_DIMBREAK'
BREAK_SCHEMA = 'BREAKS_V1'


def jogged_points(entity):
    """Recover the extra WCS definition points, while native radial points win."""
    if entity.dxftype() != 'DIMENSION' or entity.dxf.dimtype & 7 != 4:
        return None
    if not entity.has_xdata(JOGGED_APPID):
        return None
    tags = entity.get_xdata(JOGGED_APPID)
    if len(tags) != 4 or tags[0].code != 1000 or tags[0].value != JOGGED_SCHEMA:
        return None
    if tags[1].code != 1011 or tags[2].code != 1011 or tags[3].code != 1040:
        return None
    if not all(math.isfinite(v) for tag in tags[1:3] for v in tag.value):
        return None
    if not math.isfinite(tags[3].value):
        return None
    return (tags[1].value, tags[2].value)


def lower_jogged_dimensions(doc):
    """Change only jogged entities in the staged DXF, preserving handle/order.

    ACadSharp's closed internal reader/writer dispatch has no external entity
    registration hook for AcDbRadialDimensionLarge. Without a newer offline
    package or a full source fork, use the supported radial-dimension writer.
    """
    from ezdxf.entities import Dimension, factory
    count = 0
    for block in doc.blocks:
        entities = block.entity_space.entities
        for index, original in enumerate(entities):
            if original.dxftype() != 'LARGE_RADIAL_DIMENSION':
                continue
            geometry = original.dxf.get('geometry', '')
            if not geometry or geometry not in doc.blocks or not len(doc.blocks[geometry]):
                raise ValueError('꺾인 반지름 치수의 표시 블록이 없어 DWG 저장을 중단했습니다. DXF로 저장하세요.')
            attrs = {k: v for k, v in original.dxf.all_existing_dxf_attribs().items()
                     if Dimension.DXFATTRIBS.get(k) is not None}
            attrs.update(dimtype=(original.dxf.dimtype & ~7) | 4,
                         defpoint4=original.dxf.chord_point, leader_length=0)
            replacement = factory.new('DIMENSION', dxfattribs=attrs, doc=doc)
            # The handle is unchanged, so dictionary ownership, reactors and
            # references to this dimension remain valid. Do not destroy original:
            # that would also destroy the dictionary we transferred.
            for key in ('appdata', 'reactors', 'extension_dict', 'xdata', 'proxy_graphic'):
                setattr(replacement, key, getattr(original, key))
            if JOGGED_APPID not in doc.appids:
                doc.appids.new(JOGGED_APPID)
            replacement.set_xdata(JOGGED_APPID, [
                (1000, JOGGED_SCHEMA), (1011, original.dxf.override_center),
                (1011, original.dxf.jog_point), (1040, original.dxf.get('unknown2', math.pi / 4)),
            ])
            doc.entitydb[replacement.dxf.handle] = replacement
            entities[index] = replacement
            count += 1
    return count
