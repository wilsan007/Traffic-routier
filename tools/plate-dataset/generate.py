#!/usr/bin/env python3
"""
Génère un jeu de plaques d'immatriculation djiboutiennes synthétiques, destiné à
entraîner le modèle de reconnaissance de caractères embarqué.

Pourquoi synthétique plutôt que des photos réelles annotées :

  - Les labels sont exacts et gratuits — annoter des milliers de plaques à la
    main coûterait des semaines et introduirait des erreurs.
  - Le domaine est exactement le nôtre : formats djiboutiens, deux polices,
    couleurs réglementaires, disposition bilingue. Des images de chiffres
    « digitaux » glanées sur le web montreraient des calculatrices et des
    réveils — un autre problème.
  - Aucune question de licence sur les données.

Pourquoi un modèle sur mesure est nécessaire (vérifié sur appareil) : ni ML Kit
ni PlateRecognizer ne lisent la police 7 segments djiboutienne, alors qu'elle
équipe une part croissante du parc. Sur la même plaque isolée, ML Kit renvoie
« 7T4053 » / « 724853 » et PlateRecognizer ne détecte rien du tout — tandis que
la version standard du même numéro passe chez les deux. C'est la police, pas le
cadrage ni la qualité d'image.

Le label contient le latin ET l'arabe, dans leur ordre visuel : le modèle lit la
plaque entière en une passe.

C'est délibéré. Les deux graphies portent le même numéro, donc les lire toutes
les deux offre une VÉRIFICATION CROISÉE gratuite : si « 163D69 » et « ١٦٣ج٦٩ »
ne concordent pas après normalisation, la lecture est rejetée. Pour une app de
police, où une plaque inventée déclenche un contrôle sur un innocent, cette
redondance vaut plus que quelques points de précision sur une lecture unique.

Au passage, cela règle le problème qui bloquait l'approche par OCR généraliste :
ML Kit fusionnait latin et arabe en un seul bloc illisible (« 163D6911Tc19 »).
Ici l'arabe n'est plus un parasite à masquer, mais une seconde source de vérité.

Usage :
    python3 tools/plate-dataset/generate.py --count 20000 --out data/plates \
        --digital-font <DSEG7Classic-Bold.ttf> --standard-font <Arial Bold.ttf> \
        --arabic-font <Baghdad.ttc>
"""

from __future__ import annotations

import argparse
import json
import random
import string
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

# --- Format des plaques (voir apps/mobile/lib/djiboutiPlate.ts) ---------------
#
# privé    : 1-3 chiffres · D · 1-3 chiffres   fond noir    ex. 243 D 95
# officiel : 3-5 chiffres · A|B|C              fond noir    ex. 1234 A
# transit  : 3-5 chiffres · TT                 fond rouge   ex. 3090 TT
#
# Les nombres vont de 1 à 999 sans zéro de complément : « 069 » n'existe pas.

BLACK_BG = (18, 18, 18)
RED_BG = (176, 32, 34)
TEXT = (245, 245, 245)

# Les plaques existent dans les DEUX polarités : blanc sur noir, mais aussi noir
# sur blanc — vérifié sur photos (« 669 D 53 » et « 252 D 105 » ont un fond clair,
# « 3044 C » et « 724 D 53 » un fond sombre). N'en générer qu'une revient à ne
# jamais montrer au modèle la moitié du parc : il obtient alors un score parfait
# en validation synthétique et ne lit rien du réel.
LIGHT_BG = (238, 238, 238)
DARK_TEXT = (24, 24, 24)
LIGHT_BG_RATIO = 0.45

# Chiffres arabes (indo-arabes) et lettre de catégorie correspondante.
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
ARABIC_LETTER = {"D": "ج", "A": "ا", "B": "ب", "C": "ت", "TT": "تت"}

#: Alphabet du modèle : chiffres et lettres des deux graphies.
ALPHABET = string.digits + "ABCDT" + ARABIC_DIGITS + "جابت"


@dataclass(frozen=True)
class Plate:
    """Une plaque à rendre.

    `plate` est le numéro véritable (« 252D105 ») ; `arabic` porte le même
    contenu, mais dans l'ordre où il APPARAÎT sur la plaque.
    """

    plate: str
    arabic: str
    background: tuple[int, int, int]

    def latin_glyphs(self, digital: bool) -> str:
        """
        Le latin tel qu'il est GRAVÉ, qui peut différer du numéro véritable.

        En police 7 segments, le `D` est un rectangle plein — strictement
        identique au `0` (vérifié sur photo : « 252 D 105 » se grave « 252 0 105 »).
        Le label doit décrire les pixels, pas le numéro : entraîner le modèle à
        sortir un `D` là où l'image montre un `0` lui apprendrait à deviner.
        C'est l'arabe qui lèvera l'ambiguïté à la lecture.
        """
        return self.plate.replace("D", "0") if digital else self.plate

    def label(self, digital: bool) -> str:
        return self.latin_glyphs(digital) + self.arabic


def supports_digital(plate: Plate) -> bool:
    """
    Cette plaque peut-elle être gravée en police 7 segments ?

    Seules les plaques privées le sont ici, et c'est délibéré. Les lettres des
    plaques sont TOUTES en majuscules, or le 7 segments ne peut pas former les
    majuscules `B`, `D` ni `T` — d'où le `D` gravé en `0`, seule sortie possible
    pour le fabricant (vérifié sur photo).

    Faute de photo d'une plaque `A`, `B` ou `TT` en 7 segments, on ignore
    comment ces lettres y sont rendues. Les générer serait inventer des glyphes :
    le modèle apprendrait des formes inexistantes et se tromperait sur le
    terrain, sans que rien ne le signale à l'entraînement. On les réserve donc à
    la police standard jusqu'à disposer d'images.

    Le `C` majuscule EST réalisable en 7 segments (segments haut, haut-gauche,
    bas-gauche, bas) et observé sur « 3044 C » — mais DSEG ne le rend qu'en
    minuscule. Il faudra un rendu de segments sur mesure pour l'inclure.
    """
    return "D" in plate.plate


def random_plate(rng: random.Random) -> Plate:
    """
    Tire une plaque valide, au hasard parmi les trois familles.

    L'arabe est construit dans son ORDRE VISUEL — celui que le modèle lira de
    gauche à droite (PIL ne réordonne pas le bidirectionnel). Mais cet ordre
    VARIE selon le fabricant, et les deux existent sur photos réelles :

        ordre INVERSÉ (le plus courant — six plaques vérifiées) :
        « 252 D 105 »  ->  ١٠٥ ج ٢٥٢     (suffixe, lettre, préfixe)
        « 3044 C »     ->  ت ٣٠٤٤        (lettre, puis nombre)

        ordre DIRECT, identique au latin (découvert quand le modèle a lu les
        pixels « dans le mauvais ordre »… et que les pixels lui donnaient
        raison contre l'annotation) :
        « 163 D 69 »   ->  ١٦٣ ج ٦٩      (préfixe, lettre, suffixe)
        « 3725 C »     ->  ٣٧٢٥ ت        (nombre, puis lettre)

    Le jeu doit montrer les deux, sinon le modèle apprendrait un ordre unique
    et sortirait des lectures « impossibles » sur l'autre moitié du parc.
    C'est la concordance avec le latin qui tranche à la lecture.
    """
    kind = rng.choices(["prive", "officiel", "transit"], weights=[70, 20, 10])[0]
    direct = rng.random() < 0.35

    if kind == "prive":
        head, tail = rng.randint(1, 999), rng.randint(1, 999)
        gauche, droite = (head, tail) if direct else (tail, head)
        return Plate(f"{head}D{tail}",
                     to_arabic(gauche) + ARABIC_LETTER["D"] + to_arabic(droite),
                     BLACK_BG)

    number = rng.randint(100, 99999)
    if kind == "officiel":
        letter = rng.choice("ABC")
        arabe = (to_arabic(number) + ARABIC_LETTER[letter] if direct
                 else ARABIC_LETTER[letter] + to_arabic(number))
        return Plate(f"{number}{letter}", arabe, BLACK_BG)

    arabe = (to_arabic(number) + ARABIC_LETTER["TT"] if direct
             else ARABIC_LETTER["TT"] + to_arabic(number))
    return Plate(f"{number}TT", arabe, RED_BG)


def to_arabic(n: int) -> str:
    return "".join(ARABIC_DIGITS[int(c)] for c in str(n))


def _fond(red: bool, rng: random.Random) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Tire un couple (fond, encre) parmi les polarités réellement observées."""
    if red:
        return RED_BG, TEXT
    if rng.random() < LIGHT_BG_RATIO:
        return LIGHT_BG, DARK_TEXT
    return BLACK_BG, TEXT


def _text_mask(text: str, font: ImageFont.FreeTypeFont,
               rng: random.Random) -> Image.Image | None:
    """
    Masque d'encre du texte, recadré au pixel près, à chasse variable.

    Les caractères sont posés un par un, avec une avance réduite ou élargie,
    au lieu d'être rendus d'un bloc. Mesuré sur le modèle entraîné sans cela :
    il lit « 5100103 » parfaitement à chasse normale, encore à 80 %, puis
    s'effondre — « 50003 » à 70 %, « 5000 » à 60 %. Or DSEG espace largement
    ses glyphes alors que les vraies plaques 7 segments sont gravées quasi
    jointives (vérifié sur la plaque « 510 D 103 » d'un Range Rover).
    """
    tracking = rng.uniform(0.55, 1.10)
    advances = [font.getlength(c) for c in text]
    if sum(advances) <= 0:
        return None

    pad = int(font.size)
    canvas = Image.new("L", (int(sum(advances) * tracking) + 2 * pad, 4 * pad), 0)
    md = ImageDraw.Draw(canvas)
    x = float(pad)
    for ch, adv in zip(text, advances):
        md.text((x, canvas.height // 2), ch, font=font, fill=255, anchor="lm")
        x += adv * tracking
    bbox = canvas.getbbox()
    return canvas.crop(bbox) if bbox else None


def render_line(text: str, font: ImageFont.FreeTypeFont, red: bool,
                rng: random.Random) -> Image.Image:
    """
    Rend UNE ligne de texte sur un fond de plaque.

    Le modèle lit une ligne à la fois, jamais une plaque entière. Deux raisons :

      - Les plaques existent en deux dispositions — arabe à droite du latin, ou
        empilé dessous (les deux courantes sur photos). Un CRNN comprime la
        hauteur à un pixel pour lire de gauche à droite : sur une plaque empilée,
        chaque colonne mêlerait un chiffre latin et un chiffre arabe superposés.
        Illisible par construction.
      - Une ligne isolée est un problème plus simple et mieux posé : le modèle
        n'a plus à deviner une mise en page, c'est au pipeline de découper.

    Les deux polarités sont générées : les plaques réelles sont blanc sur noir
    OU noir sur blanc (mesuré — « 252 D 105 » a un fond clair, « 3044 C » un fond
    sombre). N'en montrer qu'une donne un modèle parfait en validation
    synthétique et aveugle sur la moitié du parc.
    """
    bg, fg = _fond(red, rng)
    w, h = 640, 128
    img = Image.new("RGB", (w, h), bg)

    # La taille est CALCULÉE pour que le texte remplisse le cadre : à taille de
    # police fixe, le texte ne couvrait que ~55 % de la largeur, collé à gauche,
    # et le modèle apprenait « petits glyphes en haut à gauche », pas à lire.
    # Les DEUX axes sont mis à l'échelle indépendamment via le masque recadré
    # sur l'encre : un facteur commun laissait l'arabe à 71 % de largeur pour
    # 84 % de hauteur (la hampe du `ج` rend la hauteur toujours contraignante),
    # soit des glyphes plus hauts et étroits que le réel (~77/77). Le masque
    # rend aussi le résultat indépendant des métriques de la police.
    target_w = int(w * rng.uniform(0.58, 0.88))
    target_h = int(h * rng.uniform(0.52, 0.86))

    mask = _text_mask(text, font, rng)
    if mask is None:
        ImageDraw.Draw(img).text((10, h // 2), text, font=font, fill=fg, anchor="lm")
        return img
    mask = mask.resize((max(1, target_w), max(1, target_h)), Image.LANCZOS)

    # Position libre dans le cadre : le découpage réel ne tombera jamais au
    # pixel près.
    x = rng.randint(0, max(0, w - target_w))
    y = rng.randint(0, max(0, h - target_h))
    img.paste(Image.new("RGB", mask.size, fg), (x, y), mask)
    return img


def render_full_line(latin_text: str, latin_font: ImageFont.FreeTypeFont,
                     arabic_text: str, arabic_font: ImageFont.FreeTypeFont,
                     red: bool, rng: random.Random) -> Image.Image:
    """
    Rend une plaque RECTANGULAIRE entière : latin puis arabe, côte à côte.

    C'est le format qui a fait échouer quatre méthodes de découpe successives —
    ratio fixe, plus grand blanc vertical, comptage de caractères, comptage
    filtré par largeur : la frontière entre les deux graphies n'est marquée par
    aucun indice d'image fiable (glyphes jointifs, diacritiques détachés,
    cadres emboutis).

    La réponse n'est pas une cinquième heuristique : le modèle apprend à lire
    la ligne ENTIÈRE, et la séparation se fait dans le TEXTE, où elle est
    triviale — les deux alphabets sont disjoints (voir
    crosscheck.split_scripts). La frontière d'image disparaît du problème.

    Les plaques carrées, elles, restent lues ligne à ligne : leur coupe
    horizontale est fiable (mesuré : 8,3 % d'erreur caractère), et un CRNN qui
    comprime la hauteur ne peut de toute façon pas lire deux lignes superposées
    en une passe.
    """
    bg, fg = _fond(red, rng)
    w, h = 640, 128
    img = Image.new("RGB", (w, h), bg)

    ml = _text_mask(latin_text, latin_font, rng)
    ma = _text_mask(arabic_text, arabic_font, rng)
    if ml is None or ma is None:
        return img

    target_h = int(h * rng.uniform(0.52, 0.86))
    total_w = int(w * rng.uniform(0.80, 0.94))
    gap = int(w * rng.uniform(0.02, 0.06))

    # Largeurs au prorata de l'encre de chaque graphie, à hauteur commune :
    # c'est la géométrie des plaques réelles, où les deux blocs partagent la
    # même hauteur mais jamais la même largeur.
    wl = ml.width * (target_h / ml.height) * rng.uniform(0.85, 1.10)
    wa = ma.width * (target_h / ma.height) * rng.uniform(0.85, 1.10)
    s = min(1.0, (total_w - gap) / max(1.0, wl + wa))
    wl, wa = max(1, int(wl * s)), max(1, int(wa * s))

    x = rng.randint(0, max(0, w - (wl + gap + wa)))
    y = rng.randint(0, max(0, h - target_h))
    img.paste(Image.new("RGB", (wl, target_h), fg), (x, y),
              ml.resize((wl, target_h), Image.LANCZOS))
    img.paste(Image.new("RGB", (wa, target_h), fg), (x + wl + gap, y),
              ma.resize((wa, target_h), Image.LANCZOS))

    # Une partie des plaques réelles porte un séparateur vertical gravé entre
    # les deux graphies (observé sur « 892 D 27 » et « 253 D 37 »). Le modèle
    # doit apprendre à ne PAS le lire — le contexte le distingue d'un `1` ou
    # d'un `١` : il est isolé entre les deux blocs, jamais dans une séquence.
    if rng.random() < 0.3:
        bx = x + wl + gap // 2
        ImageDraw.Draw(img).rectangle(
            [bx - 1, y + int(target_h * 0.1), bx + 1, y + int(target_h * 0.9)],
            fill=fg)
    return img


def degrade(img: Image.Image, rng: random.Random) -> Image.Image:
    """
    Applique les dégradations d'une prise de vue réelle.

    Sans elles, le modèle n'apprendrait qu'à lire des plaques parfaites et
    échouerait sur le terrain. Mais leur intensité est bornée volontairement :
    une plaque illisible assortie d'un label certain apprend au modèle à
    INVENTER un numéro plausible — exactement ce qu'il ne faut pas dans une app
    de police. Le jeu doit couvrir un éventail du net au difficile, jamais
    l'illisible.
    """
    w, h = img.size

    # Perspective : la plaque est rarement vue de face.
    #
    # PIL.Image.QUAD attend les coins de la source dans l'ordre haut-gauche,
    # bas-gauche, bas-droite, haut-droite — et non le sens horaire habituel.
    # S'en écarter n'échoue pas : cela écrase silencieusement l'image en bandes.
    if rng.random() < 0.7:
        m = 0.05
        j = lambda v: v * rng.uniform(-m, m)  # noqa: E731
        quad = [
            j(w), j(h),               # haut-gauche
            j(w), h + j(h),           # bas-gauche
            w + j(w), h + j(h),       # bas-droite
            w + j(w), j(h),           # haut-droite
        ]
        img = img.transform((w, h), Image.QUAD, quad, resample=Image.BICUBIC)

    if rng.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.9)))

    # Luminosité et contraste : plein soleil, ombre, contre-jour.
    arr = np.asarray(img).astype(np.float32)
    arr = arr * rng.uniform(0.7, 1.2) + rng.uniform(-18, 18)

    if rng.random() < 0.4:
        arr += np.random.normal(0, rng.uniform(2, 7), arr.shape)

    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    # Une plaque lointaine arrive avec peu de pixels : on simule la perte de
    # définition par un aller-retour en basse résolution.
    if rng.random() < 0.35:
        s = rng.uniform(0.55, 0.9)
        small = img.resize((max(16, int(w * s)), max(8, int(h * s))), Image.BILINEAR)
        img = small.resize((w, h), Image.BILINEAR)

    return img


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--count", type=int, default=20000)
    ap.add_argument("--out", type=Path, required=True)
    # Plusieurs polices par écriture, et non une seule.
    #
    # Mesuré : entraîné sur la seule Arial Bold, le modèle atteint 99 % en
    # validation puis lit « 234D56 » 3 fois sur 10 en Verdana Bold et 0 sur 10
    # en Impact. Il avait appris CETTE forme de « 2 », pas le concept. Comme la
    # validation sort du même générateur — donc de la même police — rien ne le
    # signalait. Les vraies plaques djiboutiennes n'étant dans aucune police
    # système, c'est ce qui les rendait illisibles.
    ap.add_argument("--digital-font", type=Path, required=True, nargs="+")
    ap.add_argument("--standard-font", type=Path, required=True, nargs="+")
    ap.add_argument("--arabic-font", type=Path, default=None, nargs="+")
    ap.add_argument("--digital-ratio", type=float, default=0.5,
                    help="Part de plaques en police 7 segments (part croissante du parc).")
    ap.add_argument("--full-ratio", type=float, default=0.34,
                    help="Part de lignes complètes latin+arabe (format rectangulaire).")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    # `random_plate` construit l'arabe DÉJÀ dans son ordre visuel, en partant du
    # principe que PIL le dessine tel quel. Ce n'est vrai qu'avec le moteur de
    # rendu BASIC : compilé avec Raqm, PIL applique lui-même l'algorithme
    # bidirectionnel et RE-inverse la chaîne. Les images porteraient alors un
    # arabe à l'envers assorti d'un label correct — le modèle apprendrait
    # l'inverse de la réalité, et rien dans les métriques ne le signalerait.
    # On refuse plutôt que de produire un jeu silencieusement faux.
    if features.check("raqm"):
        raise SystemExit(
            "PIL est compilé avec Raqm : il réordonnerait l'arabe déjà mis en "
            "ordre visuel par random_plate(). Voir le commentaire ci-dessus — "
            "il faut passer layout_engine=ImageFont.Layout.BASIC aux polices "
            "avant de générer quoi que ce soit."
        )

    rng = random.Random(args.seed)
    np.random.seed(args.seed)

    images = args.out / "images"
    images.mkdir(parents=True, exist_ok=True)

    digital = [ImageFont.truetype(str(p), 74) for p in args.digital_font]
    standard = [ImageFont.truetype(str(p), 82) for p in args.standard_font]
    # L'arabe est rendu à une taille comparable au latin, et non plus petit.
    # Le CRNN ramène la ligne de 640×128 à 192×48 : tout ce qui est rendu petit
    # perd proportionnellement plus de détail au sous-échantillonnage. Or c'est
    # l'arabe qui tranche l'ambiguïté `D`/`0` — le dégrader revient à priver le
    # modèle de sa seule source de vérité sur les plaques 7 segments.
    arabic = [ImageFont.truetype(str(p), 74) for p in args.arabic_font] if args.arabic_font else None

    labels_path = args.out / "labels.jsonl"
    with labels_path.open("w", encoding="utf-8") as fh:
        for i in range(args.count):
            plate = random_plate(rng)
            is_digital = supports_digital(plate) and rng.random() < args.digital_ratio
            red = plate.background == RED_BG

            # Trois types d'échantillons, calqués sur ce que le pipeline
            # soumettra réellement au modèle :
            #   - ligne latine seule et ligne arabe seule — les deux moitiés
            #     d'une plaque CARRÉE, découpée horizontalement (fiable) ;
            #   - ligne COMPLÈTE latin+arabe — une plaque RECTANGULAIRE
            #     entière, qui se lit en une passe précisément parce que sa
            #     frontière interne est introuvable dans l'image.
            latin_font = rng.choice(digital if is_digital else standard)
            tirage = rng.random() if arabic is not None else 1.0
            if tirage < args.full_ratio:
                latin_glyphs = plate.latin_glyphs(is_digital)
                text, script = latin_glyphs + plate.arabic, "full"
                rendu = render_full_line(latin_glyphs, latin_font,
                                         plate.arabic, rng.choice(arabic), red, rng)
            elif tirage < args.full_ratio + (1 - args.full_ratio) / 2:
                text, script = plate.arabic, "arabic"
                rendu = render_line(text, rng.choice(arabic), red, rng)
            else:
                text, script = plate.latin_glyphs(is_digital), "latin"
                rendu = render_line(text, latin_font, red, rng)

            img = degrade(rendu, rng)

            name = f"{i:06d}.png"
            img.save(images / name)
            fh.write(json.dumps({
                "image": f"images/{name}",
                # Les glyphes de CETTE ligne — ce que le modèle doit sortir.
                "label": text,
                "script": script,
                # Le numéro véritable, que la vérification croisée reconstruira
                # en confrontant les deux lignes. Sert à évaluer le pipeline
                # complet, pas le seul modèle.
                "plate": plate.plate,
                "font": "digital" if is_digital else "standard",
            }, ensure_ascii=False) + "\n")

            if (i + 1) % 2000 == 0:
                print(f"  {i + 1}/{args.count}")

    print(f"OK — {args.count} plaques dans {args.out}")
    print(f"     labels : {labels_path}")


if __name__ == "__main__":
    main()
