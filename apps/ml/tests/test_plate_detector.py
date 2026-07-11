"""Tests pour plate_detector.py (pipeline classique OpenCV + Tesseract)."""
import shutil

import cv2
import numpy as np
import pytest

import plate_detector as pd


TESSERACT_AVAILABLE = shutil.which("tesseract") is not None


# --------------------------------------------------------------------------
# _clean_plate_text
# --------------------------------------------------------------------------

class TestCleanPlateText:
    def test_removes_non_alphanumeric(self):
        assert pd._clean_plate_text("ab-123-cd") == "AB123CD"

    def test_uppercases(self):
        assert pd._clean_plate_text("ab123cd") == "AB123CD"

    def test_strips_spaces_and_punctuation(self):
        assert pd._clean_plate_text(" AB 123 CD! ") == "AB123CD"

    def test_empty_string(self):
        assert pd._clean_plate_text("") == ""

    def test_only_junk_characters(self):
        assert pd._clean_plate_text("---***   ") == ""

    def test_already_clean(self):
        assert pd._clean_plate_text("AB123CD") == "AB123CD"


# --------------------------------------------------------------------------
# _matches_any_pattern
# --------------------------------------------------------------------------

class TestMatchesAnyPattern:
    def test_matches_default_generic_format(self):
        # DEFAULT_PLATE_REGEX accepte 4 a 10 caracteres alphanumeriques,
        # donc tout texte "plausible" en longueur matche.
        assert pd._matches_any_pattern("AB123CD") is True

    def test_matches_fr_format(self):
        assert pd._matches_any_pattern("AB123CD") is True  # aussi valide au format FR (sans tirets)

    def test_too_short_does_not_match(self):
        assert pd._matches_any_pattern("AB1") is False

    def test_too_long_does_not_match(self):
        assert pd._matches_any_pattern("A" * 13) is False

    def test_empty_does_not_match(self):
        assert pd._matches_any_pattern("") is False

    def test_default_pattern_is_permissive_by_design(self):
        # Documente un comportement potentiellement surprenant : le pattern
        # generique par defaut (^[A-Z0-9]{4,10}$) matche N'IMPORTE QUEL texte
        # alphanumerique nettoye de longueur 4-10, meme s'il ne ressemble en
        # rien a une vraie plaque (ex: format FR AA-123-AA). Ce n'est donc
        # pas une vraie validation de format tant que PLATE_FORMAT_REGEX
        # n'est pas resserre via l'environnement.
        assert pd._matches_any_pattern("ZZZZZZ") is True
        assert pd._matches_any_pattern("QWERTY") is True

    def test_strict_pattern_rejects_bad_format(self, monkeypatch):
        # En imposant uniquement le format FR strict, un texte qui ne suit
        # pas ce format est bien rejete (contrairement au pattern par defaut).
        monkeypatch.setattr(pd, "KNOWN_PATTERNS", [pd.FR_PLATE_REGEX])
        assert pd._matches_any_pattern("AB123CD") is True  # 2L-3D-2L : valide
        assert pd._matches_any_pattern("ZZZZZZ") is False  # ne suit pas 2L-3D-2L


# --------------------------------------------------------------------------
# _score_candidate
# --------------------------------------------------------------------------

class TestScoreCandidate:
    def test_empty_text_scores_zero(self):
        assert pd._score_candidate("", 0.9) == 0.0

    def test_too_short_scores_zero(self):
        assert pd._score_candidate("AB1", 0.9) == 0.0

    def test_too_long_scores_zero(self):
        assert pd._score_candidate("A" * 11, 0.9) == 0.0

    def test_boundary_min_length_valid(self):
        # 4 caracteres : limite basse acceptee
        score = pd._score_candidate("AB12", 0.5)
        assert score > 0.0

    def test_boundary_max_length_valid(self):
        # 10 caracteres : limite haute acceptee
        score = pd._score_candidate("A" * 10, 0.5)
        assert score > 0.0

    def test_valid_format_gets_bonus(self):
        confidence = 0.5
        score = pd._score_candidate("AB123CD", confidence)
        assert score == pytest.approx(min(confidence * 1.15, 1.0))

    def test_score_is_capped_at_one(self):
        score = pd._score_candidate("AB123CD", 1.0)
        assert score == 1.0

    def test_zero_confidence_scores_zero(self):
        assert pd._score_candidate("AB123CD", 0.0) == 0.0

    def test_no_bonus_without_pattern_match(self, monkeypatch):
        monkeypatch.setattr(pd, "KNOWN_PATTERNS", [pd.FR_PLATE_REGEX])
        score = pd._score_candidate("ZZZZZZ", 0.5)  # ne matche pas le format FR
        assert score == pytest.approx(0.5)


# --------------------------------------------------------------------------
# _find_plate_candidates
# --------------------------------------------------------------------------

def _make_image_with_rect(w_img=400, h_img=300, rect_w=200, rect_h=50, x=100, y=125):
    image = np.full((h_img, w_img, 3), 60, dtype=np.uint8)
    image[y : y + rect_h, x : x + rect_w] = 240
    return image


class TestFindPlateCandidates:
    def test_detects_plate_shaped_rectangle(self):
        # ratio 200/50 = 4.0, dans [1.8, 6.0]
        image = _make_image_with_rect(rect_w=200, rect_h=50)
        candidates = pd._find_plate_candidates(image)
        assert len(candidates) > 0
        for x, y, w, h in candidates:
            ratio = w / h
            assert pd.PLATE_MIN_ASPECT_RATIO <= ratio <= pd.PLATE_MAX_ASPECT_RATIO

    def test_rejects_square_shape(self):
        # ratio 100/100 = 1.0, hors de [1.8, 6.0]
        image = _make_image_with_rect(rect_w=100, rect_h=100, x=150, y=100)
        candidates = pd._find_plate_candidates(image)
        for x, y, w, h in candidates:
            ratio = w / h
            # Aucun candidat ne devrait correspondre au carre lui-meme
            assert not (abs(w - 100) < 5 and abs(h - 100) < 5)

    def test_returns_at_most_five_candidates(self):
        image = np.full((400, 400, 3), 50, dtype=np.uint8)
        # plusieurs rectangles de forme plaque a des positions differentes
        for i in range(8):
            x = 10 + i * 40
            if x + 60 > 400:
                break
            image[20:35, x : x + 60] = 220
        candidates = pd._find_plate_candidates(image)
        assert len(candidates) <= 5

    def test_blank_image_returns_no_or_few_candidates(self):
        image = np.full((200, 200, 3), 100, dtype=np.uint8)
        candidates = pd._find_plate_candidates(image)
        assert isinstance(candidates, list)


# --------------------------------------------------------------------------
# _ocr_pass / _ocr_region (mock pytesseract, pas besoin du binaire reel)
# --------------------------------------------------------------------------

class TestOcrRegionMocked:
    def test_ocr_pass_extracts_confident_words(self, mocker):
        fake_data = {
            "text": ["AB", "123", "CD", ""],
            "conf": [95, 90, 85, -1],
        }
        mocker.patch.object(pd.pytesseract, "image_to_data", return_value=fake_data)
        image = np.zeros((80, 200), dtype=np.uint8)
        text, confidence = pd._ocr_pass(image, psm=7)
        assert text == "AB123CD"
        assert confidence == pytest.approx((95 + 90 + 85) / 3 / 100.0)

    def test_ocr_pass_ignores_zero_or_negative_confidence(self, mocker):
        fake_data = {"text": ["JUNK"], "conf": [-1]}
        mocker.patch.object(pd.pytesseract, "image_to_data", return_value=fake_data)
        image = np.zeros((80, 200), dtype=np.uint8)
        text, confidence = pd._ocr_pass(image, psm=7)
        assert text == ""
        assert confidence == 0.0

    def test_ocr_region_picks_best_confidence_variant(self, mocker):
        # Simule des resultats variables selon les appels : le meilleur doit
        # etre retenu, et la boucle doit s'arreter tot si conf >= 0.90.
        call_count = {"n": 0}

        def fake_image_to_data(img, config, output_type):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return {"text": ["AB12CD"], "conf": [50]}
            return {"text": ["AB123CD"], "conf": [95]}

        mocker.patch.object(pd.pytesseract, "image_to_data", side_effect=fake_image_to_data)
        image = np.zeros((80, 200, 3), dtype=np.uint8)
        text, confidence = pd._ocr_region(image)
        assert text == "AB123CD"
        assert confidence == pytest.approx(0.95)
        # Court-circuit : ne doit pas avoir teste toutes les 9 combinaisons (3 variantes x 3 psm)
        assert call_count["n"] < 9

    def test_ocr_region_rejects_out_of_range_length(self, mocker):
        fake_data = {"text": ["AB"], "conf": [99]}  # trop court (< 4)
        mocker.patch.object(pd.pytesseract, "image_to_data", return_value=fake_data)
        image = np.zeros((80, 200, 3), dtype=np.uint8)
        text, confidence = pd._ocr_region(image)
        assert text == ""
        assert confidence == 0.0


# --------------------------------------------------------------------------
# detect_plate (end-to-end)
# --------------------------------------------------------------------------

class TestDetectPlateMocked:
    """Exerce le pipeline complet sans dependre du binaire tesseract reel."""

    def test_detect_plate_end_to_end_with_mocked_ocr(self, mocker):
        mocker.patch.object(
            pd.pytesseract,
            "image_to_data",
            return_value={"text": ["AB", "123", "CD"], "conf": [92, 91, 93]},
        )
        image = _make_image_with_rect()
        ok, buf = cv2.imencode(".png", image)
        assert ok
        result = pd.detect_plate(buf.tobytes())
        assert isinstance(result, pd.DetectionResult)
        assert result.plate_text == "AB123CD"
        assert result.confidence > 0

    def test_detect_plate_no_readable_text(self, mocker):
        mocker.patch.object(
            pd.pytesseract, "image_to_data", return_value={"text": [], "conf": []}
        )
        image = _make_image_with_rect()
        ok, buf = cv2.imencode(".png", image)
        result = pd.detect_plate(buf.tobytes())
        assert isinstance(result, pd.DetectionResult)
        assert result.plate_text == ""
        assert result.confidence == 0.0
        assert result.bounding_box is None

    def test_detect_plate_invalid_image_bytes_does_not_crash(self):
        result = pd.detect_plate(b"not an image at all")
        assert isinstance(result, pd.DetectionResult)
        assert result.plate_text == ""
        assert result.confidence == 0.0
        assert result.bounding_box is None

    def test_detect_plate_empty_bytes_does_not_crash(self):
        result = pd.detect_plate(b"")
        assert isinstance(result, pd.DetectionResult)
        assert result.plate_text == ""

    def test_detect_plate_blank_image_does_not_crash(self, mocker):
        mocker.patch.object(
            pd.pytesseract, "image_to_data", return_value={"text": [], "conf": []}
        )
        blank = np.full((200, 200, 3), 128, dtype=np.uint8)
        ok, buf = cv2.imencode(".png", blank)
        result = pd.detect_plate(buf.tobytes())
        assert isinstance(result, pd.DetectionResult)


@pytest.mark.skipif(not TESSERACT_AVAILABLE, reason="binaire tesseract non installe sur cette machine")
class TestDetectPlateRealTesseract:
    """Tests d'integration avec le vrai binaire Tesseract (installe en CI)."""

    def test_runs_without_crashing_on_rendered_text(self):
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (400, 300), color=(60, 60, 60))
        draw = ImageDraw.Draw(img)
        draw.rectangle([100, 125, 300, 175], fill=(240, 240, 240))
        draw.text((110, 135), "AB123CD", fill=(0, 0, 0))

        buf_arr = np.array(img)[:, :, ::-1]  # RGB -> BGR
        ok, buf = cv2.imencode(".png", buf_arr)
        assert ok
        result = pd.detect_plate(buf.tobytes())
        assert isinstance(result, pd.DetectionResult)
        assert 0.0 <= result.confidence <= 1.0

    def test_runs_without_crashing_on_blank_image(self):
        blank = np.full((300, 400, 3), 128, dtype=np.uint8)
        ok, buf = cv2.imencode(".png", blank)
        result = pd.detect_plate(buf.tobytes())
        assert isinstance(result, pd.DetectionResult)
