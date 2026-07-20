#!/usr/bin/env python3
"""
Mesure PaddleOCR sur le corpus réel, AVANT toute décision d'intégration.

PaddleOCR est régulièrement recommandé pour les plaques bilingues — mais ML Kit
et PlateRecognizer, tout aussi recommandés, échouent totalement sur la police
7 segments djiboutienne (mesuré sur appareil, documenté dans le README). Un
moteur ne s'adopte pas sur réputation : il se mesure sur NOS plaques, avec les
mêmes étiquettes et le même taux d'erreur caractère que le CRNN, pour une
comparaison à armes égales.

Deux passes par ligne — modèle latin et modèle arabe — car PaddleOCR ne lit
qu'une écriture à la fois ; la fusion des deux lectures passe ensuite par la
même vérification croisée que le reste du projet.

Usage :
    python3 tools/plate-dataset/bench_paddleocr.py --corpus data/corpus
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def cer(a: str, b: str) -> int:
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[-1]


def textes(resultat) -> str:
    """Concatène les textes reconnus, toutes formes d'API confondues."""
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            for k in ("rec_texts", "rec_text", "text"):
                v = node.get(k)
                if isinstance(v, str):
                    out.append(v)
                elif isinstance(v, list):
                    out.extend(str(x) for x in v)
            for v in node.values():
                if isinstance(v, (list, dict)):
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(resultat)
    return "".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus", type=Path, default=Path("data/corpus"))
    ap.add_argument("--partie", default="tout", choices=["test", "apprentissage", "tout"])
    args = ap.parse_args()

    from paddleocr import PaddleOCR

    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from crosscheck import reconcile, split_scripts

    moteurs = {
        "latin": PaddleOCR(lang="en", use_doc_orientation_classify=False,
                           use_doc_unwarping=False, use_textline_orientation=False),
        "arabic": PaddleOCR(lang="ar", use_doc_orientation_classify=False,
                            use_doc_unwarping=False, use_textline_orientation=False),
    }

    rows = [json.loads(l) for l in (args.corpus / "labels.jsonl").open(encoding="utf-8")]
    if args.partie != "tout":
        rows = [r for r in rows if r["partie"] == args.partie]

    err = tot = exactes = 0
    par_plaque: dict[str, dict[str, str]] = {}
    for r in rows:
        chemin = str(args.corpus / r["image"])
        # La graphie de la ligne détermine le moteur ; une ligne « full » passe
        # dans les deux et les lectures sont concaténées.
        if r["script"] == "full":
            lu = textes(moteurs["latin"].predict(chemin)) + textes(moteurs["arabic"].predict(chemin))
        else:
            lu = textes(moteurs[r["script"]].predict(chemin))
        latin, arabe = split_scripts(lu.upper())
        lu_utile = latin + arabe                       # on ignore le bruit hors alphabet
        err += cer(lu_utile, r["label"])
        tot += len(r["label"])
        exactes += lu_utile == r["label"]
        cle = f"{r['plate']}|{r['image'].rsplit('_', 1)[0]}"
        par_plaque.setdefault(cle, {})[r["script"]] = lu_utile
        print(f"  {r['plate']:9} {r['script']:7} attendu={r['label']!r:22} paddle={lu_utile!r}")

    print(f"\nPaddleOCR — erreur caractere {100 * err / max(1, tot):.1f}%, "
          f"lignes exactes {exactes}/{len(rows)}")

    ok = rejets = faux = 0
    for cle, lectures in par_plaque.items():
        plaque = cle.split("|")[0]
        brut = lectures.get("full") or (lectures.get("latin", "") + lectures.get("arabic", ""))
        r2 = reconcile(brut)
        if r2.plate == plaque:
            ok += 1
        elif r2.plate is None:
            rejets += 1
        else:
            faux += 1
    n = ok + rejets + faux
    print(f"niveau plaque (verification croisee) : {ok}/{n} correctes, "
          f"{rejets} rejetees, {faux} FAUSSES ACCEPTEES")


if __name__ == "__main__":
    main()
