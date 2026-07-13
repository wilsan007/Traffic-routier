"""Classification « véhicule ou pas » d'une région en mouvement.

Deuxième étape (gate) du pipeline temps réel : une fois qu'un mouvement est
détecté, il faut décider s'il s'agit d'un véhicule avant de lancer l'ALPR.
Sans ça, un piéton, un vélo ou un animal traversant le champ déclencherait
une lecture de plaque inutile (et souvent un faux positif OCR).

Deux niveaux, sur le même modèle que dl_detector.py (deep learning optionnel
avec repli robuste) :

1. Détecteur objet deep learning OPTIONNEL (ultralytics YOLO, classes COCO
   car/truck/bus/motorcycle). Activé seulement si le paquet est installé —
   il n'est PAS dans requirements.txt par défaut (torch est trop lourd pour
   l'hébergement gratuit). Chargement paresseux, repli silencieux sinon.

2. Repli HEURISTIQUE géométrique, toujours disponible et sans dépendance : à
   partir de la boîte de mouvement (fournie par motion_detector), on décide si
   sa taille / forme / densité est compatible avec un véhicule. Un piéton
   produit un blob étroit et vertical (ratio l/h faible), un véhicule un blob
   large, dense et d'une surface minimale.

Contrat : `classify(frame, motion_regions)` renvoie la liste des `VehicleBox`
retenues (sous-ensemble « véhicule » des régions), boîtes recadrées prêtes à
passer à l'ALPR.
"""
import logging
import os
from dataclasses import dataclass
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# --- Heuristique géométrique (repli sans modèle) ---
# Surface minimale d'un véhicule (fraction de la frame). En dessous : objet
# trop petit/lointain pour lire une plaque de toute façon.
VEHICLE_MIN_AREA_RATIO = float(os.environ.get("VEHICLE_MIN_AREA_RATIO", "0.02"))
# Fourchette de ratio largeur/hauteur. Un véhicule vu d'une caméra trafic est
# à peu près carré à large ; un piéton est nettement vertical (ratio < ~0.6).
VEHICLE_MIN_ASPECT = float(os.environ.get("VEHICLE_MIN_ASPECT", "0.7"))
VEHICLE_MAX_ASPECT = float(os.environ.get("VEHICLE_MAX_ASPECT", "6.0"))
# Densité minimale du blob (les véhicules sont pleins, pas un nuage de points).
VEHICLE_MIN_FILL = float(os.environ.get("VEHICLE_MIN_FILL", "0.35"))

# Classes COCO considérées comme véhicules (si le détecteur ML est présent).
_VEHICLE_COCO_CLASSES = {"car", "truck", "bus", "motorcycle"}
VEHICLE_MODEL = os.environ.get("VEHICLE_MODEL", "yolo11n.pt")
VEHICLE_ML_CONFIDENCE = float(os.environ.get("VEHICLE_ML_CONFIDENCE", "0.35"))

_model = None
_load_failed = False


@dataclass
class VehicleBox:
    x: int
    y: int
    width: int
    height: int
    confidence: float
    source: str  # "deep_learning" | "heuristic"


def _looks_like_vehicle(region) -> bool:
    """Décision heuristique sur une MotionRegion (ou tout objet exposant
    width/height/area_ratio/fill_ratio)."""
    if region.width == 0 or region.height == 0:
        return False
    aspect = region.width / region.height
    return (
        region.area_ratio >= VEHICLE_MIN_AREA_RATIO
        and VEHICLE_MIN_ASPECT <= aspect <= VEHICLE_MAX_ASPECT
        and region.fill_ratio >= VEHICLE_MIN_FILL
    )


def _get_model():
    """Charge paresseusement le détecteur ultralytics s'il est disponible."""
    global _model, _load_failed
    if _model is None and not _load_failed:
        try:
            from ultralytics import YOLO

            _model = YOLO(VEHICLE_MODEL)
            logger.info("Détecteur de véhicules deep learning chargé (%s)", VEHICLE_MODEL)
        except Exception:
            # ultralytics non installé (cas par défaut) ou modèle introuvable :
            # on retombe silencieusement sur l'heuristique géométrique.
            logger.info("Détecteur véhicules deep learning indisponible, repli heuristique")
            _load_failed = True
    return _model


def ml_available() -> bool:
    return _get_model() is not None


def _detect_ml(frame: np.ndarray) -> Optional[list[VehicleBox]]:
    """Détection véhicules par deep learning, ou None si indisponible/échec."""
    model = _get_model()
    if model is None:
        return None
    try:
        results = model.predict(frame, verbose=False, conf=VEHICLE_ML_CONFIDENCE)
    except Exception:
        logger.exception("Échec de la détection véhicules deep learning")
        return None

    boxes: list[VehicleBox] = []
    for result in results:
        names = getattr(result, "names", {}) or {}
        for box in getattr(result, "boxes", []) or []:
            cls_id = int(box.cls[0])
            label = names.get(cls_id, "")
            if label not in _VEHICLE_COCO_CLASSES:
                continue
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            boxes.append(
                VehicleBox(
                    x=int(x1), y=int(y1),
                    width=int(x2 - x1), height=int(y2 - y1),
                    confidence=float(box.conf[0]),
                    source="deep_learning",
                )
            )
    return boxes


def classify(frame: np.ndarray, motion_regions) -> list[VehicleBox]:
    """Régions de la frame contenant un véhicule.

    Utilise le détecteur deep learning s'il est chargé (plus fiable, indépendant
    du masque de mouvement) ; sinon applique l'heuristique géométrique aux
    régions en mouvement fournies. Résultat trié par surface décroissante."""
    ml_boxes = _detect_ml(frame)
    if ml_boxes is not None:
        ml_boxes.sort(key=lambda b: b.width * b.height, reverse=True)
        return ml_boxes

    vehicles: list[VehicleBox] = []
    for region in motion_regions or []:
        if _looks_like_vehicle(region):
            # Confiance heuristique : plus le blob est dense, plus on est sûr.
            confidence = round(min(1.0, region.fill_ratio), 3)
            vehicles.append(
                VehicleBox(
                    x=region.x, y=region.y,
                    width=region.width, height=region.height,
                    confidence=confidence,
                    source="heuristic",
                )
            )
    vehicles.sort(key=lambda b: b.width * b.height, reverse=True)
    return vehicles
