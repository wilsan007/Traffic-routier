#!/usr/bin/env python3
"""
Quantifie le CRNN ONNX en INT8, et ne le garde que si les lectures tiennent.

La quantification dynamique divise la taille par ~4 (11 Mo → ~3 Mo) et accélère
l'inférence sur téléphone — mais elle ARRONDIT les poids, et un CRNN dont les
logits bougent peut changer de lecture sur les cas limites. La règle est donc
la même que pour l'export : le modèle quantifié est comparé au flottant sur le
corpus réel, lecture décodée par lecture décodée. On tolère ici de rares écarts
(la quantification n'est pas une copie), mais chaque écart est AFFICHÉ et le
taux d'erreur caractère des deux modèles est mesuré contre les étiquettes — si
l'INT8 lit moins bien le réel que le flottant, on ne l'embarque pas.

Usage :
    python3 tools/plate-dataset/quantize_onnx.py \
        --entree data/plate_crnn_v6_reel.onnx --out data/plate_crnn_v6_reel.int8.onnx
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def cer(a: str, b: str) -> int:
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[-1]


def decode_greedy(logits: np.ndarray, alphabet: list[str]) -> str:
    out, prev = [], -1
    for k in logits.argmax(-1):
        if k != prev and k != 0:
            out.append(alphabet[k - 1])
        prev = k
    return "".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entree", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--corpus", type=Path, default=Path("data/corpus"))
    args = ap.parse_args()

    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(args.entree), str(args.out), weight_type=QuantType.QUInt8)

    import onnxruntime as ort
    from PIL import Image

    meta = json.loads(args.entree.with_suffix(".json").read_text(encoding="utf-8"))
    alphabet, W, H = meta["alphabet"], meta["img_w"], meta["img_h"]
    # L'alphabet accompagne aussi le modèle quantifié.
    args.out.with_suffix(".json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

    s_f = ort.InferenceSession(str(args.entree), providers=["CPUExecutionProvider"])
    s_q = ort.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])

    rows = [json.loads(l) for l in (args.corpus / "labels.jsonl").open(encoding="utf-8")]
    identiques = 0
    err_f = err_q = tot = 0
    for r in rows:
        img = Image.open(args.corpus / r["image"]).convert("L").resize((W, H))
        x = np.asarray(img, dtype="float32")[None, None] / 255.0
        x = (x - 0.5) / 0.5
        lu_f = decode_greedy(s_f.run(None, {"image": x})[0][0], alphabet)
        lu_q = decode_greedy(s_q.run(None, {"image": x})[0][0], alphabet)
        err_f += cer(lu_f, r["label"])
        err_q += cer(lu_q, r["label"])
        tot += len(r["label"])
        if lu_f == lu_q:
            identiques += 1
        else:
            print(f"  ecart {r['image']}: float={lu_f!r} int8={lu_q!r} (attendu {r['label']!r})")

    t_f = args.entree.stat().st_size / 1e6
    t_q = args.out.stat().st_size / 1e6
    print(f"\nlectures identiques : {identiques}/{len(rows)}")
    print(f"erreur caractere vs etiquettes : float {100*err_f/tot:.1f}%  |  int8 {100*err_q/tot:.1f}%")
    print(f"taille : {t_f:.1f} Mo -> {t_q:.1f} Mo")
    if err_q > err_f:
        raise SystemExit("l'INT8 lit MOINS BIEN le corpus reel : ne pas l'embarquer")
    print(f"OK — {args.out}")


if __name__ == "__main__":
    main()
