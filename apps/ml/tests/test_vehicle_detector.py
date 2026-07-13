"""Tests du classifieur véhicule (vehicle_detector.py).

On teste le repli heuristique (toujours disponible, sans modèle) : la décision
« véhicule ou pas » à partir de la géométrie d'une région en mouvement. Le
détecteur deep learning optionnel (ultralytics) n'est pas installé dans
l'environnement de test → `classify` utilise l'heuristique.
"""
from dataclasses import dataclass

import numpy as np
import pytest

import vehicle_detector
from vehicle_detector import VehicleBox, classify


@pytest.fixture(autouse=True)
def _no_ml_download(monkeypatch):
    """Empêche tout chargement/téléchargement réel du modèle deep learning
    pendant les tests : le chemin ML est neutralisé par défaut (repli
    heuristique). Les tests qui veulent simuler le ML patchent _detect_ml
    explicitement, ce qui prime sur cette fixture."""
    monkeypatch.setattr(vehicle_detector, "_load_failed", True)
    monkeypatch.setattr(vehicle_detector, "_model", None)


@dataclass
class FakeRegion:
    x: int
    y: int
    width: int
    height: int
    area_ratio: float
    fill_ratio: float


def _frame():
    return np.zeros((240, 320, 3), dtype=np.uint8)


class TestHeuristicClassify:
    def test_car_like_blob_is_accepted(self):
        # Large, dense, surface suffisante : ressemble à une voiture.
        car = FakeRegion(x=50, y=60, width=120, height=80, area_ratio=0.12, fill_ratio=0.8)
        result = classify(_frame(), [car])
        assert len(result) == 1
        assert isinstance(result[0], VehicleBox)
        assert result[0].source == "heuristic"
        assert result[0].width == 120

    def test_pedestrian_like_blob_is_rejected(self):
        # Vertical et étroit (ratio l/h ~0.3) : piéton, pas un véhicule.
        person = FakeRegion(x=100, y=40, width=25, height=90, area_ratio=0.03, fill_ratio=0.7)
        assert classify(_frame(), [person]) == []

    def test_too_small_blob_is_rejected(self):
        small = FakeRegion(x=10, y=10, width=20, height=15, area_ratio=0.004, fill_ratio=0.9)
        assert classify(_frame(), [small]) == []

    def test_sparse_blob_is_rejected(self):
        # Grande boîte mais peu remplie (nuage de points / pluie) : pas un véhicule.
        sparse = FakeRegion(x=30, y=30, width=120, height=80, area_ratio=0.12, fill_ratio=0.1)
        assert classify(_frame(), [sparse]) == []

    def test_no_regions_returns_empty(self):
        assert classify(_frame(), []) == []
        assert classify(_frame(), None) == []

    def test_results_sorted_by_area_desc(self):
        big = FakeRegion(x=0, y=0, width=140, height=90, area_ratio=0.16, fill_ratio=0.8)
        med = FakeRegion(x=0, y=0, width=90, height=70, area_ratio=0.08, fill_ratio=0.8)
        result = classify(_frame(), [med, big])
        assert [b.width for b in result] == [140, 90]


class TestMlPathFallback:
    def test_classify_falls_back_when_ml_unavailable(self, monkeypatch):
        # Force le chemin « ML indisponible » et vérifie qu'on retombe bien
        # sur l'heuristique sans lever d'erreur.
        monkeypatch.setattr(vehicle_detector, "_detect_ml", lambda frame: None)
        car = FakeRegion(x=50, y=60, width=120, height=80, area_ratio=0.12, fill_ratio=0.8)
        result = classify(_frame(), [car])
        assert len(result) == 1
        assert result[0].source == "heuristic"

    def test_classify_uses_ml_when_available(self, monkeypatch):
        ml_box = VehicleBox(x=1, y=2, width=30, height=40, confidence=0.9, source="deep_learning")
        monkeypatch.setattr(vehicle_detector, "_detect_ml", lambda frame: [ml_box])
        # Même sans région de mouvement, le résultat ML prime.
        result = classify(_frame(), [])
        assert result == [ml_box]
