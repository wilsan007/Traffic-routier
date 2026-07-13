"""Vote temporel des lectures de plaque, par véhicule suivi (track ID).

Une plaque est lue à plusieurs reprises pendant qu'un véhicule traverse le
champ de la caméra. Chaque lecture OCR isolée peut se tromper (flou, angle,
reflet), mais l'ensemble des lectures d'un même véhicule converge : on agrège
donc les lectures par track_id et on ne retient le résultat que lorsqu'un
consensus stable se dégage. On émet alors UNE seule capture par véhicule.

Décision d'émission pour un track :
- au moins VOTE_MIN_SAMPLES lectures accumulées,
- la chaîne gagnante représente au moins VOTE_MIN_AGREEMENT des lectures
  (stabilité : évite d'émettre quand l'OCR hésite entre plusieurs plaques),
- sa confiance moyenne dépasse VOTE_MIN_CONFIDENCE.

Le gagnant est la chaîne au plus fort score agrégé (somme des confiances), ce
qui privilégie à la fois la fréquence et la qualité des lectures.
"""
import os
import time
from dataclasses import dataclass, field
from typing import Optional

VOTE_MIN_SAMPLES = int(os.environ.get("PLATE_VOTE_MIN_SAMPLES", "3"))
VOTE_MIN_AGREEMENT = float(os.environ.get("PLATE_VOTE_MIN_AGREEMENT", "0.6"))
VOTE_MIN_CONFIDENCE = float(os.environ.get("STREAM_MIN_CONFIDENCE", "0.5"))
# Confiance plancher pour qu'une lecture entre dans le vote (filtre le bruit).
VOTE_SAMPLE_MIN_CONFIDENCE = float(os.environ.get("PLATE_VOTE_SAMPLE_MIN_CONFIDENCE", "0.3"))
# Durée après laquelle un track non revu est oublié (secondes).
TRACK_TTL = float(os.environ.get("PLATE_VOTE_TRACK_TTL", "30"))


@dataclass
class Winner:
    text: str
    confidence: float  # confiance moyenne de la chaîne gagnante
    agreement: float   # part des lectures en faveur du gagnant (0..1)
    samples: int       # nombre total de lectures pour ce track


@dataclass
class _Track:
    # texte -> [nombre de lectures, somme des confiances]
    votes: dict[str, list] = field(default_factory=dict)
    samples: int = 0
    emitted: bool = False
    last_seen: float = field(default_factory=time.time)


class VoteBook:
    def __init__(self):
        self._tracks: dict[int, _Track] = {}

    def touch(self, track_id: int) -> None:
        """Signale qu'un track est toujours vivant (vu cette frame), même sans
        lecture de plaque exploitable — pour ne pas l'oublier prématurément."""
        track = self._tracks.setdefault(track_id, _Track())
        track.last_seen = time.time()

    def add(self, track_id: int, text: str, confidence: float) -> None:
        """Enregistre une lecture OCR pour un track. Ignore les lectures vides
        ou sous le plancher de confiance."""
        track = self._tracks.setdefault(track_id, _Track())
        track.last_seen = time.time()
        if not text or confidence < VOTE_SAMPLE_MIN_CONFIDENCE:
            return
        counter = track.votes.setdefault(text, [0, 0.0])
        counter[0] += 1
        counter[1] += confidence
        track.samples += 1

    def winner(self, track_id: int) -> Optional[Winner]:
        track = self._tracks.get(track_id)
        if track is None or not track.votes:
            return None
        text, (count, sum_conf) = max(track.votes.items(), key=lambda kv: kv[1][1])
        avg_conf = sum_conf / count if count else 0.0
        agreement = count / track.samples if track.samples else 0.0
        return Winner(text=text, confidence=round(avg_conf, 3), agreement=agreement, samples=track.samples)

    def should_emit(self, track_id: int) -> bool:
        track = self._tracks.get(track_id)
        if track is None or track.emitted:
            return False
        win = self.winner(track_id)
        if win is None:
            return False
        return (
            win.samples >= VOTE_MIN_SAMPLES
            and win.agreement >= VOTE_MIN_AGREEMENT
            and win.confidence >= VOTE_MIN_CONFIDENCE
        )

    def mark_emitted(self, track_id: int) -> None:
        track = self._tracks.get(track_id)
        if track is not None:
            track.emitted = True

    def is_emitted(self, track_id: int) -> bool:
        track = self._tracks.get(track_id)
        return bool(track and track.emitted)

    def prune(self, now: Optional[float] = None) -> int:
        """Oublie les tracks non revus depuis TRACK_TTL. Renvoie le nombre
        supprimé. Borne l'usure mémoire sur un flux de longue durée."""
        now = time.time() if now is None else now
        stale = [tid for tid, t in self._tracks.items() if now - t.last_seen > TRACK_TTL]
        for tid in stale:
            del self._tracks[tid]
        return len(stale)

    def active_count(self) -> int:
        return len(self._tracks)
