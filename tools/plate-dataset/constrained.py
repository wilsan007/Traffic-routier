#!/usr/bin/env python3
"""
Décodage CTC sous contrainte du format des plaques djiboutiennes.

Le décodage glouton choisit, à chaque pas de temps, le caractère le plus
probable — sans jamais se demander si la suite obtenue est une plaque possible.
Il produit donc des lectures que le format exclut d'emblée (« 3TT », « 5424 »,
« 93136TT » — toutes observées sur de vraies photos), qui sont ensuite rejetées
en aval. On jette l'image alors que l'information y était.

Ici, la recherche est restreinte aux séquences qui RESTENT extensibles en une
plaque valide. La contrainte n'est pas un filtre appliqué après coup : elle
élague pendant la recherche, ce qui laisse remonter la meilleure hypothèse
valide au lieu de la meilleure hypothèse tout court. Un « 3TT » impossible cède
la place au « 3090TT » qui, lui, existe.

C'est le pendant du comptage de caractères dans crosscheck.py : celui-ci rejette
une lecture incohérente, celui-là évite de la produire.

Formats (voir apps/mobile/lib/djiboutiPlate.ts) — exprimés en GLYPHES gravés,
donc en tenant compte du `D` rendu `0` par la police 7 segments :

    privé     [1-9]\\d{0,2} (D|0) [1-9]\\d{0,2}      252D105 · 2520105
    officiel  \\d{3,5} [ABC]                         3044C
    transit   \\d{3,5} TT                            3090TT

et leurs équivalents arabes, en ordre visuel (droite-à-gauche) :

    privé     [١-٩]\\d{0,2} ج [١-٩]\\d{0,2}          ١٠٥ج٢٥٢
    officiel  (ا|ب|ت) \\d{3,5}                       ت٣٠٤٤
    transit   تت \\d{3,5}                            تت٣٠٩٠
"""

from __future__ import annotations

import math

AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
AR_NONZERO = AR_DIGITS[1:]


# --- Viabilité d'un préfixe -------------------------------------------------
#
# `viable` répond « ce début de séquence peut-il encore devenir une plaque ? »,
# `complete` répond « en est-ce déjà une ? ». La recherche a besoin des deux :
# la première pour élaguer, la seconde pour ne retenir que des lectures finies.


def _split_digits(s: str, digits: str) -> tuple[str, str]:
    i = 0
    while i < len(s) and s[i] in digits:
        i += 1
    return s[:i], s[i:]


def viable_latin(s: str) -> bool:
    if s == "":
        return True

    d, rest = _split_digits(s, "0123456789")

    # transit et officiel : des chiffres, puis le suffixe.
    if rest == "" and len(d) <= 5:
        return True
    if rest == "T" and 3 <= len(d) <= 5:
        return True
    if rest == "TT" and 3 <= len(d) <= 5:
        return True
    if rest in ("A", "B", "C") and 3 <= len(d) <= 5:
        return True

    # privé : le séparateur peut être un `D` ou, en 7 segments, un `0`. On
    # essaie chaque découpe plausible et il suffit qu'une tienne.
    for i in range(1, min(len(s), 4)):
        head = s[:i]
        if not (head[0] in "123456789" and head.isdigit()):
            continue
        if i >= len(s):
            return True                      # séparateur pas encore atteint
        if s[i] not in "D0":
            continue
        tail = s[i + 1:]
        if tail == "":
            return True
        if tail[0] in "123456789" and tail.isdigit() and len(tail) <= 3:
            return True

    # préfixe d'un nombre privé, séparateur pas encore lu
    return bool(s.isdigit() and s[0] in "123456789" and len(s) <= 3)


def complete_latin(s: str) -> bool:
    d, rest = _split_digits(s, "0123456789")
    if rest == "TT" and 3 <= len(d) <= 5:
        return True
    if rest in ("A", "B", "C") and 3 <= len(d) <= 5:
        return True
    for i in range(1, len(s) - 1):
        if s[i] not in "D0":
            continue
        head, tail = s[:i], s[i + 1:]
        if (head.isdigit() and head[0] in "123456789" and len(head) <= 3
                and tail.isdigit() and tail[0] in "123456789" and len(tail) <= 3):
            return True
    return False


def viable_arabic(s: str) -> bool:
    if s == "":
        return True

    # officiel et transit commencent par la lettre de catégorie.
    if s[0] in "اب":
        rest = s[1:]
        return all(c in AR_DIGITS for c in rest) and len(rest) <= 5
    if s[0] == "ت":
        if len(s) == 1:
            return True
        if s[1] == "ت":                       # تت = TT
            rest = s[2:]
            return all(c in AR_DIGITS for c in rest) and len(rest) <= 5
        rest = s[1:]
        return all(c in AR_DIGITS for c in rest) and len(rest) <= 5

    # privé : chiffres, ج, chiffres — en ordre visuel inversé.
    if "ج" in s:
        i = s.index("ج")
        head, tail = s[:i], s[i + 1:]
        if not (1 <= len(head) <= 3 and head[0] in AR_NONZERO
                and all(c in AR_DIGITS for c in head)):
            return False
        if tail == "":
            return True
        return (tail[0] in AR_NONZERO and all(c in AR_DIGITS for c in tail)
                and len(tail) <= 3)

    return (all(c in AR_DIGITS for c in s) and s[0] in AR_NONZERO and len(s) <= 3)


def complete_arabic(s: str) -> bool:
    # Trois caractères au minimum : une plaque privée peut n'avoir qu'un chiffre
    # de chaque côté de la lettre (« 2 D 3 » → « ٣ج٢ »). Exiger davantage
    # écartait silencieusement le début de chaque cycle de numérotation, soit
    # les plaques les plus basses du parc.
    if len(s) < 3:
        return False
    if s[0] == "ت" and len(s) > 1 and s[1] == "ت":
        rest = s[2:]
        return 3 <= len(rest) <= 5 and all(c in AR_DIGITS for c in rest)
    if s[0] in "ابت":
        rest = s[1:]
        return 3 <= len(rest) <= 5 and all(c in AR_DIGITS for c in rest)
    if "ج" in s:
        i = s.index("ج")
        head, tail = s[:i], s[i + 1:]
        return (1 <= len(head) <= 3 and head[0] in AR_NONZERO
                and all(c in AR_DIGITS for c in head)
                and 1 <= len(tail) <= 3 and tail[0] in AR_NONZERO
                and all(c in AR_DIGITS for c in tail))
    return False


# --- Recherche en faisceau --------------------------------------------------


def _logsumexp(a: float, b: float) -> float:
    if a == -math.inf:
        return b
    if b == -math.inf:
        return a
    hi, lo = (a, b) if a > b else (b, a)
    return hi + math.log1p(math.exp(lo - hi))


def beam_search(logp, itos: list[str], viable, complete, beam: int = 24) -> str:
    """
    Décodage CTC par recherche de préfixe, restreint aux préfixes viables.

    `logp` est de forme (T, C) en log-probabilités, l'indice 0 étant le blanc de
    CTC — même convention que `train.decode`. `itos[k - 1]` donne le caractère de
    la classe k.

    Deux probabilités sont suivies par préfixe selon que le dernier pas de temps
    était un blanc ou non : c'est ce qui distingue « 33 » (deux caractères) de
    « 3 » répété sur deux pas, distinction que CTC code par le blanc.
    """
    T, C = logp.shape
    # préfixe -> (log p terminant par un blanc, log p terminant par un caractère)
    beams: dict[str, tuple[float, float]] = {"": (0.0, -math.inf)}

    for t in range(T):
        row = logp[t]
        # Seules les classes plausibles sont développées : le reste ne ferait
        # que gonfler le faisceau sans jamais y survivre.
        top = sorted(range(C), key=lambda k: -row[k])[:8]
        nxt: dict[str, tuple[float, float]] = {}

        def add(pref: str, pb: float, pnb: float) -> None:
            cur = nxt.get(pref)
            if cur is None:
                nxt[pref] = (pb, pnb)
            else:
                nxt[pref] = (_logsumexp(cur[0], pb), _logsumexp(cur[1], pnb))

        for pref, (pb, pnb) in beams.items():
            total = _logsumexp(pb, pnb)
            for k in top:
                p = row[k]
                if k == 0:                                   # blanc
                    add(pref, total + p, -math.inf)
                    continue
                ch = itos[k - 1]
                if pref and ch == pref[-1]:
                    # répétition : sans blanc intercalé elle fusionne,
                    # avec blanc elle crée un second caractère.
                    add(pref, -math.inf, pnb + p)
                    ext = pref + ch
                    if viable(ext):
                        add(ext, -math.inf, pb + p)
                else:
                    ext = pref + ch
                    if viable(ext):
                        add(ext, -math.inf, total + p)

        beams = dict(sorted(nxt.items(),
                            key=lambda kv: -_logsumexp(kv[1][0], kv[1][1]))[:beam])

    finals = [(p, _logsumexp(*v)) for p, v in beams.items() if complete(p)]
    if not finals:
        return ""
    return max(finals, key=lambda kv: kv[1])[0]


if __name__ == "__main__":
    ok = 0
    cases = [
        (viable_latin, "252", True), (viable_latin, "252D", True),
        (viable_latin, "252D105", True), (viable_latin, "2520105", True),
        # « 0 » est viable : le format officiel est \d{3,5}[ABC], qui admet un
        # zéro initial (« 0123A »). Seule la partie PRIVÉE l'interdit.
        (viable_latin, "0", True), (viable_latin, "3T", False),
        (viable_latin, "3090T", True), (viable_latin, "9999999", False),
        (complete_latin, "252D105", True), (complete_latin, "2520105", True),
        (complete_latin, "3090TT", True), (complete_latin, "3044C", True),
        (complete_latin, "3TT", False), (complete_latin, "252D", False),
        (viable_arabic, "١٠٥", True), (viable_arabic, "١٠٥ج", True),
        (viable_arabic, "١٠٥ج٢٥٢", True), (viable_arabic, "٠١٢", False),
        (viable_arabic, "تت", True), (viable_arabic, "ت٣٠٤٤", True),
        (complete_arabic, "١٠٥ج٢٥٢", True), (complete_arabic, "تت٣٠٩٠", True),
        (complete_arabic, "ت٣٠٤٤", True), (complete_arabic, "١٠٥ج", False),
        # Plaque privée minimale : « 2 D 3 ». Un garde-fou trop strict sur la
        # longueur l'écartait, avec toutes celles du début de cycle.
        (complete_arabic, "٣ج٢", True), (complete_latin, "2D3", True),
    ]
    for fn, s, want in cases:
        got = fn(s)
        ok += got == want
        if got != want:
            print(f"ECHEC {fn.__name__}({s!r}) = {got}, attendu {want}")
    print(f"{ok}/{len(cases)} cas passent")
