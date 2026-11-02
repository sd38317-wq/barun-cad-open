import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import exchange


def tags(*pairs, newline=b'\n'):
    return b''.join(str(code).encode()+newline+(value if isinstance(value,bytes) else str(value).encode())+newline for code,value in pairs)


def drawing(body, newline=b'\n'):
    return tags((0,'SECTION'),(2,'HEADER'),(9,'$ACADVER'),(1,'AC1032'),(0,'ENDSEC'),(0,'SECTION'),(2,'OBJECTS'),newline=newline)+body+tags((0,'ENDSEC'),(0,'EOF'),newline=newline)


class DgnPairFilterTests(unittest.TestCase):
    def test_dictionary_numeric_names_and_handle_are_preserved(self):
        for name in ('350','360'):
            with self.subTest(name=name):
                keep=tags((0,'DICTIONARY'),(5,'A'),(281,3),(3,name),(350,'ABC'))
                drop=tags((0,'LSDEFINITION'),(5,'350'))
                raw=drawing(keep+drop)
                self.assertEqual(exchange._dgn_filtered_bytes(raw),drawing(keep))

    def test_string_values_cannot_start_records(self):
        keep=tags((0,'XRECORD'),(5,'A'),(1,'0'),(1,'LSDEFINITION'),(1,'5'),(1,'BAD'))
        raw=drawing(keep)
        self.assertIs(exchange._dgn_filtered_bytes(raw),raw)

    def test_custom_class_punctuation_preserved_after_helper(self):
        keep=tags((0,'CUSTOM:OBJECT'),(5,'B'),(1,'keep'))
        self.assertEqual(exchange._dgn_filtered_bytes(drawing(tags((0,'LSDEFINITION'),(5,'A'))+keep)),drawing(keep))

    def test_malformed_pairs_leave_original_untouched(self):
        for body in (tags((0,'LSDEFINITION'),(5,'A'))+b'not-a-code\nx\n',tags((0,'LSDEFINITION'),(1,'missing handle'))):
            raw=drawing(body)
            self.assertIs(exchange._dgn_filtered_bytes(raw),raw)

    def test_crlf_dictionary_removal_and_other_sections_preserved(self):
        keep=tags((0,'DICTIONARY'),(5,'B'),(281,1),newline=b'\r\n')
        entries=tags((3,'ACAD_DGNLINESTYLECOMP'),(350,'C'),(3,'ordinary'),(360,'A'),newline=b'\r\n')
        drop=tags((0,'LSDEFINITION'),(5,'A'),newline=b'\r\n')
        raw=drawing(keep+entries+drop,newline=b'\r\n')
        self.assertEqual(exchange._dgn_filtered_bytes(raw),drawing(keep,newline=b'\r\n'))

    def test_binary_unchanged(self):
        raw=b'AutoCAD Binary DXF\r\nLSDEFINITION'
        self.assertIs(exchange._dgn_filtered_bytes(raw),raw)


class DgnTemporaryCopyTests(unittest.TestCase):
    def check_copy(self, unicode_text=False, fail=False, caller_root=False):
        with tempfile.TemporaryDirectory() as parent:
            root=Path(parent)
            original=drawing(tags((0,'LSDEFINITION'),(5,'A'))+tags((0,'XRECORD'),(5,'B'),(1,'한글'.encode() if unicode_text else 'keep')))
            source=root/'source.dxf';source.write_bytes(original)
            outputs=[]
            real_named=tempfile.NamedTemporaryFile
            def create(*args,**kwargs):
                result=real_named(*args,**kwargs);outputs.append(Path(result.name));return result
            def read(path):
                data=Path(path).read_bytes()
                self.assertNotIn(b'LSDEFINITION',data)
                if unicode_text:self.assertIn(b'\\U+D55C',data)
                if fail:raise RuntimeError('read failure')
                return 'document'
            with patch.object(exchange.tempfile,'tempdir',str(root)),patch.object(exchange.tempfile,'NamedTemporaryFile',side_effect=create),patch.object(exchange,'_readfile',side_effect=read):
                if fail:
                    with self.assertRaises(RuntimeError):exchange.read_dxf_preserving_unicode(source,root/'caller' if caller_root else None)
                else:self.assertEqual(exchange.read_dxf_preserving_unicode(source,root/'caller' if caller_root else None),'document')
            self.assertEqual(len(outputs),1)
            self.assertFalse(outputs[0].exists())
            self.assertEqual(source.read_bytes(),original)
            self.assertEqual(sorted(p.name for p in root.iterdir()),['caller','source.dxf'] if caller_root else ['source.dxf'])

    def test_unicode_fallback_reuses_copy_and_cleans_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'source.dxf'
            raw=drawing(tags((0,'LSDEFINITION'),(5,'A'))+tags((0,'XRECORD'),(5,'B'),(1,'한글'.encode())))
            source.write_bytes(raw);seen=[]
            def read(path):
                seen.append((Path(path),Path(path).read_bytes()))
                if len(seen)==1:raise exchange.ezdxf.DXFError('retry')
                return 'document'
            with patch.object(exchange,'_readfile',side_effect=read):
                self.assertEqual(exchange.read_dxf_preserving_unicode(source),'document')
            self.assertEqual(len(seen),2)
            self.assertEqual(seen[0][0],seen[1][0])
            self.assertNotEqual(seen[0][1],seen[1][1])
            self.assertIn('한글'.encode(),seen[1][1])
            self.assertNotIn(b'LSDEFINITION',seen[1][1])
            self.assertFalse(seen[0][0].parent.exists())
            self.assertEqual(source.read_bytes(),raw)

    def test_dgn_copy_cleanup(self):self.check_copy()
    def test_combined_unicode_uses_one_copy(self):self.check_copy(unicode_text=True)
    def test_copy_cleanup_after_reader_exception(self):self.check_copy(fail=True)
    def test_caller_root_retained_copy_removed(self):self.check_copy(caller_root=True)


if __name__=='__main__':unittest.main()


def test_plain_wall_text_skips_pair_walking():
    raw=tags((0,'SECTION'),(2,'ENTITIES'),(0,'TEXT'),(1,'WALLS'),(0,'ENDSEC'),
             (0,'SECTION'),(2,'OBJECTS'),(0,'DICTIONARY'),(5,'A'),(0,'ENDSEC'),(0,'EOF'))
    with patch.object(exchange.io,'BytesIO',side_effect=AssertionError('unexpected pair walk')):
        assert exchange._dgn_filtered_bytes(raw) is raw


def test_mixed_case_objects_section_still_filters_helpers():
    raw=drawing(tags((0,'LSDEFINITION'),(5,'A'))).replace(b'OBJECTS',b'Objects')
    assert exchange._dgn_filtered_bytes(raw)==drawing(b'').replace(b'OBJECTS',b'Objects')
