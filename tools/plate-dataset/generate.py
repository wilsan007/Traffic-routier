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

    L'arabe est construit dans son ORDRE VISUEL, c'est-à-dire inversé par rapport
    au latin — le rendu droite-à-gauche fait apparaître le suffixe en premier.
    Vérifié sur trois plaques réelles indépendantes :

        « 252 D 105 »  ->  ١٠٥ ج ٢٥٢     (suffixe, lettre, préfixe)
        « 724 D 53 »   ->  ٥٣ ج ٧٢٤
        « 3044 C »     ->  ت ٣٠٤٤        (lettre, puis nombre)

    PIL ne réordonne pas le bidirectionnel : on lui donne donc directement
    l'ordre visuel, qui est aussi celui que le modèle lira de gauche à droite.
    """
    kind = rng.choices(["prive", "officiel", "transit"], weights=[70, 20, 10])[0]

    if kind == "prive":
        head, tail = rng.randint(1, 999), rng.randint(1, 999)
        return Plate(f"{head}D{tail}",
                     to_arabic(tail) + ARABIC_LETTER["D"] + to_arabic(head),
                     BLACK_BG)

    number = rng.randint(100, 99999)
    if kind == "officiel":
        letter = rng.choice("ABC")
        return Plate(f"{number}{letter}",
                     ARABIC_LETTER[letter] + to_arabic(number),
                     BLACK_BG)

    return Plate(f"{number}TT",
                 ARABIC_LETTER["TT"] + to_arabic(number),
                 RED_BG)


def to_arabic(n: int) -> str:
    return "".join(ARABIC_DIGITS[int(c)] for c in str(n))


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
    if red:
        bg, fg = RED_BG, TEXT
    elif rng.random() < LIGHT_BG_RATIO:
        bg, fg = LIGHT_BG, DARK_TEXT
    else:
        bg, fg = BLACK_BG, TEXT

    w, h = 640, 128
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)

    # La taille de police est CALCULÉE pour que le texte remplisse le cadre, et
    # non fixée à l'avance. Mesuré : à taille fixe, le texte ne couvrait que
    # ~55 % de la largeur et ~45 % de la hauteur, collé à gauche, le reste vide
    # — alors qu'un recadrage réel est rempli à ~100 % × ~90 %. Le modèle
    # atteignait 99,9 % en validation et lisait 0/4 vraies plaques : il avait
    # appris « petits glyphes en haut à gauche », pas à lire.
    #
    # Ajuster à la boîte réelle du texte règle du même coup la disparité entre
    # polices : Baghdad rend des glyphes bien plus petits qu'Arial à taille
    # nominale égale, l'arabe se retrouvait deux fois moins haut que le latin.
    # En partant de la boîte mesurée, la police utilisée n'importe plus.
    # Plage centrée sur ce que valent les vrais recadrages (~77 % dans les deux
    # axes, mesuré), et assez large pour couvrir un découpage plus lâche comme
    # plus serré : c'est le pipeline qui recadre, et il ne sera jamais régulier.
    target_w = int(w * rng.uniform(0.58, 0.88))
    target_h = int(h * rng.uniform(0.52, 0.86))

    # Chasse variable : les caractères sont posés un par un, avec une avance
    # réduite ou élargie, au lieu d'être rendus d'un bloc.
    #
    # Mesuré sur le modèle entraîné sans cela : il lit « 5100103 » parfaitement
    # à chasse normale, encore à 80 %, puis s'effondre — « 50003 » à 70 %,
    # « 5000 » à 60 %. Or DSEG espace largement ses glyphes alors que les vraies
    # plaques 7 segments sont gravées quasi jointives (vérifié sur la plaque
    # « 510 D 103 » d'un Range Rover). Le modèle n'avait donc jamais vu de
    # caractères serrés, et fusionnait ceux du réel.
    tracking = rng.uniform(0.55, 1.10)
    advances = [font.getlength(c) for c in text]

    if sum(advances) > 0:
        pad = int(font.size)
        canvas_w = int(sum(advances) * tracking) + 2 * pad
        canvas_h = 4 * pad
        mask = Image.new("L", (canvas_w, canvas_h), 0)
        md = ImageDraw.Draw(mask)
        x = float(pad)
        for ch, adv in zip(text, advances):
            md.text((x, canvas_h // 2), ch, font=font, fill=255, anchor="lm")
            x += adv * tracking
        # Le masque est recadré sur l'encre puis redimensionné sur les DEUX axes
        # indépendamment. Un facteur d'échelle commun couplerait largeur et
        # hauteur : la dimension contraignante fixerait l'autre, qui
        # sous-remplirait. Mesuré sur 3 000 images, l'arabe remplissait alors
        # 71 % de la largeur pour 84 % de la hauteur, contre 85/84 pour le latin
        # — la hampe descendante du `ج` rend la hauteur toujours contraignante.
        # Les glyphes arabes sortaient plus hauts et plus étroits que sur les
        # vraies plaques (~77/77), et le modèle échouait sur l'arabe réel alors
        # qu'il lisait le latin.
        #
        # Passer par un masque rend en outre le résultat indépendant de la
        # police : ce qui est ajusté est l'encre effectivement dessinée, pas une
        # métrique typographique qui varie d'une fonte à l'autre.
        bbox = mask.getbbox()
        if bbox is None:
            d.text((10, h // 2), text, font=font, fill=fg, anchor="lm")
            return img
        mask = mask.crop(bbox).resize((max(1, target_w), max(1, target_h)), Image.LANCZOS)

        # Position libre dans le cadre : le découpage réel ne tombera jamais au
        # pixel près.
        x = rng.randint(0, max(0, w - target_w))
        y = rng.randint(0, max(0, h - target_h))
        img.paste(Image.new("RGB", mask.size, fg), (x, y), mask)
    else:
        d.text((10, h // 2), text, font=font, fill=fg, anchor="lm")
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

            # Une image sur deux montre la ligne latine, l'autre la ligne arabe :
            # le modèle doit savoir lire les deux, puisque le pipeline lui
            # soumettra chaque ligne séparément.
            if arabic is not None and rng.random() < 0.5:
                text, script = plate.arabic, "arabic"
                font = rng.choice(arabic)
            else:
                text, script = plate.latin_glyphs(is_digital), "latin"
                font = rng.choice(digital if is_digital else standard)

            img = degrade(render_line(text, font, red, rng), rng)

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
