#!/usr/bin/env python3
"""
Affine le modèle synthétique sur des plaques réellement photographiées.

Le générateur ne reproduit pas ce qui fait échouer le modèle sur le terrain :
embouti, reflets, poussière, flou de mouvement, angles de prise de vue. Cinq
élargissements successifs du générateur ont fait passer l'erreur caractère de
61 % à 40 % sur de vraies plaques, mais le palier suivant ne viendra pas d'un
sixième réglage — il viendra de vraies images.

Deux précautions, sans lesquelles l'exercice se retourne contre lui :

  - **Mélange plutôt que remplacement.** Une quarantaine de lignes réelles ne
    suffit pas à réapprendre à lire ; s'entraîner dessus seules détruirait ce
    que les 20 000 synthétiques ont appris. Le réel est donc suréchantillonné
    dans un flux qui reste majoritairement synthétique.

  - **Découpe par PLAQUE, pas par ligne.** Les deux graphies d'une plaque
    portent le même numéro, et une même voiture peut être photographiée deux
    fois. Répartir les lignes au hasard mettrait le latin d'une plaque en
    entraînement et son arabe en test : le score mesurerait alors la
    mémorisation, pas la lecture.

Usage :
    python3 tools/plate-dataset/finetune.py \
        --synth data/plates --reel data/plates-reelles \
        --depuis data/plate_crnn_v4.pt --out data/plate_crnn_reel.pt
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from train import CRNN, PlateDataset, collate, decode


def charger(root: Path) -> list[dict]:
    return [json.loads(l) for l in (root / "labels.jsonl").open(encoding="utf-8")]


def distance(a: str, b: str) -> int:
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[-1]


def evaluer(model, dev, root: Path, rows: list[dict], stoi, itos) -> tuple[float, int]:
    """Retourne (taux d'erreur caractère, lignes exactes)."""
    if not rows:
        return 0.0, 0
    dl = DataLoader(PlateDataset(root, rows, stoi), batch_size=16, collate_fn=collate)
    err = tot = exact = 0
    model.eval()
    with torch.no_grad():
        for x, y, ylen in dl:
            preds = decode(model(x.to(dev)), itos)
            off = 0
            for p, n in zip(preds, ylen.tolist()):
                truth = "".join(itos[k - 1] for k in y[off:off + n].tolist())
                off += n
                err += distance(p, truth)
                tot += len(truth)
                exact += p == truth
    return err / max(1, tot), exact


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--synth", type=Path, required=True)
    ap.add_argument("--reel", type=Path, required=True)
    ap.add_argument("--depuis", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-4,
                    help="Faible : on ajuste un modèle qui sait déjà lire.")
    ap.add_argument("--repetitions", type=int, default=40,
                    help="Suréchantillonnage du réel face aux 20 000 synthétiques.")
    ap.add_argument("--part-test", type=float, default=0.35)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    ckpt = torch.load(args.depuis, map_location="cpu", weights_only=False)
    alphabet = ckpt["alphabet"]
    stoi = {c: i + 1 for i, c in enumerate(alphabet)}

    synth = charger(args.synth)
    reel = charger(args.reel)

    # Découpe par plaque : toutes les lignes d'une même plaque vont du même côté.
    plaques = sorted({r["plate"] for r in reel})
    random.Random(args.seed).shuffle(plaques)
    n_test = max(1, int(len(plaques) * args.part_test))
    test_p = set(plaques[:n_test])
    reel_train = [r for r in reel if r["plate"] not in test_p]
    reel_test = [r for r in reel if r["plate"] in test_p]

    print(f"reel : {len(plaques)} plaques -> {len(plaques) - n_test} apprentissage, {n_test} test")
    print(f"       {len(reel_train)} lignes apprentissage, {len(reel_test)} lignes test")
    print(f"test  : {sorted(test_p)}")

    inconnus = {c for r in reel for c in r["label"]} - set(alphabet)
    if inconnus:
        raise SystemExit(f"caracteres absents de l'alphabet du modele : {inconnus}")

    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model = CRNN(len(alphabet)).to(dev)
    model.load_state_dict(ckpt["state_dict"])

    cer0, ex0 = evaluer(model, dev, args.reel, reel_test, stoi, alphabet)
    print(f"\navant affinage : erreur caractere {100 * cer0:.0f}%, {ex0}/{len(reel_test)} lignes exactes\n")

    melange = [(args.synth, r) for r in synth] + [(args.reel, r) for r in reel_train] * args.repetitions
    print(f"flux d'entrainement : {len(synth)} synthetiques + "
          f"{len(reel_train)} reelles x{args.repetitions} = {len(melange)} echantillons")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    meilleur = cer0

    for epoch in range(1, args.epochs + 1):
        model.train()
        random.Random(epoch).shuffle(melange)
        total = n = 0.0
        # Les deux racines coexistent dans le flux : on regroupe par racine pour
        # réutiliser PlateDataset tel quel.
        for i in range(0, len(melange), args.batch):
            lot = melange[i:i + args.batch]
            for racine in {r for r, _ in lot}:
                sous = [row for rr, row in lot if rr == racine]
                if not sous:
                    continue
                dl = DataLoader(PlateDataset(racine, sous, stoi),
                                batch_size=len(sous), collate_fn=collate)
                for x, y, ylen in dl:
                    x, y, ylen = x.to(dev), y.to(dev), ylen.to(dev)
                    logits = model(x)
                    logp = logits.log_softmax(-1).permute(1, 0, 2)
                    xlen = torch.full((x.size(0),), logits.size(1),
                                      dtype=torch.long, device=dev)
                    loss = ctc(logp, y, xlen, ylen)
                    opt.zero_grad()
                    loss.backward()
                    nn.utils.clip_grad_norm_(model.parameters(), 5.0)
                    opt.step()
                    total += loss.item()
                    n += 1

        cer, ex = evaluer(model, dev, args.reel, reel_test, stoi, alphabet)
        print(f"epoch {epoch:2d} | perte {total / max(1, n):.4f} | "
              f"reel TEST : erreur {100 * cer:.0f}%, {ex}/{len(reel_test)} exactes", flush=True)

        if cer < meilleur:
            meilleur = cer
            torch.save({"state_dict": model.state_dict(), "alphabet": alphabet,
                        "epoch": epoch, "cer_reel": cer}, args.out)
            print(f"          -> enregistre ({args.out})", flush=True)

    print(f"\nerreur caractere sur plaques reelles jamais vues : {100 * cer0:.0f}% -> {100 * meilleur:.0f}%")


if __name__ == "__main__":
    main()
