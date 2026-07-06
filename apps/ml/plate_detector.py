"""Détection et lecture de plaques d'immatriculation.

Pipeline pragmatique (sans dépendance à un modèle deep learning entraîné) :
1. Détection de la région de plaque par analyse de contours OpenCV
   (filtrage par ratio largeur/hauteur typique d'une plaque).
2. OCR de la région détectée via Tesseract, avec une whitelist alphanumérique.
3. Score de confiance dérivé de la confiance moyenne des mots reconnus.
4. Post-traitement : nettoyage, validation par regex configurable, tri des candidats.

Conçu pour être remplacé par un pipeline YOLO + CRNN entraîné en production,
sans changer le contrat de l'API (detect_plate retourne le même schéma).
"""
import os
import re
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import pytesseract

PLATE_MIN_ASPECT_RATIO = 1.8
PLATE_MAX_ASPECT_RATIO = 6.0
PLATE_MIN_AREA_RATIO = 0.001
PLATE_MAX_AREA_RATIO = 0.25
OCR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

# Regex de validation des plaques par format (configurable via env)
# Format générique : 4 à 10 caractères alphanumériques
DEFAULT_PLATE_REGEX = os.environ.get("PLATE_FORMAT_REGEX", r"^[A-Z0-9]{4,10}$")
# Format français : AA-123-AA ou AA123AA
FR_PLATE_REGEX = r"^[A-Z]{2}-?\d{3}-?[A-Z]{2}$"
# Format configurable supplémentaire via env
EXTRA_PLATE_REGEX = os.environ.get("PLATE_FORMAT_REGEX_EXTRA", "")

KNOWN_PATTERNS = [DEFAULT_PLATE_REGEX, FR_PLATE_REGEX]
if EXTRA_PLATE_REGEX:
    KNOWN_PATTERNS.append(EXTRA_PLATE_REGEX)


@dataclass
class BoundingBox:
    x: int
    y: int
    width: int
    height: int


@dataclass
class DetectionResult:
    plate_text: str
    confidence: float
    bounding_box: Optional[BoundingBox]


def _find_plate_candidates(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 11, 17, 17)
    edged = cv2.Canny(gray, 30, 200)
    edged = cv2.dilate(edged, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    img_area = image.shape[0] * image.shape[1]

    candidates = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if h == 0:
            continue
        aspect_ratio = w / h
        area_ratio = (w * h) / img_area
        if (
            PLATE_MIN_ASPECT_RATIO <= aspect_ratio <= PLATE_MAX_ASPECT_RATIO
            and PLATE_MIN_AREA_RATIO <= area_ratio <= PLATE_MAX_AREA_RATIO
        ):
            candidates.append((x, y, w, h))

    candidates.sort(key=lambda box: box[2] * box[3], reverse=True)
    return candidates[:5]


def _ocr_pass(img: np.ndarray, psm: int) -> tuple[str, float]:
    """Une passe Tesseract sur une image prétraitée donnée; retourne (texte, confiance 0-1)."""
    config = f"--psm {psm} -c tessedit_char_whitelist={OCR_WHITELIST}"
    data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)

    words = []
    confidences = []
    for text, conf in zip(data["text"], data["conf"]):
        cleaned = re.sub(r"[^A-Z0-9]", "", text.upper())
        conf_value = float(conf)
        if cleaned and conf_value > 0:
            words.append(cleaned)
            confidences.append(conf_value)

    plate_text = "".join(words)
    confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0
    return plate_text, confidence


def _ocr_region(image: np.ndarray) -> tuple[str, float]:
    """OCR robuste : essaie plusieurs prétraitements et modes de segmentation,
    garde le résultat le plus confiant. Les plaques réelles varient énormément
    (éclairage, angle, contraste) — une seule combinaison fixe rate trop de cas."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if gray.shape[0] < 80:
        scale = 80 / gray.shape[0]
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants = [gray, otsu, cv2.bitwise_not(otsu)]

    best_text = ""
    best_conf = 0.0
    for variant in variants:
        for psm in (7, 8, 6):
            text, conf = _ocr_pass(variant, psm)
            if 4 <= len(text) <= 10 and conf > best_conf:
                best_text, best_conf = text, conf
        # Court-circuit : résultat déjà très fiable, inutile de continuer
        if best_conf >= 0.90:
            break

    return best_text, best_conf


def _clean_plate_text(text: str) -> str:
    """Nettoie le texte OCR : supprime les caractères non alphanumériques, met en majuscules."""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def _matches_any_pattern(text: str) -> bool:
    """Vérifie si le texte correspond à au moins un des patterns de plaque connus."""
    for pattern in KNOWN_PATTERNS:
        if re.match(pattern, text):
            return True
    return False


def _score_candidate(text: str, confidence: float) -> float:
    """Score un candidat : confiance OCR * bonus si le format est valide."""
    if not text or len(text) < 4 or len(text) > 10:
        return 0.0
    score = confidence
    if _matches_any_pattern(text):
        score *= 1.15
    return min(score, 1.0)


def detect_plate(image_bytes: bytes) -> DetectionResult:
    np_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)
    if image is None:
        return DetectionResult(plate_text="", confidence=0.0, bounding_box=None)

    best_text = ""
    best_score = 0.0
    best_box: Optional[BoundingBox] = None

    for x, y, w, h in _find_plate_candidates(image):
        region = image[y : y + h, x : x + w]
        raw_text, confidence = _ocr_region(region)
        cleaned = _clean_plate_text(raw_text)
        score = _score_candidate(cleaned, confidence)
        if score > best_score:
            best_text = cleaned
            best_score = score
            best_box = BoundingBox(x=x, y=y, width=w, height=h)

    # Repli : OCR sur l'image entière si aucune région candidate n'a produit de texte exploitable
    if not best_text:
        raw_text, confidence = _ocr_region(image)
        cleaned = _clean_plate_text(raw_text)
        score = _score_candidate(cleaned, confidence)
        if score > 0:
            best_text, best_score = cleaned, score

    return DetectionResult(plate_text=best_text, confidence=round(best_score, 3), bounding_box=best_box)
