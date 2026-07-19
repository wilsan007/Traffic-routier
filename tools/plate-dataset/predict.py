#!/usr/bin/env python3
"""
Lit des plaques avec le modèle entraîné, et applique la vérification croisée.

Sert à confronter le modèle à de VRAIES photos. Un score élevé sur le jeu de
validation ne prouve rien : celui-ci sort du même générateur que l'entraînement,
donc le modèle a pu n'apprendre que le générateur. Seules les plaques réelles
disent s'il a appris à lire.

Le modèle lit UNE LIGNE à la fois (voir render_line dans generate.py), alors que
la vérification croisée a besoin des DEUX écritures d'une même plaque. Ce script
prend donc des images de lignes nommées `<plaque>_latin.png` et
`<plaque>_arabic.png`, les regroupe par préfixe, et ne confronte que des paires
complètes. Passer une ligne seule à `reconcile` la ferait rejeter d'office —
l'arabe ou le latin manquerait — ce qui ressemblerait à un échec du modèle alors
que c'est l'appel qui serait mal formé.

Usage :
    python3 tools/plate-dataset/predict.py --model plate_crnn.pt crops/*.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import constrained
from crosscheck import reconcile
from train import CRNN, IMG_H, IMG_W, decode


def load(path: Path):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    alphabet = ckpt["alphabet"]
    model = CRNN(len(alphabet))
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, alphabet


def read(model: CRNN, alphabet: list[str], path: Path, script: str | None = None) -> str:
    """
    Lit une ligne. `script` (« latin » ou « arabic ») active le décodage
    contraint au format des plaques ; sans lui, le décodage reste glouton.

    La contrainte dépend de l'écriture, d'où le paramètre : les deux graphies
    ont des grammaires différentes — la lettre de catégorie est au milieu en
    latin, au début en arabe.
    """
    img = Image.open(path).convert("L").resize((IMG_W, IMG_H))
    x = torch.from_numpy(np.asarray(img, dtype="float32") / 255.0).unsqueeze(0).unsqueeze(0)
    x = (x - 0.5) / 0.5
    with torch.no_grad():
        logits = model(x)

    if script is None:
        return decode(logits, alphabet)[0]

    viable, complete = (
        (constrained.viable_latin, constrained.complete_latin) if script == "latin"
        else (constrained.viable_arabic, constrained.complete_arabic)
    )
    logp = logits.log_softmax(-1)[0].cpu().numpy()
    return constrained.beam_search(logp, alphabet, viable, complete)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--glouton", action="store_true",
                    help="Décodage glouton, sans contrainte de format (pour comparer).")
    ap.add_argument("images", nargs="+", type=Path)
    args = ap.parse_args()

    model, alphabet = load(args.model)

    # Regroupement par plaque : « 234D56_latin.png » et « 234D56_arabic.png »
    # sont deux lignes de la MÊME plaque, et la vérification croisée les exige
    # toutes les deux.
    plates: dict[str, dict[str, str]] = {}
    for path in args.images:
        name, _, script = path.stem.rpartition("_")
        if script not in ("latin", "arabic"):
            print(f"{path.name}: ignore (attendu <plaque>_latin.png ou <plaque>_arabic.png)")
            continue
        plates.setdefault(name or path.stem, {})[script] = read(
            model, alphabet, path, None if args.glouton else script)

    for name, lines in sorted(plates.items()):
        latin, arabic = lines.get("latin"), lines.get("arabic")
        if latin is None or arabic is None:
            manquant = "arabic" if arabic is None else "latin"
            print(f"{name:22} ligne {manquant} absente -> pas de verification croisee")
            continue

        r = reconcile(latin + arabic)
        verdict = r.plate if r.plate else "REJET"
        print(f"{name:22} latin={latin!r:14} arabe={arabic!r:14} -> {verdict:10} ({r.reason})")


if __name__ == "__main__":
    main()
