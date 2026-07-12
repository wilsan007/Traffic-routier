"""Détection de mouvement pour flux vidéo continu.

Première étape (gate) du pipeline temps réel : sur une caméra fixe, la très
grande majorité des frames sont identiques (route vide). Lancer l'ALPR sur
chacune gaspille du CPU et multiplie les faux positifs. On n'analyse donc une
frame que lorsqu'un mouvement significatif apparaît.

Implémentation volontairement légère et sans nouvelle dépendance : soustraction
de fond MOG2 d'OpenCV. Elle apprend en continu l'arrière-plan (bitume, ombres
lentes) et isole les objets réellement en mouvement (véhicules), en filtrant le
bruit (feuilles, pluie fine, micro-changements de luminosité) par ouverture
morphologique et seuil de surface minimale.

État par flux : chaque `MotionDetector` porte son propre modèle de fond, il ne
faut donc pas en partager une instance entre plusieurs caméras.
"""
import os
from dataclasses import dataclass

import cv2
import numpy as np

# Surface minimale de mouvement (fraction de la frame) pour considérer qu'il
# se passe quelque chose. En dessous : bruit, on ignore.
MIN_MOTION_AREA_RATIO = float(os.environ.get("MOTION_MIN_AREA_RATIO", "0.01"))
# Sensibilité du détecteur de fond (seuil de variance MOG2). Plus haut = moins
# sensible aux petites variations de luminosité.
MOG2_VAR_THRESHOLD = float(os.environ.get("MOTION_VAR_THRESHOLD", "40"))
# Nombre de frames d'historique pour apprendre le fond.
MOG2_HISTORY = int(os.environ.get("MOTION_HISTORY", "300"))


@dataclass
class MotionRegion:
    """Boîte englobante d'un objet en mouvement + sa densité (fill ratio)."""

    x: int
    y: int
    width: int
    height: int
    area_ratio: float  # (w*h) / surface de la frame
    fill_ratio: float  # pixels en mouvement dans la boîte / (w*h)


class MotionDetector:
    def __init__(
        self,
        min_area_ratio: float = MIN_MOTION_AREA_RATIO,
        var_threshold: float = MOG2_VAR_THRESHOLD,
        history: int = MOG2_HISTORY,
    ):
        self.min_area_ratio = min_area_ratio
        # detectShadows=True : les ombres portées (marquées en gris 127) sont
        # exclues du masque binaire, ce qui évite de prendre l'ombre d'un
        # véhicule (ou d'un nuage) pour un objet distinct.
        self._bg = cv2.createBackgroundSubtractorMOG2(
            history=history, varThreshold=var_threshold, detectShadows=True
        )
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    def detect(self, frame: np.ndarray) -> list[MotionRegion]:
        """Régions en mouvement de la frame, triées par surface décroissante.

        Retourne une liste vide si aucune région ne dépasse le seuil de surface
        minimale (frame statique / bruit)."""
        if frame is None or frame.size == 0:
            return []

        mask = self._bg.apply(frame)
        # Les ombres sont ressorties en gris (127) : on ne garde que l'avant-plan
        # franc (255) via un seuil, puis on nettoie le bruit poivre-et-sel.
        _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._kernel)
        mask = cv2.dilate(mask, self._kernel, iterations=2)

        frame_area = frame.shape[0] * frame.shape[1]
        if frame_area == 0:
            return []

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        regions: list[MotionRegion] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if w == 0 or h == 0:
                continue
            area_ratio = (w * h) / frame_area
            if area_ratio < self.min_area_ratio:
                continue
            box_area = w * h
            fill_ratio = float(cv2.contourArea(contour)) / box_area if box_area else 0.0
            regions.append(
                MotionRegion(
                    x=x, y=y, width=w, height=h,
                    area_ratio=area_ratio, fill_ratio=fill_ratio,
                )
            )

        regions.sort(key=lambda r: r.width * r.height, reverse=True)
        return regions

    def has_motion(self, frame: np.ndarray) -> bool:
        """Raccourci booléen : au moins une région en mouvement significative."""
        return len(self.detect(frame)) > 0
