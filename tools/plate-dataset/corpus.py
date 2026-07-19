#!/usr/bin/env python3
"""
Corpus de plaques réellement photographiées : source unique pour annoter,
découper, entraîner et évaluer.

Avant ce module, les annotations vivaient dans un répertoire temporaire, les
découpes étaient refaites à chaque fois avec des ratios codés en dur, et chaque
mesure portait sur un échantillon différent — deux chiffres n'étaient jamais
comparables. Tout est désormais décrit dans `corpus/annotations.json`.

Ce qui est versionné : les étiquettes et les coordonnées. Ce qui ne l'est pas :
les photos. Elles montrent des véhicules identifiables et des passants dans la
rue ; les distribuer avec le dépôt en ferait un fichier de circulation. Elles
restent donc chez celui qui les a prises, et les découpes se reconstruisent à la
demande — le corpus est un plan de coupe, pas une archive d'images.

Corollaire utile : corriger une découpe, c'est éditer quatre nombres dans un
fichier texte. C'est précisément ce qui manquait quand les ratios étaient dans
le code — trois heuristiques de séparation latin/arabe ont échoué faute de
pouvoir ajuster plaque par plaque.

    python3 tools/plate-dataset/corpus.py verifier
    python3 tools/plate-dataset/corpus.py construire --photos ~/Desktop/plaques --out data/corpus
    python3 tools/plate-dataset/corpus.py evaluer --modele data/plate_crnn_v4.pt --out data/corpus
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ICI = Path(__file__).parent
ANNOTATIONS = ICI / "corpus" / "annotations.json"

#: Part des plaques réservée à l'évaluation. Le tirage est figé par la graine :
#: sans cela, deux mesures successives porteraient sur des échantillons
#: différents et leur écart ne voudrait rien dire.
PART_TEST = 0.35
GRAINE = 0


def charger() -> dict:
    return json.loads(ANNOTATIONS.read_text(encoding="utf-8"))


def decoupe_apprentissage_test(plaques: dict) -> tuple[set[str], set[str]]:
    """
    Répartit par NUMÉRO de plaque, jamais par ligne ni par photo.

    Les deux graphies portent le même numéro, et une même voiture peut être
    photographiée plusieurs fois (`203D95` l'est deux fois). Répartir les lignes
    au hasard mettrait le latin d'une plaque en apprentissage et son arabe en
    test : le score mesurerait alors la mémorisation, pas la lecture.
    """
    import random

    numeros = sorted({v["plaque"] for v in plaques.values()})
    random.Random(GRAINE).shuffle(numeros)
    n = max(1, int(len(numeros) * PART_TEST))
    return set(numeros[n:]), set(numeros[:n])


def lignes(plaques: dict) -> list[dict]:
    """Aplatit le corpus en lignes individuelles, l'unité que lit le modèle."""
    out = []
    for tag, v in plaques.items():
        for script in ("latin", "arabe"):
            bloc = v.get(script)
            if not bloc:
                continue
            out.append({
                "tag": tag,
                "source": v["source"],
                "plaque": v["plaque"],
                "rotation": v.get("rotation", 0),
                "script": "latin" if script == "latin" else "arabic",
                "label": bloc["texte"],
                "boite": bloc["boite"],
            })
    return out


def cmd_verifier(args) -> None:
    """Confronte chaque annotation à la vérification croisée du projet."""
    from crosscheck import reconcile

    d = charger()
    plaques = d["plaques"]
    bons = suspects = sans_arabe = 0
    for tag, v in sorted(plaques.items()):
        if not v.get("arabe"):
            sans_arabe += 1
            continue
        r = reconcile(v["latin"]["texte"] + v["arabe"]["texte"])
        if r.plate == v["plaque"]:
            bons += 1
        else:
            suspects += 1
            print(f"  SUSPECT {tag:12} annonce={v['plaque']} obtenu={r.plate}  ({r.reason})")

    app, test = decoupe_apprentissage_test(plaques)
    ls = lignes(plaques)
    print(f"\n{len(plaques)} plaques, {len(ls)} lignes, "
          f"{len({v['plaque'] for v in plaques.values()})} numeros distincts")
    print(f"  coherentes  : {bons}")
    print(f"  suspectes   : {suspects}")
    print(f"  sans arabe  : {sans_arabe} (non verifiables)")
    print(f"  ecartees    : {len(d.get('_ecartees', {}))} (lecture incertaine, volontairement exclues)")
    print(f"\ndecoupe figee : {len(app)} numeros en apprentissage, {len(test)} en test")
    print(f"  test = {sorted(test)}")
    if suspects:
        raise SystemExit("des annotations ne concordent pas : corriger avant d'entrainer")


def _decouper(photo, boite, rotation):
    from PIL import Image
    import numpy as np

    # Marge verticale volontairement plus faible que l'horizontale : sur une
    # plaque carrée les deux lignes se touchent presque, et 20 % de marge
    # ramenait la ligne latine dans le recadrage arabe. Un peu de fond reste
    # nécessaire — sans marge du tout, le modèle perd le premier caractère
    # (mesuré : « 54D56 » sans marge, « 234D56 » avec).
    x, y, w, h = boite
    marge_x, marge_y = int(w * 0.12), int(h * 0.07)
    c = photo.crop((max(0, x - marge_x), max(0, y - marge_y),
                    min(photo.width, x + w + marge_x),
                    min(photo.height, y + h + marge_y)))
    if rotation:
        fond = int(np.median(np.asarray(c)))
        c = c.rotate(rotation, resample=Image.BICUBIC, fillcolor=fond)
    # Agrandissement : le modèle ramène tout à 192x48, mais interpoler depuis une
    # vignette de 90 px détruit les glyphes. On monte d'abord proprement.
    k = max(1, int(320 / max(1, c.width)))
    return c.resize((c.width * k, c.height * k), Image.LANCZOS) if k > 1 else c


def cmd_construire(args) -> None:
    from PIL import Image

    d = charger()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "images").mkdir(exist_ok=True)
    for vieux in (args.out / "images").glob("*.png"):
        vieux.unlink()

    app, test = decoupe_apprentissage_test(d["plaques"])
    rows, manquantes = [], set()
    for ligne in lignes(d["plaques"]):
        src = args.photos / ligne["source"]
        if not src.exists():
            manquantes.add(ligne["source"])
            continue
        img = _decouper(Image.open(src).convert("L"), ligne["boite"], ligne["rotation"])
        nom = f"{ligne['tag']}_{ligne['script']}.png"
        img.save(args.out / "images" / nom)
        rows.append({"image": f"images/{nom}", "label": ligne["label"],
                     "script": ligne["script"], "plate": ligne["plaque"],
                     "partie": "test" if ligne["plaque"] in test else "apprentissage"})

    with (args.out / "labels.jsonl").open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    n_app = sum(r["partie"] == "apprentissage" for r in rows)
    print(f"{len(rows)} lignes ecrites dans {args.out}  "
          f"({n_app} apprentissage, {len(rows) - n_app} test)")
    if manquantes:
        print(f"\n{len(manquantes)} photos absentes de {args.photos} :")
        for m in sorted(manquantes):
            print(f"  {m}")


def cmd_evaluer(args) -> None:
    import torch
    from predict import load, read

    rows = [json.loads(l) for l in (args.out / "labels.jsonl").open(encoding="utf-8")]
    if args.partie != "tout":
        rows = [r for r in rows if r["partie"] == args.partie]
    if not rows:
        raise SystemExit(f"aucune ligne : lancer d'abord `corpus.py construire`")

    model, alphabet = load(args.modele)

    def dist(a, b):
        d = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            prev, d[0] = d[0], i
            for j, cb in enumerate(b, 1):
                prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
        return d[-1]

    par_script = {}
    for r in rows:
        got = read(model, alphabet, args.out / r["image"], r["script"])
        s = par_script.setdefault(r["script"], [0, 0, 0])   # erreurs, caracteres, exactes
        s[0] += dist(got, r["label"])
        s[1] += len(r["label"])
        s[2] += got == r["label"]
        if args.detail:
            marque = "ok " if got == r["label"] else "NON"
            print(f"  {marque} {r['plate']:9} {r['script']:7} attendu={r['label']!r:12} lu={got!r}")

    print(f"\n{args.modele.name} — partie « {args.partie} », {len(rows)} lignes")
    et = tt = xt = 0
    for sc, (e, t, x) in sorted(par_script.items()):
        n = sum(1 for r in rows if r["script"] == sc)
        print(f"  {sc:7} : erreur caractere {100 * e / max(1, t):5.1f}%   exactes {x}/{n}")
        et, tt, xt = et + e, tt + t, xt + x
    print(f"  {'TOTAL':7} : erreur caractere {100 * et / max(1, tt):5.1f}%   exactes {xt}/{len(rows)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("verifier", help="controle la coherence des annotations").set_defaults(f=cmd_verifier)

    c = sub.add_parser("construire", help="reconstruit les decoupes depuis les photos")
    c.add_argument("--photos", type=Path, required=True, help="dossier des photos sources")
    c.add_argument("--out", type=Path, default=Path("data/corpus"))
    c.set_defaults(f=cmd_construire)

    e = sub.add_parser("evaluer", help="mesure un modele sur le corpus")
    e.add_argument("--modele", type=Path, required=True)
    e.add_argument("--out", type=Path, default=Path("data/corpus"))
    e.add_argument("--partie", choices=["test", "apprentissage", "tout"], default="test")
    e.add_argument("--detail", action="store_true")
    e.set_defaults(f=cmd_evaluer)

    args = ap.parse_args()
    args.f(args)


if __name__ == "__main__":
    main()
