"""Tests pour dl_detector.py (pipeline deep learning fast_alpr, avec repli).

`fast_alpr` n'est volontairement PAS installe pour les tests (ni telecharge
de modeles ONNX) : on mocke `_get_alpr` / le module `fast_alpr` pour simuler
le chargement reussi, et on laisse l'echec d'import reel se produire pour
tester le repli "package indisponible".
"""
from types import SimpleNamespace

import numpy as np
import pytest

import dl_detector as dd


@pytest.fixture(autouse=True)
def reset_module_state():
    """Le module met en cache _alpr/_load_failed globalement ; on reinitialise
    avant/apres chaque test pour que les tests restent independants."""
    dd._alpr = None
    dd._load_failed = False
    yield
    dd._alpr = None
    dd._load_failed = False


def make_result(text, confidence, bbox=(10, 20, 110, 70)):
    x1, y1, x2, y2 = bbox
    return SimpleNamespace(
        ocr=SimpleNamespace(text=text, confidence=confidence),
        detection=SimpleNamespace(bounding_box=SimpleNamespace(x1=x1, y1=y1, x2=x2, y2=y2)),
    )


class TestFallbackWhenUnavailable:
    def test_dl_available_false_when_package_not_installed(self):
        # fast_alpr n'est pas installe dans cet environnement de test : le
        # chemin d'echec reel de _get_alpr() (ImportError attrape) s'execute.
        assert dd.dl_available() is False

    def test_detect_plate_dl_returns_none_when_package_not_installed(self):
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        assert dd.detect_plate_dl(image) is None

    def test_load_failure_is_cached(self):
        assert dd._load_failed is False
        dd.dl_available()
        assert dd._load_failed is True
        # Un second appel ne doit pas retenter le chargement (comportement
        # deja mis en cache), et doit rester coherent.
        assert dd.dl_available() is False

    def test_get_alpr_returns_none_on_simulated_exception(self, mocker):
        class FailingALPR:
            def __init__(self, *a, **k):
                raise RuntimeError("modele introuvable")

        fake_module = SimpleNamespace(ALPR=FailingALPR)
        mocker.patch.dict("sys.modules", {"fast_alpr": fake_module})
        result = dd._get_alpr()
        assert result is None
        assert dd._load_failed is True

    def test_detect_plate_dl_returns_none_on_predict_exception(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.side_effect = RuntimeError("boom")
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        assert dd.detect_plate_dl(image) is None


class TestDetectPlateDlMocked:
    def test_dl_available_true_when_alpr_loads(self, mocker):
        mocker.patch.object(dd, "_get_alpr", return_value=mocker.Mock())
        assert dd.dl_available() is True

    def test_scalar_confidence(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.return_value = [make_result("ab123cd", 0.87)]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)

        assert result is not None
        assert result.plate_text == "AB123CD"
        assert result.confidence == pytest.approx(0.87, abs=1e-3)
        assert result.bounding_box.x == 10
        assert result.bounding_box.y == 20
        assert result.bounding_box.width == 100
        assert result.bounding_box.height == 50

    def test_list_confidence_is_averaged(self, mocker):
        fake_alpr = mocker.Mock()
        # confiance par caractere -> moyenne attendue = (0.9+0.8+0.7+0.6)/4 = 0.75
        fake_alpr.predict.return_value = [make_result("AB12", [0.9, 0.8, 0.7, 0.6])]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)

        assert result is not None
        assert result.confidence == pytest.approx(0.75, abs=1e-3)

    def test_empty_list_confidence_defaults_to_zero(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.return_value = [make_result("AB12CD", [])]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)

        assert result is not None
        assert result.confidence == 0.0

    def test_picks_highest_confidence_among_multiple_results(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.return_value = [
            make_result("AAAA11", 0.4, bbox=(0, 0, 50, 30)),
            make_result("BBBB22", 0.9, bbox=(60, 0, 150, 40)),
            make_result("CCCC33", 0.6, bbox=(0, 60, 50, 90)),
        ]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)

        assert result.plate_text == "BBBB22"
        assert result.confidence == pytest.approx(0.9, abs=1e-3)

    def test_skips_results_with_no_ocr(self, mocker):
        fake_alpr = mocker.Mock()
        no_ocr_result = SimpleNamespace(ocr=None, detection=None)
        fake_alpr.predict.return_value = [no_ocr_result, make_result("AB123C", 0.5)]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)
        assert result.plate_text == "AB123C"

    def test_skips_results_with_text_too_short(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.return_value = [make_result("A1", 0.99)]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)
        assert result is None

    def test_returns_none_when_no_results(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.return_value = []
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        assert dd.detect_plate_dl(image) is None

    def test_cleans_and_uppercases_text(self, mocker):
        fake_alpr = mocker.Mock()
        fake_alpr.predict.return_value = [make_result("ab-123-cd", 0.77)]
        mocker.patch.object(dd, "_get_alpr", return_value=fake_alpr)

        image = np.zeros((100, 200, 3), dtype=np.uint8)
        result = dd.detect_plate_dl(image)
        assert result.plate_text == "AB123CD"
