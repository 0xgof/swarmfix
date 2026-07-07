"""Tests for the initial viewer-side schema stub."""

from pathlib import Path


def test_viewer_schema_stub_defines_types_and_validation_contract() -> None:
    """Viewer schema files should define the expected trace contract."""
    scene_types_path = Path("viewer/src/data/sceneTypes.ts")
    validator_path = Path("viewer/src/data/validateSceneTrace.ts")

    scene_types_text = scene_types_path.read_text(encoding="utf-8")
    validator_text = validator_path.read_text(encoding="utf-8")

    assert "export interface SceneTrace" in scene_types_text
    assert "schema_version" in scene_types_text
    assert "truth: TruthSection" in scene_types_text
    assert "measurements: MeasurementSection" in scene_types_text
    assert "trace: TraceSection" in scene_types_text
    assert "export function validateSceneTrace" in validator_text
    assert "schema_version" in validator_text
    assert "truth" in validator_text
    assert "measurements" in validator_text
    assert "estimates" in validator_text
    assert "trace" in validator_text

