import copy
import unittest

from pipeline.phase0.normalize import base_document
from pipeline.validation.checks import run_checks
from pipeline.validation.findings import content_hash


def square(x=0, y=0, size=1000):
    return [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]


def valid_drawing():
    doc = base_document("pilot-valid", ["original/001"])
    doc["units"] = "mm"
    doc["status"] = "ready"
    doc["doc_type"] = "평면도"
    doc["doc_subtype"] = "UNIT"
    doc["building_type"] = "DETACHED"
    doc["scale_factor"] = 1
    doc["scale_corrected"] = False
    doc["eligible_for_phase1"] = True
    doc["scale"] = {
        "status": "verified",
        "scale_factor": 1,
        "output_units": "mm",
        "input_units": "mm",
        "evidence": [{
            "text_id": "t0",
            "printed_mm": 1000,
            "measurement_points": [[0, 0], [1000, 0]],
            "method": "test_fixture",
        }],
    }
    doc["entities"] = [
        {"id": "entry", "layer": "A-AREA-ENTRY", "class_name": "공간_현관", "poly": square(), "polys": [square()], "bbox": [0, 0, 1000, 1000], "flags": [], "source_refs": [{"source_id": "original/001", "annotation_id": 1, "annotation_index": 0}]},
        {"id": "bed", "layer": "A-AREA-BED", "class_name": "공간_침실", "poly": square(2000), "polys": [square(2000)], "bbox": [2000, 2000, 1000, 1000], "flags": [], "source_refs": [{"source_id": "original/001", "annotation_id": 2, "annotation_index": 1}]},
        {"id": "wall", "layer": "A-WALL", "class_name": "구조_벽체", "poly": square(500, 0, 200), "polys": [square(500, 0, 200)], "bbox": [500, 0, 200, 200], "flags": [], "source_refs": [{"source_id": "original/001", "annotation_id": 3, "annotation_index": 2}]},
        {"id": "door", "layer": "A-DOOR", "class_name": "구조_출입문", "poly": square(480, 0, 40), "polys": [square(480, 0, 40)], "bbox": [480, 0, 40, 40], "flags": [], "source_refs": [{"source_id": "original/001", "annotation_id": 4, "annotation_index": 3}]},
    ]
    return doc


def statuses(result):
    return {f["check_id"]: f["status"] for f in result["findings"]}


class ValidationTests(unittest.TestCase):
    def test_verified_normal_fixture_passes_structural_checks(self):
        doc = valid_drawing()
        result = run_checks(doc)
        got = statuses(result)
        for check in ("schema_conformance", "identifier_uniqueness", "valid_cross_references", "finite_coordinates", "unit_consistency", "required_geometry", "polygon_validity", "layer_membership", "dimension_versus_geometry"):
            self.assertEqual(got[check], "PASS", check)
        self.assertEqual(got["access_connectivity"], "INDETERMINATE")
        self.assertEqual(got["relationship_consistency"], "INDETERMINATE")
        self.assertFalse(result["legal_or_structural_claim"])
        self.assertTrue(result["candidate_reference"])

    def test_self_intersecting_boundary_is_detected(self):
        doc = valid_drawing()
        bowtie = [[0, 0], [1000, 1000], [1000, 0], [0, 1000]]
        doc["entities"][1]["poly"] = bowtie
        doc["entities"][1]["polys"] = [bowtie]
        result = run_checks(doc)
        self.assertEqual(statuses(result)["polygon_validity"], "FAIL")
        self.assertEqual(statuses(run_checks(valid_drawing()))["polygon_validity"], "PASS")

    def test_invalid_entity_reference_is_detected(self):
        doc = valid_drawing()
        doc["dimension_pairs"] = [{"text_id": "missing-text", "line_id": "missing-line"}]
        result = run_checks(doc)
        self.assertEqual(statuses(result)["valid_cross_references"], "FAIL")

    def test_incorrect_dimension_value_is_detected(self):
        doc = valid_drawing()
        doc["scale"]["evidence"][0]["printed_mm"] = 5000
        result = run_checks(doc)
        self.assertEqual(statuses(result)["dimension_versus_geometry"], "FAIL")

    def test_invalid_host_wall_relationship_is_detected(self):
        doc = valid_drawing()
        relationships = {
            "schema_version": 1,
            "kind": "drawing_relationships_overlay",
            "document_id": doc["document_id"],
            "review_status": "accepted",
            "authoritative": True,
            "host_wall_candidates": [{"opening_id": "door", "host_wall_id": "bed", "status": "accepted"}],
        }
        result = run_checks(doc, relationships)
        self.assertEqual(statuses(result)["relationship_consistency"], "FAIL")

    def test_disconnected_accepted_access_is_detected(self):
        doc = valid_drawing()
        relationships = {
            "schema_version": 1,
            "kind": "drawing_relationships_overlay",
            "document_id": doc["document_id"],
            "review_status": "accepted",
            "authoritative": True,
            "host_wall_candidates": [{"opening_id": "door", "host_wall_id": "wall", "status": "accepted"}],
            "access_edges": [{"opening_id": "door", "space_ids": ["entry", "bed"], "review_status": "accepted"}],
        }
        # The graph includes both spaces, so force a third unreachable space.
        extra = {"id": "other", "layer": "A-AREA-OTHER", "class_name": "공간_기타", "poly": square(4000), "polys": [square(4000)], "bbox": [4000, 4000, 1000, 1000], "flags": [], "source_refs": [{"source_id": "original/001", "annotation_id": 9, "annotation_index": 9}]}
        doc["entities"].append(extra)
        result = run_checks(doc, relationships)
        self.assertEqual(statuses(result)["access_connectivity"], "FAIL")
        self.assertIn("other", result["findings"][-1]["affected_entity_ids"])

    def test_content_hash_changes_with_geometry(self):
        a = valid_drawing()
        b = copy.deepcopy(a)
        b["entities"][0]["poly"][0][0] = 12
        self.assertNotEqual(content_hash(a), content_hash(b))

    def test_review_evidence_in_pixels_still_matches_mm_scale(self):
        doc = valid_drawing()
        doc["scale"]["input_units"] = "px"
        doc["scale"]["output_units"] = "mm"
        doc["scale"]["scale_factor"] = 6.77
        doc["scale_factor"] = 6.77
        doc["scale"]["evidence"][0] = {
            "text_id": "t0",
            "printed_mm": 9090,
            "measurement_points": [[0, 0], [1342, 0]],
            "geometry_length": 1342,
            "method": "reviewed_raster_dimensions",
        }
        result = run_checks(doc)
        self.assertEqual(statuses(result)["dimension_versus_geometry"], "PASS")

    def test_missing_evidence_is_not_a_pass(self):
        doc = valid_drawing()
        doc["scale"] = {"status": "review"}
        doc["units"] = "px"
        doc["eligible_for_phase1"] = False
        doc["status"] = "review"
        result = run_checks(doc)
        got = statuses(result)
        self.assertEqual(got["dimension_versus_geometry"], "INDETERMINATE")
        self.assertEqual(got["access_connectivity"], "INDETERMINATE")
        self.assertNotEqual(got["dimension_versus_geometry"], "PASS")


if __name__ == "__main__":
    unittest.main()
