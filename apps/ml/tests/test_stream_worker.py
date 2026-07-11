"""Tests pour stream_worker.py (dedup/cooldown + cycle de vie des workers).

Les tests evitent toute vraie connexion video : cv2.VideoCapture et time.sleep
sont mockes pour que le thread de fond boucle et s'arrete quasi instantanement.
"""
import time

import pytest

import stream_worker as sw
from stream_worker import StreamInfo, StreamManager, StreamWorker


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
