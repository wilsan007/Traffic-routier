"""Tests du détecteur de mouvement (motion_detector.py).

On construit des frames synthétiques (numpy) : un fond uniforme immobile, puis
un rectangle qui apparaît/se déplace. Aucune vraie vidéo n'est nécessaire.
"""
import numpy as np

from motion_detector import MotionDetector, MotionRegion


def _blank(h=240, w=320, value=50):
    return np.full((h, w, 3), value, dtype=np.uint8)


def _with_box(frame, x, y, w, h, value=220):
    out = frame.copy()
    out[y : y + h, x : x + w] = value
    return out


class TestMotionDetector:
    def test_static_scene_reports_no_motion(self):
        det = MotionDetector()
        frame = _blank()
        # On alimente le modèle de fond avec plusieurs frames identiques.
        for _ in range(10):
            regions = det.detect(frame)
        assert regions == []
        assert det.has_motion(frame) is False

    def test_moving_object_is_detected(self):
        det = MotionDetector(min_area_ratio=0.01)
        background = _blank()
        for _ in range(10):
            det.detect(background)  # apprentissage du fond

        # Un gros objet clair apparaît : doit être détecté comme mouvement.
        moving = _with_box(background, x=120, y=90, w=90, h=70)
        regions = det.detect(moving)
        assert len(regions) >= 1
        biggest = regions[0]
        assert isinstance(biggest, MotionRegion)
        assert biggest.area_ratio > 0
        # La boîte détectée recouvre grossièrement l'objet inséré.
        assert biggest.width > 20 and biggest.height > 20

    def test_tiny_noise_below_threshold_is_ignored(self):
        det = MotionDetector(min_area_ratio=0.2)  # seuil volontairement élevé
        background = _blank()
        for _ in range(10):
            det.detect(background)
        # Petit objet : sous le seuil de surface, ignoré.
        moving = _with_box(background, x=10, y=10, w=8, h=8)
        assert det.detect(moving) == []

    def test_empty_frame_returns_empty(self):
        det = MotionDetector()
        assert det.detect(None) == []
        assert det.detect(np.array([], dtype=np.uint8)) == []
