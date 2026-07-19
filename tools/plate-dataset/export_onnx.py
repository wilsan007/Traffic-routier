#!/usr/bin/env python3
"""
Exporte le CRNN vers ONNX, première étape du chemin vers le téléphone.

Le modèle d'atelier est un checkpoint PyTorch ; l'application mobile exécute du
TFLite (react-native-fast-tflite) ou, à défaut, de l'ONNX (onnxruntime). Dans
les deux cas, ONNX est le format pivot.

L'export n'est PAS considéré acquis tant qu'il n'est pas vérifié : les couches
BiLSTM sont précisément celles que les convertisseurs traduisent mal, et un
modèle silencieusement divergent lirait de travers sans que rien ne le signale.
Le script compare donc, sur le corpus réel, les lectures décodées du modèle
exporté à celles du modèle d'origine — l'export n'est déclaré bon que si elles
sont IDENTIQUES sur toutes les lignes.

Usage :
    python3 tools/plate-dataset/export_onnx.py \
        --modele data/plate_crnn_v6_reel.pt --out data/plate_crnn_v6_reel.onnx \
        --corpus data/corpus
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from predict import load
from train import IMG_H, IMG_W, decode


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--modele", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--corpus", type=Path, default=Path("data/corpus"),
                    help="Jeu réel servant de référence de vérification.")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    model, alphabet = load(args.modele)

    exemple = torch.zeros(1, 1, IMG_H, IMG_W)
    torch.onnx.export(
        model, exemple, str(args.out),
        input_names=["image"], output_names=["logits"],
        # Lot dynamique : l'app lira une ligne à la fois, l'atelier par lots.
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=args.opset,
    )

    # L'alphabet accompagne le modèle : l'app en a besoin pour décoder, et un
    # alphabet désynchronisé produirait des lectures fausses sans erreur.
    meta = {"alphabet": alphabet, "img_h": IMG_H, "img_w": IMG_W,
            "normalisation": "(pixel/255 - 0.5) / 0.5", "blank_index": 0}
    args.out.with_suffix(".json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- Vérification : mêmes lectures que PyTorch sur le corpus réel --------
    import onnxruntime as ort
    from PIL import Image

    sess = ort.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])
    rows = [json.loads(l) for l in (args.corpus / "labels.jsonl").open(encoding="utf-8")]

    identiques = 0
    ecart_max = 0.0
    for r in rows:
        img = Image.open(args.corpus / r["image"]).convert("L").resize((IMG_W, IMG_H))
        x = np.asarray(img, dtype="float32")[None, None] / 255.0
        x = (x - 0.5) / 0.5

        with torch.no_grad():
            ref = model(torch.from_numpy(x))
        out = sess.run(None, {"image": x})[0]

        ecart_max = max(ecart_max, float(np.abs(ref.numpy() - out).max()))
        lu_ref = decode(ref, alphabet)[0]
        lu_onnx = decode(torch.from_numpy(out), alphabet)[0]
        if lu_ref == lu_onnx:
            identiques += 1
        else:
            print(f"  DIVERGENCE {r['image']}: torch={lu_ref!r} onnx={lu_onnx!r}")

    print(f"verification : {identiques}/{len(rows)} lectures identiques, "
          f"ecart max sur les logits {ecart_max:.2e}")
    if identiques != len(rows):
        raise SystemExit("export divergent : NE PAS embarquer ce fichier")
    taille = args.out.stat().st_size / 1e6
    print(f"OK — {args.out} ({taille:.1f} Mo) + {args.out.with_suffix('.json').name}")


if __name__ == "__main__":
    main()
