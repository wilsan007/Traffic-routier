/**
 * Localisation des plaques dans une image caméra (TensorFlow Lite).
 *
 * Pourquoi cette brique : l'OCR seul lit le texte de l'image ENTIÈRE. De près
 * cela suffit, mais à distance une plaque ne fait que quelques pixels et devient
 * illisible. Un vrai ALPR ne lit jamais toute l'image : il localise la plaque,
 * la recadre, puis ne lit que ce rectangle — agrandi, donc lisible.
 *
 * Le modèle est volontairement traité comme un FICHIER INTERCHANGEABLE derrière
 * cette interface (`frame → PlateBox[]`). Changer de détecteur ne doit coûter
 * qu'un remplacement de fichier et, au pire, un ajustement du décodage.
 *
 * ⚠️ Le modèle actuellement embarqué ne sert qu'à VALIDER LE PIPELINE en local :
 * son dépôt d'origine ne déclare aucune licence, il ne doit donc jamais être
 * distribué. Il sera remplacé par un modèle entraîné par nos soins avant toute
 * mise en production.
 */

/**
 * Caractéristiques du modèle embarqué, relevées à l'exécution sur l'appareil
 * (et confirmées par le `pipeline.config` d'origine) :
 *
 *   architecture : SSD MobileNet V2 FPN-Lite, num_classes = 1 (« LicensePlate »)
 *   entrée       : float32 [1, 320, 320, 3]
 *   sorties      : 4 tenseurs (TFLite_Detection_PostProcess), 10 détections max
 *
 * Ne pas déduire ces valeurs d'une convention : elles varient d'un modèle à
 * l'autre, et un modèle de remplacement devra être réinspecté.
 */
export const MODEL_INPUT_SIZE = 320;

/**
 * Normalisation attendue en entrée : (pixel - 127.5) / 127.5, soit [-1, 1].
 *
 * C'est la convention des modèles SSD MobileNet float de TensorFlow Lite. Elle
 * n'est PAS incluse dans le graphe : le tenseur d'entrée est en float32 brut, à
 * nous de normaliser. Une erreur ici ne provoque aucun plantage — juste zéro
 * détection, ce qui est bien plus difficile à diagnostiquer.
 */
export const INPUT_MEAN = 127.5;
export const INPUT_STD = 127.5;

/** Boîte englobante d'une plaque, en coordonnées normalisées (0..1). */
export interface PlateBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Confiance du détecteur, 0..1. */
  score: number;
}

/**
 * Score minimal pour retenir une détection.
 *
 * Volontairement bas : ce n'est pas ce filtre qui garantit la justesse. Une
 * fausse détection est de toute façon écartée ensuite par la validation du
 * format de plaque, puis par le consensus temporel. Rater une vraie plaque, en
 * revanche, est définitif — on préfère donc laisser passer et filtrer plus loin.
 */
export const MIN_DETECTION_SCORE = 0.4;

/** Nombre maximal de plaques traitées par image (garde-fou CPU). */
export const MAX_PLATES_PER_FRAME = 5;

/**
 * Agrandit une boîte de `ratio` de chaque côté.
 *
 * Le détecteur cadre au plus juste et rogne régulièrement les caractères de
 * bord. Or l'OCR a besoin d'un peu de blanc autour du texte pour segmenter
 * correctement : sans marge, les premiers et derniers caractères se perdent.
 */
export function padBox(box: PlateBox, ratio = 0.12): PlateBox {
  const dx = box.width * ratio;
  const dy = box.height * ratio;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return {
    x,
    y,
    width: Math.min(1 - x, box.width + dx * 2),
    height: Math.min(1 - y, box.height + dy * 2),
    score: box.score,
  };
}

/**
 * Identifie les 4 sorties SSD par leur FORME, et non par leur ordre.
 *
 * L'ordre des tenseurs de sortie ne suit aucune convention fiable : sur ce
 * modèle, les boîtes arrivent en 2e position et le compteur en 3e, là où la
 * documentation les annonce en 1re et 4e. S'appuyer sur l'ordre, c'est décoder
 * des scores comme des boîtes — sans la moindre erreur, juste des résultats
 * absurdes.
 *
 * Les formes, elles, sont sans ambiguïté : les boîtes sont le seul tenseur à 4
 * valeurs par détection, le compteur le seul scalaire. Restent deux tenseurs
 * identiques (classes et scores) : le modèle étant mono-classe, les classes sont
 * toutes à 0, donc le tenseur qui porte des valeurs non nulles est celui des
 * scores.
 */
export function identifySsdOutputs(outputs: ArrayLike<number>[]): {
  boxes: ArrayLike<number>;
  scores: ArrayLike<number>;
  count: number;
} | null {
  'worklet';
  let boxes: ArrayLike<number> | null = null;
  let count: number | null = null;
  const pairs: ArrayLike<number>[] = [];

  for (const t of outputs) {
    if (t.length === 1) count = t[0];
    else if (t.length % 4 === 0 && t.length >= 4 && t.length > 10) boxes = t;
    else pairs.push(t);
  }
  if (!boxes || count === null || pairs.length === 0) return null;

  // Entre classes (toutes à 0) et scores, on garde celui qui porte du signal.
  let scores = pairs[0];
  for (const t of pairs) {
    let max = 0;
    for (let i = 0; i < t.length; i++) if (t[i] > max) max = t[i];
    if (max > 0) {
      scores = t;
      break;
    }
  }

  return { boxes, scores, count };
}

/**
 * Décode la sortie d'un détecteur SSD (API TensorFlow Object Detection).
 *
 * Ces modèles renvoient 4 tenseurs parallèles — boîtes, classes, scores, nombre
 * de détections — où l'indice `i` désigne la même détection dans les trois
 * premiers. Les boîtes arrivent en `[ymin, xmin, ymax, xmax]` normalisé, un
 * ordre inhabituel qu'il faut convertir.
 *
 * Le détecteur est mono-classe (« LicensePlate ») : on ignore donc le tenseur
 * des classes.
 */
export function decodeSsdOutput(
  boxes: ArrayLike<number>,
  scores: ArrayLike<number>,
  count: number,
  minScore = MIN_DETECTION_SCORE,
): PlateBox[] {
  'worklet';
  const out: PlateBox[] = [];
  const n = Math.min(count, scores.length, Math.floor(boxes.length / 4));

  for (let i = 0; i < n; i++) {
    const score = scores[i];
    if (score < minScore) continue;

    const ymin = boxes[i * 4];
    const xmin = boxes[i * 4 + 1];
    const ymax = boxes[i * 4 + 2];
    const xmax = boxes[i * 4 + 3];

    const width = xmax - xmin;
    const height = ymax - ymin;
    if (width <= 0 || height <= 0) continue;

    out.push({ x: xmin, y: ymin, width, height, score });
  }

  // Les plus sûres d'abord : si l'on doit en sacrifier, autant garder les meilleures.
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_PLATES_PER_FRAME);
}
