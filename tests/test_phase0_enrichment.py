import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from pipeline.phase0.image_identity import pixel_signature
from pipeline.phase0.dimension_candidates import match_text,consensus
from pipeline.phase0.normalize import catalog_records,base_document
from pipeline.phase0.run import classify_document,archive_superseded
from pipeline.phase0.utilization import usage_record
from pipeline.common.io import ROOT,digest,write_json
from pipeline.phase0.ocr_evidence import attach
import classified_drawing_service as service


class EnrichmentTests(unittest.TestCase):
    def test_recovered_ocr_requires_exact_identity_and_never_certifies_scale(self):
        record={'key':'g','rows':[{'id':'source','sha256':'image'}],'image_identity':{'pixel_sha256':'pixels'}}
        doc=base_document('g',['source']);doc['units']='px'
        evidence={'method_version':'numeric-ocr-1','document_id':'g','source_ids':['source'],
            'source_image_sha256':'image','identity_signature':digest(json.dumps(record['image_identity'],sort_keys=True).encode()),
            'schema_version':1,'status':'processed','verified':False,'numeric_texts':[],'dimension_candidates':[],
            'consensus':{'status':'ready_for_review','factor_candidate':5,'verified':False}}
        with tempfile.TemporaryDirectory() as temp:
            write_json(Path(temp)/'g.json',evidence);attach(doc,record,temp)
            self.assertIn('recovered_numeric_ocr',doc)
            self.assertEqual(classify_document(doc)['scale']['status'],'review')
            evidence['source_ids']=['another'];write_json(Path(temp)/'g.json',evidence)
            other=base_document('g',['source']);attach(other,record,temp)
            self.assertNotIn('recovered_numeric_ocr',other)
            self.assertEqual(other['flags'][-1]['code'],'ocr_evidence_identity_mismatch')

    def test_exact_pixel_signature_ignores_storage_mode_but_not_geometry(self):
        gray=Image.new('L',(8,8),255);gray.putpixel((2,2),0)
        self.assertEqual(pixel_signature(gray),pixel_signature(gray.convert('RGB')))
        different=gray.copy();different.putpixel((3,2),0)
        self.assertNotEqual(pixel_signature(gray),pixel_signature(different))
        transparent=gray.convert('RGBA');transparent.putpixel((2,2),(0,0,0,0))
        self.assertNotEqual(pixel_signature(gray),pixel_signature(transparent))

    def test_pixel_links_keep_all_source_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'pixels.sqlite'
            db=sqlite3.connect(path);db.execute('CREATE TABLE identities(encoded_sha256 TEXT,pixel_sha256 TEXT,status TEXT)')
            original=catalog_records(ROOT/'data/aihub-71465/full-catalog')[:2]
            for r in original: db.execute('INSERT INTO identities VALUES (?,?,?)',(r['key'],'same-pixels','verified'))
            db.commit();db.close()
            linked=catalog_records(ROOT/'data/aihub-71465/full-catalog',path)
            group=next(r for r in linked if r['image_identity'].get('pixel_sha256')=='same-pixels')
            self.assertEqual({r['id'] for r in group['rows']},{r['id'] for g in original for r in g['rows']})
            self.assertEqual(len(group['image_identity']['encoded_sha256s']),2)

    def test_dimension_endpoints_detected_as_hypotheses(self):
        gray=np.full((150,500),255,dtype=np.uint8)
        cv2.line(gray,(50,75),(450,75),0,1)
        for x in (50,450): cv2.line(gray,(x,63),(x,87),0,1)
        results=match_text(gray,{'id':'n','bbox':[230,55,40,12],'text':'4000'},'horizontal')
        self.assertEqual(len(results),1)
        self.assertAlmostEqual(results[0]['mm_per_pixel_candidate'],10)
        self.assertEqual(results[0]['status'],'review')
        self.assertEqual(match_text(np.full_like(gray,255),{'id':'n','bbox':[230,55,40,12],'text':'4000'},'horizontal'),[])

    def test_consensus_never_becomes_verified_scale(self):
        candidates=[{'text_id':str(i),'axis':'horizontal' if i<2 else 'vertical','mm_per_pixel_candidate':5.0} for i in range(3)]
        result=consensus(candidates)
        self.assertEqual(result['status'],'ready_for_review');self.assertFalse(result['verified'])
        doc=base_document('group',['source']);doc['metadata']={'housing_values':['APT'],'drawing_type_values':['FP']};doc['units']='px'
        doc['derived_dimension_candidates']={'consensus':result}
        self.assertEqual(classify_document(doc)['scale']['status'],'review')

    def test_relative_capability_not_physical_and_stale_outputs_only_ours(self):
        doc=base_document('group',['source']);doc['metadata']={'housing_values':['APT'],'drawing_type_values':['FP']};doc['units']='px'
        doc['entities']=[{'id':str(i),'layer':{'현관':'A-AREA-ENTRY','침실':'A-AREA-BED'}[name],'poly':[[i*20,0],[i*20+10,0],[i*20+10,10],[i*20,10]],'flags':[]} for i,name in enumerate(['현관','침실'])]
        result=usage_record(classify_document(doc),{},'n.json','c.json')
        self.assertTrue(result['capabilities']['relative_space_geometry']);self.assertFalse(result['capabilities']['physical_geometry'])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);directory=root/'data/normalized';directory.mkdir(parents=True)
            (directory/'ours.json').write_text(json.dumps({'pipeline_version':'phase0-1.0','source_ids':['x']}))
            (directory/'user.json').write_text(json.dumps({'schema_version':9}))
            changes=archive_superseded(root,set(),'test')
            self.assertEqual(len(changes),1);self.assertTrue((directory/'user.json').exists())
            self.assertTrue(Path(changes[0]['to']).exists())

    def test_readonly_search_capability_and_source_lookup(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);folder=root/'data/usability';folder.mkdir(parents=True)
            db=sqlite3.connect(folder/'test.sqlite')
            db.execute('CREATE TABLE documents(document_id TEXT,building_type TEXT,doc_type TEXT,doc_subtype TEXT,source_split TEXT,scale_verified INTEGER,relative_usable INTEGER,unit_ready INTEGER,priority INTEGER,bedrooms INTEGER,baths INTEGER,payload TEXT)')
            db.execute('CREATE TABLE sources(source_id TEXT,document_id TEXT)')
            db.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('g','APT','평면도','UNIT','mixed',0,1,0,100,3,2,json.dumps({'document_id':'g','source_ids':['original']})))
            db.execute('INSERT INTO sources VALUES (?,?)',('original','g'));db.commit();db.close()
            (folder/'current.json').write_text(json.dumps({'database':'test.sqlite'}))
            with patch.object(service,'ROOT',root):
                self.assertEqual(service.search({'usage':'relative_space_geometry'})['total'],1)
                self.assertEqual(service.search({'usage':'physical_geometry'})['total'],0)
                self.assertEqual(service.detail({'id':'original'})['document_id'],'g')
                with self.assertRaises(ValueError): service.search({'usage':'x;DROP TABLE documents'})


if __name__=='__main__': unittest.main()
