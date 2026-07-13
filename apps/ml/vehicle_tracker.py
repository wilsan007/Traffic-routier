"""Suivi de véhicules par ByteTrack (au-dessus d'un détecteur YOLO ultralytics).

Troisième pièce du pipeline flux, entre la détection et l'OCR : au lieu de
traiter chaque frame indépendamment, on attribue à chaque véhicule un
identifiant persistant (track ID) qui le suit d'une frame à l'autre. Cela
permet le vote temporel (plate_vote.py) : une même plaque est lue plusieurs
fois sur la trajectoire du véhicule, et on ne garde que le consensus — bien
plus fiable qu'une lecture unique, et un comptage « une fois par véhicule »
naturel (plus besoin du cooldown arbitraire par texte).

Inférence : ultralytics accepte un modèle .pt (PyTorch) ou .onnx (ONNX
Runtime). On privilégie ONNX Runtime (portable CPU, déjà utilisé par le
pipeline plaques) via VEHICLE_MODEL=....onnx. ByteTrack, lui, tourne en Python
(léger) quel que soit le backend.

État de suivi : ByteTrack conserve son état sur l'objet modèle
(model.predictor). Chaque flux doit donc avoir sa PROPRE instance de
VehicleTracker (donc son propre modèle), sinon les identifiants de deux caméras
se mélangeraient. Chargement paresseux + repli gracieux : si ultralytics ou le
modèle sont indisponibles, `available` est False et le worker retombe sur le
pipeline sans suivi.
"""
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# .pt (PyTorch) ou .onnx (ONNX Runtime, recommandé sur CPU).
VEHICLE_MODEL = os.environ.get("VEHICLE_MODEL", "yolo11n.pt")
TRACKER_CONFIG = os.environ.get("VEHICLE_TRACKER", "bytetrack.yaml")
TRACK_CONFIDENCE = float(os.environ.get("VEHICLE_ML_CONFIDENCE", "0.35"))
# Classes COCO considérées comme véhicules.
VEHICLE_COCO_CLASSES = {"car", "truck", "bus", "motorcycle"}


@dataclass
class TrackedVehicle:
    track_id: int
    x: int
    y: int
    width: int
    height: int
    confidence: float
    label: str


class VehicleTracker:
    """Un tracker par flux. Passer `model` explicitement (tests) court-circuite
    le chargement réel d'ultralytics."""

    def __init__(self, model="__auto__"):
        self.last_error: str | None = None
        if model == "__auto__":
            self._model = self._load()
        else:
            self._model = model

    def _load(self):
        try:
            from ultralytics import YOLO

            model = YOLO(VEHICLE_MODEL)
            logger.info("Tracker véhicules chargé (%s, %s)", VEHICLE_MODEL, TRACKER_CONFIG)
            return model
        except Exception as exc:  # noqa: BLE001
            # ultralytics non installé (cas par défaut) ou modèle introuvable.
            logger.info("Tracker véhicules indisponible (%s), repli sans suivi", exc)
            self.last_error = str(exc)
            return None

    @property
    def available(self) -> bool:
        return self._model is not None

    def update(self, frame) -> list[TrackedVehicle]:
        """Met à jour le suivi avec une nouvelle frame et renvoie les véhicules
        suivis (avec leur track_id). Liste vide si aucun véhicule ou erreur."""
        if self._model is None:
            return []
        try:
            results = self._model.track(
                frame,
                persist=True,
                tracker=TRACKER_CONFIG,
                conf=TRACK_CONFIDENCE,
                verbose=False,
            )
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"suivi: {exc}"
            logger.exception("Échec du suivi véhicules")
            return []

        vehicles: list[TrackedVehicle] = []
        for r in results:
            boxes = getattr(r, "boxes", None)
            # boxes.id est None tant qu'aucun objet n'est suivi (0 détection).
            if boxes is None or boxes.id is None:
                continue
            names = getattr(r, "names", {}) or {}
            ids = boxes.id.int().tolist()
            xyxy = boxes.xyxy.tolist()
            confs = boxes.conf.tolist()
            clss = boxes.cls.int().tolist()
            for tid, (x1, y1, x2, y2), conf, cid in zip(ids, xyxy, confs, clss):
                label = names.get(int(cid), "")
                if label not in VEHICLE_COCO_CLASSES:
                    continue
                vehicles.append(
                    TrackedVehicle(
                        track_id=int(tid),
                        x=int(x1), y=int(y1),
                        width=int(x2 - x1), height=int(y2 - y1),
                        confidence=float(conf),
                        label=label,
                    )
                )
        return vehicles
