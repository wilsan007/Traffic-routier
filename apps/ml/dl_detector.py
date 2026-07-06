"""Pipeline ALPR deep learning : YOLOv9 (détection) + ViT mobile (OCR plaques).

Utilise fast-alpr, qui embarque des modèles ONNX pré-entraînés spécifiquement
sur des plaques d'immatriculation (multi-pays), exécutés sur CPU via
onnxruntime. C'est le même type de pipeline que les solutions commerciales
(détecteur dédié plaques + reconnaisseur de caractères entraîné sur plaques),
bien plus robuste que Tesseract sur photos réelles (angle, nuit, flou).

Chargement paresseux : si les modèles ne peuvent pas être chargés, l'appelant
retombe sur le pipeline classique OpenCV + Tesseract (plate_detector.py).
"""
import logging
import re
from typing import Optional

import numpy as np

from plate_detector import BoundingBox, DetectionResult

logger = logging.getLogger(__name__)

DETECTOR_MODEL = "yolo-v9-t-384-license-plate-end2end"
OCR_MODEL = "global-plates-mobile-vit-v2-model"

_alpr = None
_load_failed = False


def _get_alpr():
    global _alpr, _load_failed
    if _alpr is None and not _load_failed:
        try:
            from fast_alpr import ALPR

            _alpr = ALPR(detector_model=DETECTOR_MODEL, ocr_model=OCR_MODEL)
            logger.info("Pipeline deep learning chargé (%s + %s)", DETECTOR_MODEL, OCR_MODEL)
        except Exception:
            logger.exception("Pipeline deep learning indisponible, repli sur Tesseract")
            _load_failed = True
    return _alpr


def dl_available() -> bool:
    return _get_alpr() is not None


def detect_plate_dl(image_bgr: np.ndarray) -> Optional[DetectionResult]:
    """Meilleure plaque lue par le pipeline deep learning, ou None si
    indisponible / aucune plaque détectée."""
    alpr = _get_alpr()
    if alpr is None:
        return None

    try:
        results = alpr.predict(image_bgr)
    except Exception:
        logger.exception("Échec de la prédiction deep learning")
        return None

    best: Optional[tuple[str, float, BoundingBox]] = None
    for r in results:
        if r.ocr is None:
            continue
        text = re.sub(r"[^A-Z0-9]", "", (r.ocr.text or "").upper())
        # La confiance OCR peut être une liste (une valeur par caractère)
        raw_conf = r.ocr.confidence
        if isinstance(raw_conf, (list, tuple, np.ndarray)):
            confidence = float(np.mean(raw_conf)) if len(raw_conf) else 0.0
        else:
            confidence = float(raw_conf or 0.0)
        if not text or len(text) < 4:
            continue
        if best is None or confidence > best[1]:
            bb = r.detection.bounding_box
            box = BoundingBox(
                x=int(bb.x1),
                y=int(bb.y1),
                width=int(bb.x2 - bb.x1),
                height=int(bb.y2 - bb.y1),
            )
            best = (text, confidence, box)

    if best is None:
        return None
    return DetectionResult(plate_text=best[0], confidence=round(best[1], 3), bounding_box=best[2])
