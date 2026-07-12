"""Tests pour stream_worker.py (dedup/cooldown + cycle de vie des workers).

Les tests evitent toute vraie connexion video : cv2.VideoCapture et time.sleep
sont mockes pour que le thread de fond boucle et s'arrete quasi instantanement.
"""
import time

import pytest

import stream_worker as sw
from stream_worker import StreamInfo, StreamManager, StreamWorker


@pytest.fixture(autouse=True)
def _tracking_off(monkeypatch):
    """Désactive le suivi (ByteTrack) par défaut dans les tests : évite tout
    chargement/téléchargement réel du modèle YOLO et garde le pipeline simple.
    Les tests du mode suivi injectent explicitement un tracker factice."""
    monkeypatch.setattr(sw, "TRACKING", "off")


# --------------------------------------------------------------------------
# StreamWorker._should_send (dedup / cooldown)
# --------------------------------------------------------------------------

class TestShouldSend:
    def _worker(self):
        info = StreamInfo(id="w1", url="file:///dev/null", camera_id=None)
        return StreamWorker(info)

    def test_first_sighting_is_allowed(self, monkeypatch):
        worker = self._worker()
        monkeypatch.setattr(sw.time, "time", lambda: 1000.0)
        assert worker._should_send("AB123CD") is True

    def test_same_plate_within_cooldown_is_suppressed(self, monkeypatch):
        worker = self._worker()
        clock = {"t": 1000.0}
        monkeypatch.setattr(sw.time, "time", lambda: clock["t"])

        assert worker._should_send("AB123CD") is True
        clock["t"] += sw.PLATE_COOLDOWN / 2
        assert worker._should_send("AB123CD") is False

    def test_same_plate_after_cooldown_is_allowed_again(self, monkeypatch):
        worker = self._worker()
        clock = {"t": 1000.0}
        monkeypatch.setattr(sw.time, "time", lambda: clock["t"])

        assert worker._should_send("AB123CD") is True
        clock["t"] += sw.PLATE_COOLDOWN + 1
        assert worker._should_send("AB123CD") is True

    def test_boundary_exact_cooldown_is_allowed(self, monkeypatch):
        # now - last < COOLDOWN est le test de suppression ; a l'egalite
        # exacte (now - last == COOLDOWN), ce n'est PAS < COOLDOWN donc autorise.
        worker = self._worker()
        clock = {"t": 1000.0}
        monkeypatch.setattr(sw.time, "time", lambda: clock["t"])

        assert worker._should_send("AB123CD") is True
        clock["t"] += sw.PLATE_COOLDOWN
        assert worker._should_send("AB123CD") is True

    def test_different_plates_are_both_allowed(self, monkeypatch):
        worker = self._worker()
        clock = {"t": 1000.0}
        monkeypatch.setattr(sw.time, "time", lambda: clock["t"])

        assert worker._should_send("AB123CD") is True
        assert worker._should_send("XY999ZZ") is True

    def test_different_plate_not_affected_by_others_cooldown(self, monkeypatch):
        worker = self._worker()
        clock = {"t": 1000.0}
        monkeypatch.setattr(sw.time, "time", lambda: clock["t"])

        worker._should_send("AB123CD")
        clock["t"] += 1  # bien dans le cooldown de AB123CD
        assert worker._should_send("AB123CD") is False
        assert worker._should_send("XY999ZZ") is True


# --------------------------------------------------------------------------
# StreamManager start/stop/list
# --------------------------------------------------------------------------

@pytest.fixture
def fast_worker_env(monkeypatch):
    """Empeche toute vraie E/S reseau/video et rend les boucles du thread
    quasi instantanees : VideoCapture jamais "ouvert" et sleep no-op."""

    class FakeCapture:
        def __init__(self, *a, **k):
            pass

        def isOpened(self):
            return False

        def read(self):
            return False, None

        def release(self):
            pass

    monkeypatch.setattr(sw.cv2, "VideoCapture", FakeCapture)
    monkeypatch.setattr(sw.time, "sleep", lambda *_a, **_k: None)
    yield


class TestStreamManagerLifecycle:
    def test_start_creates_running_worker(self, fast_worker_env):
        manager = StreamManager()
        info = manager.start("file:///nonexistent.mp4", camera_id="cam-1")

        assert info.id
        assert info.url == "file:///nonexistent.mp4"
        assert info.camera_id == "cam-1"
        assert info.running is True

        try:
            listed = manager.list()
            assert len(listed) == 1
            assert listed[0].id == info.id
        finally:
            manager.stop(info.id)
            _join_all(manager)

    def test_start_launches_background_daemon_thread(self, fast_worker_env):
        manager = StreamManager()
        info = manager.start("file:///nonexistent.mp4", camera_id=None)
        try:
            worker = manager._workers[info.id]
            assert isinstance(worker, StreamWorker)
            assert worker.daemon is True
            assert worker.is_alive() is True
        finally:
            manager.stop(info.id)
            _join_all(manager)

    def test_stop_marks_worker_not_running_and_removes_from_list(self, fast_worker_env):
        manager = StreamManager()
        info = manager.start("file:///nonexistent.mp4", camera_id=None)
        worker = manager._workers[info.id]

        stopped = manager.stop(info.id)
        assert stopped is True
        assert info.running is False
        assert manager.list() == []

        worker.join(timeout=2)
        assert worker.is_alive() is False

    def test_stop_unknown_stream_returns_false(self):
        manager = StreamManager()
        assert manager.stop("does-not-exist") is False

    def test_list_reflects_multiple_streams(self, fast_worker_env):
        manager = StreamManager()
        info1 = manager.start("file:///a.mp4", camera_id=None)
        info2 = manager.start("file:///b.mp4", camera_id=None)
        try:
            ids = {i.id for i in manager.list()}
            assert ids == {info1.id, info2.id}
        finally:
            manager.stop(info1.id)
            manager.stop(info2.id)
            _join_all(manager)

    def test_stop_is_idempotent(self, fast_worker_env):
        manager = StreamManager()
        info = manager.start("file:///a.mp4", camera_id=None)
        assert manager.stop(info.id) is True
        assert manager.stop(info.id) is False
        _join_all(manager)

    def test_start_raises_when_at_max_capacity(self, fast_worker_env, monkeypatch):
        monkeypatch.setattr(sw, "MAX_CONCURRENT_STREAMS", 2)
        manager = StreamManager()
        info1 = manager.start("file:///a.mp4", camera_id=None)
        info2 = manager.start("file:///b.mp4", camera_id=None)
        try:
            with pytest.raises(ValueError):
                manager.start("file:///c.mp4", camera_id=None)
            assert len(manager.list()) == 2
        finally:
            manager.stop(info1.id)
            manager.stop(info2.id)
            _join_all(manager)


def _join_all(manager, timeout=2):
    """Attend brievement que les threads de fond se terminent, sans jamais
    bloquer indefiniment (threads daemon de toute facon)."""
    for worker in list(manager._workers.values()):
        worker.join(timeout=timeout)


# --------------------------------------------------------------------------
# StreamWorker._process_frame : pipeline mouvement -> vehicule -> plaque
# --------------------------------------------------------------------------

import numpy as np

from motion_detector import MotionRegion
from vehicle_detector import VehicleBox
from plate_detector import DetectionResult


class _Result:
    """DetectionResult minimal pour les mocks."""
    def __init__(self, plate_text, confidence):
        self.plate_text = plate_text
        self.confidence = confidence
        self.bounding_box = None


class TestProcessFramePipeline:
    def _worker(self):
        info = StreamInfo(id="p1", url="file:///x", camera_id="cam-9")
        return StreamWorker(info)

    def _frame(self):
        return np.zeros((240, 320, 3), dtype=np.uint8)

    def test_no_motion_skips_everything(self, monkeypatch):
        worker = self._worker()
        monkeypatch.setattr(worker._motion, "detect", lambda frame: [])
        # Si le pipeline allait plus loin, _read_plate leverait.
        monkeypatch.setattr(
            worker, "_read_plate",
            lambda img: (_ for _ in ()).throw(AssertionError("ne doit pas etre appele")),
        )

        worker._process_frame(self._frame())
        assert worker.info.motion_events == 0
        assert worker.info.vehicles_detected == 0
        assert worker.info.plates_sent == 0

    def test_motion_but_no_vehicle_skips_plate(self, monkeypatch):
        import vehicle_detector
        worker = self._worker()
        region = MotionRegion(0, 0, 30, 90, area_ratio=0.03, fill_ratio=0.7)
        monkeypatch.setattr(worker._motion, "detect", lambda frame: [region])
        monkeypatch.setattr(vehicle_detector, "classify", lambda frame, regions: [])
        sent = []
        monkeypatch.setattr(worker, "_read_plate", lambda img: (_ for _ in ()).throw(AssertionError("ne doit pas lire de plaque")))

        worker._process_frame(self._frame())
        assert worker.info.motion_events == 1
        assert worker.info.vehicles_detected == 0
        assert worker.info.plates_sent == 0

    def test_vehicle_with_plate_is_sent(self, monkeypatch):
        import vehicle_detector
        worker = self._worker()
        region = MotionRegion(40, 50, 120, 80, area_ratio=0.12, fill_ratio=0.8)
        vbox = VehicleBox(40, 50, 120, 80, confidence=0.8, source="heuristic")
        monkeypatch.setattr(worker._motion, "detect", lambda frame: [region])
        monkeypatch.setattr(vehicle_detector, "classify", lambda frame, regions: [vbox])
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("AB123CD", 0.9))
        sent = []
        monkeypatch.setattr(worker, "_send_capture", lambda frame, plate, conf: sent.append((plate, conf)) or True)

        worker._process_frame(self._frame())
        assert worker.info.motion_events == 1
        assert worker.info.vehicles_detected == 1
        assert sent == [("AB123CD", 0.9)]

    def test_low_confidence_plate_not_sent(self, monkeypatch):
        import vehicle_detector
        worker = self._worker()
        region = MotionRegion(40, 50, 120, 80, area_ratio=0.12, fill_ratio=0.8)
        vbox = VehicleBox(40, 50, 120, 80, confidence=0.8, source="heuristic")
        monkeypatch.setattr(worker._motion, "detect", lambda frame: [region])
        monkeypatch.setattr(vehicle_detector, "classify", lambda frame, regions: [vbox])
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("AB123CD", sw.MIN_CONFIDENCE - 0.01))
        sent = []
        monkeypatch.setattr(worker, "_send_capture", lambda *a: sent.append(a) or True)

        worker._process_frame(self._frame())
        assert sent == []

    def test_failed_send_rolls_back_cooldown(self, monkeypatch):
        import vehicle_detector
        worker = self._worker()
        region = MotionRegion(40, 50, 120, 80, area_ratio=0.12, fill_ratio=0.8)
        vbox = VehicleBox(40, 50, 120, 80, confidence=0.8, source="heuristic")
        monkeypatch.setattr(worker._motion, "detect", lambda frame: [region])
        monkeypatch.setattr(vehicle_detector, "classify", lambda frame, regions: [vbox])
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("AB123CD", 0.9))
        # Envoi qui echoue : le cooldown doit etre annule pour reessayer.
        monkeypatch.setattr(worker, "_send_capture", lambda *a: False)

        worker._process_frame(self._frame())
        assert "AB123CD" not in worker._recent_plates

    def test_same_plate_deduplicated_within_cooldown(self, monkeypatch):
        import vehicle_detector
        worker = self._worker()
        region = MotionRegion(40, 50, 120, 80, area_ratio=0.12, fill_ratio=0.8)
        vbox = VehicleBox(40, 50, 120, 80, confidence=0.8, source="heuristic")
        monkeypatch.setattr(worker._motion, "detect", lambda frame: [region])
        monkeypatch.setattr(vehicle_detector, "classify", lambda frame, regions: [vbox])
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("AB123CD", 0.9))
        calls = []
        monkeypatch.setattr(worker, "_send_capture", lambda frame, plate, conf: calls.append(plate) or True)

        worker._process_frame(self._frame())
        worker._process_frame(self._frame())  # meme plaque, dans le cooldown
        assert calls == ["AB123CD"]  # envoyee une seule fois


# --------------------------------------------------------------------------
# StreamWorker._process_frame_tracked : suivi ByteTrack + vote temporel
# --------------------------------------------------------------------------

from vehicle_tracker import TrackedVehicle


class _FakeTracker:
    """Tracker factice : renvoie une séquence prédéfinie de listes de véhicules,
    une par appel update()."""
    available = True

    def __init__(self, frames):
        self._frames = list(frames)
        self._i = 0

    def update(self, frame):
        if self._i < len(self._frames):
            out = self._frames[self._i]
        else:
            out = self._frames[-1] if self._frames else []
        self._i += 1
        return out


def _veh(track_id, conf=0.9):
    return TrackedVehicle(track_id=track_id, x=40, y=50, width=120, height=80,
                          confidence=conf, label="car")


class TestTrackedPipeline:
    def _worker(self):
        info = StreamInfo(id="t1", url="file:///x", camera_id="cam-7")
        w = StreamWorker(info)
        # Le mouvement est toujours "présent" pour laisser passer le pipeline.
        w._motion.detect = lambda frame: [object()]
        return w

    def _frame(self):
        return np.zeros((240, 320, 3), dtype=np.uint8)

    def test_routes_to_tracked_when_tracker_available(self, monkeypatch):
        monkeypatch.setattr(sw, "TRACKING", "auto")
        worker = self._worker()
        tracker = _FakeTracker([[_veh(1)]])
        worker._tracker = tracker
        worker._tracker_built = True
        called = {"tracked": False}
        monkeypatch.setattr(worker, "_process_frame_tracked",
                            lambda frame, tk: called.__setitem__("tracked", True))
        worker._process_frame(self._frame())
        assert called["tracked"] is True

    def test_consensus_emits_once_after_min_samples(self, monkeypatch):
        monkeypatch.setattr(sw, "MIN_CONFIDENCE", 0.5)
        worker = self._worker()
        # Même véhicule (track 1) vu sur plusieurs frames.
        tracker = _FakeTracker([[_veh(1)], [_veh(1)], [_veh(1)], [_veh(1)]])
        # OCR renvoie toujours la même plaque fiable.
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("AB123CD", 0.9))
        sent = []
        monkeypatch.setattr(worker, "_send_capture",
                            lambda frame, plate, conf: sent.append(plate) or True)

        for _ in range(4):
            worker._process_frame_tracked(self._frame(), tracker)

        # VOTE_MIN_SAMPLES=3 par défaut : émis une seule fois malgré 4 lectures.
        assert sent == ["AB123CD"]
        assert worker.info.vehicles_detected == 1  # un seul track distinct

    def test_no_emit_before_min_samples(self, monkeypatch):
        worker = self._worker()
        tracker = _FakeTracker([[_veh(1)], [_veh(1)]])  # 2 lectures seulement
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("AB123CD", 0.9))
        sent = []
        monkeypatch.setattr(worker, "_send_capture", lambda *a: sent.append(a) or True)
        for _ in range(2):
            worker._process_frame_tracked(self._frame(), tracker)
        assert sent == []  # pas encore le quorum

    def test_distinct_tracks_counted_separately(self, monkeypatch):
        worker = self._worker()
        tracker = _FakeTracker([[_veh(1), _veh(2)]])
        monkeypatch.setattr(worker, "_read_plate", lambda img: _Result("", 0.0))
        monkeypatch.setattr(worker, "_send_capture", lambda *a: True)
        worker._process_frame_tracked(self._frame(), tracker)
        assert worker.info.vehicles_detected == 2

    def test_emitted_track_skips_ocr(self, monkeypatch):
        worker = self._worker()
        tracker = _FakeTracker([[_veh(1)]])
        # Marque le track comme déjà émis.
        worker._votes.touch(1)
        worker._votes.mark_emitted(1)
        calls = []
        monkeypatch.setattr(worker, "_read_plate", lambda img: calls.append(1) or _Result("X", 0.9))
        worker._process_frame_tracked(self._frame(), tracker)
        assert calls == []  # OCR non appelé pour un véhicule déjà traité

    def test_no_motion_skips_tracker(self, monkeypatch):
        worker = self._worker()
        worker._motion.detect = lambda frame: []  # rien ne bouge
        tracker = _FakeTracker([[_veh(1)]])
        monkeypatch.setattr(worker, "_read_plate",
                            lambda img: (_ for _ in ()).throw(AssertionError("pas d'OCR")))
        worker._process_frame_tracked(self._frame(), tracker)
        assert worker.info.motion_events == 0
        assert worker.info.vehicles_detected == 0
