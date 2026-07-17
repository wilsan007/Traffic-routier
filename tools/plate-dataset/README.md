# Jeu de plaques djiboutiennes synthétiques

Génère les données d'entraînement du modèle de reconnaissance embarqué.

```bash
python3 tools/plate-dataset/generate.py \
    --count 20000 --out data/plates \
    --digital-font  <DSEG7Classic-Bold.ttf> \
    --standard-font "/System/Library/Fonts/Supplemental/Arial Bold.ttf" \
    --arabic-font   "/System/Library/Fonts/Supplemental/Baghdad.ttc"
```

La police 7 segments **DSEG** (SIL OFL 1.1, usage commercial libre) se télécharge
sur <https://github.com/keshikan/DSEG/releases>.

## Pourquoi un modèle sur mesure

Ni ML Kit ni PlateRecognizer ne lisent la police 7 segments djiboutienne, alors
qu'elle équipe une part croissante du parc. Mesuré sur appareil, même plaque
isolée, deux polices :

| Police | ML Kit | PlateRecognizer |
|---|---|---|
| standard | `163D69` ✅ | `63d69` (0.89) |
| 7 segments | `7T4053`, `724853`… ❌ | **aucune détection** ❌ |

Les deux échouent sur la même image, dans les mêmes conditions — c'est la
police, pas le cadrage ni la qualité. Aucune solution du marché ne connaît
Djibouti : PlateRecognizer devine « us-ny » ou « id ».

## Ce que le modèle apprend

Le label décrit **les glyphes gravés**, pas le numéro. En 7 segments, le `D` est
un rectangle plein, strictement identique au `0` : « 252 D 105 » se grave
« 252 0 105 ». Entraîner le modèle à sortir un `D` là où l'image montre un `0`
lui apprendrait à deviner.

C'est l'**arabe qui lève l'ambiguïté**, et c'est tout l'intérêt de le lire :

```
252D105  →  label « 252D105١٠٥ج٢٥٢ »       (standard)
252D105  →  label « 2520105١٠٥ج٢٥٢ »       (7 segments : D gravé 0)
                    ▲                ▲
                    glyphes gravés   ج = la lettre D, sans ambiguïté
```

Les deux graphies portant le même numéro, leur concordance après normalisation
offre une **vérification croisée** : en cas de désaccord, on rejette. Dans une
app de police, une plaque inventée déclenche un contrôle sur un innocent — cette
redondance vaut mieux que quelques points de précision sur une lecture unique.

## Ordre de l'arabe

L'arabe est rendu **droite-à-gauche**, donc visuellement **inversé** par rapport
au latin. Vérifié sur trois plaques réelles indépendantes :

| Latin | Arabe (ordre visuel) |
|---|---|
| `252 D 105` | `١٠٥ ج ٢٥٢` — suffixe, lettre, préfixe |
| `724 D 53` | `٥٣ ج ٧٢٤` |
| `3044 C` | `ت ٣٠٤٤` — lettre puis nombre |

## Limites connues

- **7 segments : plaques privées `D` uniquement.** Les lettres des plaques sont
  toutes en majuscules, or `B`, `D` et `T` majuscules sont impossibles à former
  en 7 segments. Faute de photo d'une plaque `A`, `B` ou `TT` gravée ainsi, on
  ignore comment le fabricant les rend — les inventer apprendrait au modèle des
  formes inexistantes. Elles restent donc en police standard.
- **`C` majuscule** est réalisable en 7 segments et observé sur « 3044 C », mais
  DSEG ne le rend qu'en minuscule. L'inclure demande un rendu de segments sur
  mesure.
- Les **dégradations sont bornées** : une plaque illisible assortie d'un label
  certain apprendrait au modèle à inventer un numéro plausible.
