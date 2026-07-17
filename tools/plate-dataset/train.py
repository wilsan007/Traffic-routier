#!/usr/bin/env python3
"""
Entraîne le modèle de reconnaissance des plaques djiboutiennes.

Architecture : CRNN + CTC. Un CNN extrait des colonnes de traits sur la largeur
de la plaque, un BiLSTM les lit en séquence, et la perte CTC aligne seule les
caractères — inutile de découper la plaque caractère par caractère, ce qui est
précisément ce qui échoue sur les polices 7 segments où les glyphes se touchent.

Le modèle lit le latin ET l'arabe en une seule passe. Les deux graphies portant
le même numéro, leur concordance après normalisation donne une vérification
croisée — et surtout, l'arabe est la SEULE façon de savoir qu'un `0` gravé est
en réalité un `D` (voir generate.py).

Usage :
    python3 tools/plate-dataset/train.py --data data/plates --epochs 30
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset

# Hauteur fixe : le CNN réduit la largeur en pas de temps, la hauteur à 1.
IMG_H, IMG_W = 48, 192


def build_alphabet(rows: list[dict]) -> list[str]:
    """L'alphabet est déduit des données plutôt que codé en dur : il reste ainsi
    cohérent avec le générateur, y compris si les formats évoluent."""
    return sorted({c for r in rows for c in r["label"]})


class PlateDataset(Dataset):
    def __init__(self, root: Path, rows: list[dict], stoi: dict[str, int]):
        self.root, self.rows, self.stoi = root, rows, stoi

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int):
        r = self.rows[i]
        img = Image.open(self.root / r["image"]).convert("L").resize((IMG_W, IMG_H))
        x = torch.from_numpy(
            __import__("numpy").asarray(img, dtype="float32") / 255.0
        ).unsqueeze(0)
        x = (x - 0.5) / 0.5
        y = torch.tensor([self.stoi[c] for c in r["label"]], dtype=torch.long)
        return x, y


def collate(batch):
    xs, ys = zip(*batch)
    lengths = torch.tensor([len(y) for y in ys], dtype=torch.long)
    return torch.stack(xs), torch.cat(ys), lengths


class CRNN(nn.Module):
    def __init__(self, n_classes: int):
        super().__init__()
        # Les poolings réduisent la hauteur jusqu'à 1 tout en préservant la
        # largeur : chaque pas de temps voit une tranche verticale de la plaque.
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
            nn.MaxPool2d(2, 2),                       # 24 x 96
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
            nn.MaxPool2d(2, 2),                       # 12 x 48
            nn.Conv2d(128, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(),
            nn.MaxPool2d((2, 1), (2, 1)),             # 6 x 48
            nn.Conv2d(256, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(),
            nn.MaxPool2d((2, 1), (2, 1)),             # 3 x 48
            nn.Conv2d(256, 256, (3, 1)), nn.BatchNorm2d(256), nn.ReLU(),  # 1 x 48
        )
        self.rnn = nn.LSTM(256, 192, num_layers=2, bidirectional=True, batch_first=True)
        self.head = nn.Linear(384, n_classes + 1)  # +1 : le blanc de CTC

    def forward(self, x):
        f = self.cnn(x).squeeze(2).permute(0, 2, 1)  # (B, T, C)
        f, _ = self.rnn(f)
        return self.head(f)


def decode(logits: torch.Tensor, itos: list[str]) -> list[str]:
    """Décodage glouton CTC : on retire les répétitions puis les blancs."""
    out = []
    for seq in logits.argmax(-1).cpu().tolist():
        prev, chars = -1, []
        for k in seq:
            if k != prev and k != 0:
                chars.append(itos[k - 1])
            prev = k
        out.append("".join(chars))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--out", type=Path, default=Path("plate_crnn.pt"))
    args = ap.parse_args()

    rows = [json.loads(l) for l in (args.data / "labels.jsonl").open(encoding="utf-8")]
    random.Random(0).shuffle(rows)
    cut = int(len(rows) * 0.95)
    train_rows, val_rows = rows[:cut], rows[cut:]

    alphabet = build_alphabet(rows)
    stoi = {c: i + 1 for i, c in enumerate(alphabet)}  # 0 réservé au blanc CTC

    print(f"alphabet ({len(alphabet)}) : {''.join(alphabet)}")
    print(f"train {len(train_rows)} | val {len(val_rows)}")

    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print("device :", dev)

    dl = DataLoader(PlateDataset(args.data, train_rows, stoi), batch_size=args.batch,
                    shuffle=True, collate_fn=collate, num_workers=4)
    vdl = DataLoader(PlateDataset(args.data, val_rows, stoi), batch_size=args.batch,
                     collate_fn=collate, num_workers=2)

    model = CRNN(len(alphabet)).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    itos = alphabet

    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        for x, y, ylen in dl:
            x, y, ylen = x.to(dev), y.to(dev), ylen.to(dev)
            logits = model(x)
            logp = logits.log_softmax(-1).permute(1, 0, 2)  # (T, B, C) pour CTC
            xlen = torch.full((x.size(0),), logits.size(1), dtype=torch.long, device=dev)
            loss = ctc(logp, y, xlen, ylen)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            total += loss.item()
        sched.step()

        model.eval()
        exact = seen = 0
        with torch.no_grad():
            for x, y, ylen in vdl:
                preds = decode(model(x.to(dev)), itos)
                off = 0
                for p, n in zip(preds, ylen.tolist()):
                    truth = "".join(itos[k - 1] for k in y[off:off + n].tolist())
                    off += n
                    exact += p == truth
                    seen += 1
        print(f"epoch {epoch:3d} | perte {total / len(dl):.4f} | "
              f"exactes {exact}/{seen} ({100 * exact / seen:.1f}%)")

    torch.save({"state_dict": model.state_dict(), "alphabet": alphabet}, args.out)
    print("modèle enregistré :", args.out)


if __name__ == "__main__":
    main()
