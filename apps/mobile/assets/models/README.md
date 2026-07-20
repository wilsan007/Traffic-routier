# Modèle de détection de plaques

Le fichier `plate-detector.tflite` **n'est pas versionné** : il faut le récupérer
manuellement avant de lancer l'application.

```bash
curl -L -o apps/mobile/assets/models/plate-detector.tflite \
  https://raw.githubusercontent.com/Arijit1080/Licence-Plate-Detection-using-TensorFlow-Lite/main/detect.tflite
```

## ⚠️ Statut : validation uniquement, pas de production

Ce modèle provient d'un dépôt **ne déclarant aucune licence** — donc « tous droits
réservés » par défaut. Il sert **exclusivement à éprouver le pipeline en local**
(détection → recadrage → OCR → validation du format djiboutien) et **ne doit
jamais être distribué** : ni APK livré à un tiers, ni build EAS partagé, ni
déploiement.

Il doit être remplacé par un modèle entraîné par nos soins avant toute mise en
production. Le plan retenu :

- **architecture** : YOLOX-Nano (Megvii) ou RT-DETR (PaddleDetection) — les
  deux en licence **Apache 2.0**, usage commercial libre, aucune obligation de
  publication. Le critère non négociable est la licence : YOLOv8 (AGPL-3.0)
  reste écarté, une app de police ne peut pas publier son code ;
- **données** : datasets de plaques US/EU en **CC BY 4.0** — les plaques
  djiboutiennes suivent le standard européen depuis 2023 (520 × 110 mm,
  FE-Schrift, noir sur blanc), le transfert devrait donc être direct ;
- **affinage** : à partir de photos de vraies plaques djiboutiennes, si la
  précision du modèle générique s'avère insuffisante.

Une fois ce modèle propre disponible, il sera versionné et l'exclusion
correspondante retirée du `.gitignore` à la racine.

## Caractéristiques du modèle actuel

Relevées à l'exécution sur l'appareil, et confirmées par le `pipeline.config`
d'origine :

| | |
|---|---|
| Architecture | SSD MobileNet V2 FPN-Lite |
| Classes | 1 (`LicensePlate`) |
| Entrée | `float32 [1, 320, 320, 3]`, normalisée `(pixel - 127.5) / 127.5` |
| Sorties | 4 tenseurs (`TFLite_Detection_PostProcess`), 10 détections max |

⚠️ **L'ordre des tenseurs de sortie ne suit pas la convention documentée** : les
boîtes arrivent en 2ᵉ position et le compteur en 3ᵉ. Le code les identifie par
leur *forme*, jamais par leur ordre — voir `lib/plateDetector.ts`. Tout modèle de
remplacement devra être réinspecté de la même manière.
