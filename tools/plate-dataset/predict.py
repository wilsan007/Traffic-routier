#!/usr/bin/env python3
"""
Lit des plaques avec le modèle entraîné, et applique la vérification croisée.

Sert à confronter le modèle à de VRAIES photos. Un score élevé sur le jeu de
validation ne prouve rien : celui-ci sort du même générateur que l'entraînement,
donc le modèle a pu n'apprendre que le générateur. Seules les plaques réelles
disent s'il a appris à lire.

Usage :
    python3 tools/plate-dataset/predict.py --model plate_crnn.pt img1.png img2.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from crosscheck import reconcile
from train import CRNN, IMG_H, IMG_W, decode


def load(path: Path):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    alphabet = ckpt["alphabet"]
    model = CRNN(len(alphabet))
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, alphabet


def read(model: CRNN, alphabet: list[str], path: Path) -> str:
    img = Image.open(path).convert("L").resize((IMG_W, IMG_H))
    x = torch.from_numpy(np.asarray(img, dtype="float32") / 255.0).unsqueeze(0).unsqueeze(0)
    x = (x - 0.5) / 0.5
    with torch.no_grad():
        return decode(model(x), alphabet)[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("images", nargs="+", type=Path)
    args = ap.parse_args()

    model, alphabet = load(args.model)
    for path in args.images:
        raw = read(model, alphabet, path)
        r = reconcile(raw)
        verdict = r.plate if r.plate else "REJET"
        print(f"{path.name:22} brut={raw!r:30} -> {verdict:10} ({r.reason})")


if __name__ == "__main__":
    main()
