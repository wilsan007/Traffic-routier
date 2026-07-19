#!/usr/bin/env python3
"""
Reconstruit le numéro de plaque à partir de la lecture brute du modèle, en
confrontant le latin et l'arabe.

Le modèle sort les GLYPHES qu'il voit, pas le numéro : « 252 D 105 » gravée en
7 segments se lit « 2520105١٠٥ج٢٥٢ », car le `D` y est un rectangle plein
indiscernable d'un `0`. Aucun modèle ne peut lever cette ambiguïté — les pixels
sont identiques. C'est l'arabe qui la tranche, et c'est pour cela qu'on le lit.

En prime, les deux graphies portant le même numéro, leur désaccord révèle une
erreur de lecture. Dans une app de police, une plaque inventée déclenche un
contrôle sur un innocent : mieux vaut ne rien remonter qu'un mauvais numéro.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
AR_TO_LATIN = {c: str(i) for i, c in enumerate(ARABIC_DIGITS)}
AR_LETTER_TO_LATIN = {"ج": "D", "ا": "A", "ب": "B", "ت": "C"}

LATIN_RE = re.compile(r"^[0-9ABCDT]+$")


@dataclass(frozen=True)
class Reading:
    """Résultat d'une lecture, avec ce qui a permis de la valider."""

    plate: str | None
    agreed: bool
    reason: str


def split_scripts(raw: str) -> tuple[str, str]:
    """Sépare la sortie du modèle en partie latine et partie arabe."""
    latin = "".join(c for c in raw if c in "0123456789ABCDT")
    arabic = "".join(c for c in raw if c in ARABIC_DIGITS or c in AR_LETTER_TO_LATIN)
    return latin, arabic


def parse_arabic(arabic: str) -> set[str]:
    """
    Interprétations possibles de la partie arabe — il peut y en avoir DEUX.

    L'ordre des groupes varie selon le fabricant, et les deux existent sur le
    terrain (vérifié sur photos) :

      - ordre INVERSÉ, le plus courant : suffixe, lettre, préfixe —
        « 252 D 105 » porte « ١٠٥ ج ٢٥٢ » (six plaques vérifiées) ;
      - ordre DIRECT, identique au latin : « 163 D 69 » porte « ١٦٣ ج ٦٩ » et
        « 3725 C » porte « ٣٧٢٥ ت ». Découvert parce que le modèle lisait ces
        pixels « dans le mauvais ordre »… et que les pixels lui donnaient
        raison contre l'annotation.

    Le lecteur ne peut pas savoir quel fabricant a gravé la plaque : on
    retourne donc les interprétations des deux ordres, et c'est la concordance
    avec le LATIN qui tranche — il est la seule source d'ordre fiable. Si les
    deux ordres concordaient vers des numéros différents, `reconcile` rejette.
    """
    letters = [c for c in arabic if c in AR_LETTER_TO_LATIN]
    if not letters:
        return set()

    # Plusieurs lettres DIFFÉRENTES : on refuse au lieu de retenir la première.
    #
    # Observé sur une vraie plaque : « ٥٦ج٢٣٤ » lu « ب٥٦ج٢٣٤ », un ب halluciné
    # en tête. Prendre la première donnait « 56234B » — un format officiel
    # parfaitement valide, donc indétectable en aval. Si le latin avait été mal
    # lu de façon concordante, la vérification croisée aurait validé une plaque
    # inexistante. C'est précisément ce contre quoi elle existe.
    if len({AR_LETTER_TO_LATIN[c] for c in letters}) > 1:
        return set()

    # « تت » = TT : deux lettres identiques. L'ordre des groupes ne change pas
    # la lecture — les chiffres gardent leur sens de lecture propre, seule la
    # position du bloc تت varie.
    if len(letters) == 2 and letters[0] == "ت" and letters[1] == "ت":
        digits = "".join(AR_TO_LATIN[c] for c in arabic if c in AR_TO_LATIN)
        return {f"{digits}TT"} if digits else set()
    if len(letters) != 1:
        return set()

    letter = AR_LETTER_TO_LATIN[letters[0]]
    i = arabic.index(letters[0])
    left = "".join(AR_TO_LATIN.get(c, "") for c in arabic[:i])
    right = "".join(AR_TO_LATIN.get(c, "") for c in arabic[i + 1:])

    if letter == "D":
        # Privé : chiffres des deux côtés du ج, l'ordre des groupes est inconnu.
        out = set()
        if left and right:
            out.add(f"{right}D{left}")   # inversé : gauche = suffixe
            out.add(f"{left}D{right}")   # direct  : gauche = préfixe
        return out
    # Officiel : le nombre est d'UN seul côté de la lettre. Des chiffres des
    # deux côtés signaleraient une lecture corrompue.
    if right and not left:
        return {f"{right}{letter}"}      # inversé : lettre en tête
    if left and not right:
        return {f"{left}{letter}"}       # direct : lettre en queue
    return set()


def reconcile(raw: str) -> Reading:
    """Confronte les deux lectures et n'accepte que si elles concordent."""
    latin, arabic = split_scripts(raw)

    if not latin:
        return Reading(None, False, "aucun latin lu")
    if not arabic:
        return Reading(None, False, "aucun arabe lu")

    # Les deux graphies portent le même numéro, donc EXACTEMENT autant de
    # caractères l'une que l'autre. Vérifié : sur 51 043 plaques générées
    # l'écart est toujours nul, et il l'est sur les six plaques réelles
    # mesurées (« 234D56 »/« ٥٦ج٢٣٤ », « 3044C »/« ت٣٠٤٤ »…).
    #
    # Ce test attrape ce que le tri par alphabet ne peut pas voir : un glyphe
    # halluciné qui tombe dans la BONNE écriture. Observé sur une vraie plaque,
    # « ٥٦ج٢٣٤ » lu « ب٥٦ج٢٣٤ » — le `ب` est un caractère arabe parfaitement
    # légitime, rien ne le distingue d'un vrai, sauf qu'il porte le total à 7
    # contre 6 côté latin.
    if len(latin) != len(arabic):
        return Reading(None, False,
                       f"compte inégal : {len(latin)} latin vs {len(arabic)} arabe")

    candidats = parse_arabic(arabic)
    if not candidats:
        return Reading(None, False, "arabe illisible ou sans lettre")

    # Chaque interprétation d'ordre est confrontée au latin ; il faut qu'UNE
    # SEULE plaque en ressorte. Sur un palindrome (« 252 D 252 ») les deux
    # ordres donnent le même numéro — ce n'est pas une ambiguïté.
    concordances: dict[str, str] = {}
    for cand in candidats:
        if latin == cand:
            concordances[cand] = "latin et arabe identiques"
        # Cas normal en 7 segments : le latin porte un `0` là où l'arabe dit
        # `D`. L'arabe fait foi, mais seulement si le reste concorde exactement.
        elif latin == cand.replace("D", "0"):
            concordances[cand] = "D reconstruit depuis l'arabe (7 segments)"

    if len(concordances) == 1:
        plate, why = next(iter(concordances.items()))
        return Reading(plate, True, why)
    if len(concordances) > 1:
        return Reading(None, False,
                       f"ambigu : les deux ordres concordent ({'/'.join(sorted(concordances))})")
    return Reading(None, False,
                   f"désaccord : latin={latin} arabe={'/'.join(sorted(candidats))}")


if __name__ == "__main__":
    cases = [
        ("252D105١٠٥ج٢٥٢", "252D105"),   # standard : concordance directe
        ("2520105١٠٥ج٢٥٢", "252D105"),   # 7 segments : D gravé 0, arabe tranche
        ("7240053٥٣ج٧٢٤", None),         # désaccord -> rejet
        ("3044Cت٣٠٤٤", "3044C"),         # officiel, ordre inversé
        ("48009TTتت٤٨٠٠٩", "48009TT"),   # transit
        ("163069", None),                # arabe manquant -> rejet
        # Ordre DIRECT — vérifié sur plaques réelles : « 163 D 69 » porte
        # « ١٦٣ ج ٦٩ » et « 3725 C » porte « ٣٧٢٥ ت ». Le latin arbitre.
        ("163D69١٦٣ج٦٩", "163D69"),
        ("163069١٦٣ج٦٩", "163D69"),      # 7 segments + ordre direct
        ("3725C٣٧٢٥ت", "3725C"),
        # Ordre inversé du même numéro : le latin tranche aussi.
        ("163D69٦٩ج١٦٣", "163D69"),
    ]
    ok = 0
    for raw, expected in cases:
        r = reconcile(raw)
        good = r.plate == expected
        ok += good
        print(f"{'ok   ' if good else 'ECHEC'} {raw!r:26} -> {str(r.plate):9} ({r.reason})")
    print(f"\n{ok}/{len(cases)} cas passent")
