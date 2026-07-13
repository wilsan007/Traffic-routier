"""Tests du vote temporel des plaques par track (plate_vote.py)."""
import plate_vote as pv
from plate_vote import VoteBook


class TestVoteBook:
    def test_winner_none_without_votes(self):
        book = VoteBook()
        book.touch(1)
        assert book.winner(1) is None
        assert book.should_emit(1) is False

    def test_majority_string_wins(self):
        book = VoteBook()
        for _ in range(3):
            book.add(1, "AB123CD", 0.9)
        book.add(1, "AB123XX", 0.6)  # lecture minoritaire
        win = book.winner(1)
        assert win.text == "AB123CD"
        assert win.samples == 4
        assert 0.7 < win.agreement <= 0.76  # 3/4

    def test_should_emit_requires_min_samples(self, monkeypatch):
        monkeypatch.setattr(pv, "VOTE_MIN_SAMPLES", 3)
        monkeypatch.setattr(pv, "VOTE_MIN_AGREEMENT", 0.6)
        monkeypatch.setattr(pv, "VOTE_MIN_CONFIDENCE", 0.5)
        book = VoteBook()
        book.add(1, "AB123CD", 0.9)
        book.add(1, "AB123CD", 0.9)
        assert book.should_emit(1) is False  # 2 < 3
        book.add(1, "AB123CD", 0.9)
        assert book.should_emit(1) is True

    def test_should_emit_requires_agreement(self, monkeypatch):
        monkeypatch.setattr(pv, "VOTE_MIN_SAMPLES", 3)
        monkeypatch.setattr(pv, "VOTE_MIN_AGREEMENT", 0.7)
        monkeypatch.setattr(pv, "VOTE_MIN_CONFIDENCE", 0.5)
        book = VoteBook()
        # 4 lectures très partagées : pas de consensus.
        book.add(1, "AAA111", 0.9)
        book.add(1, "BBB222", 0.9)
        book.add(1, "CCC333", 0.9)
        book.add(1, "AAA111", 0.9)  # 2/4 = 0.5 < 0.7
        assert book.should_emit(1) is False

    def test_low_confidence_reading_ignored(self, monkeypatch):
        monkeypatch.setattr(pv, "VOTE_SAMPLE_MIN_CONFIDENCE", 0.3)
        book = VoteBook()
        book.add(1, "AB123CD", 0.1)  # sous le plancher
        assert book.winner(1) is None
        assert book._tracks[1].samples == 0

    def test_empty_text_ignored(self):
        book = VoteBook()
        book.add(1, "", 0.9)
        assert book.winner(1) is None

    def test_mark_emitted_blocks_further_emit(self, monkeypatch):
        monkeypatch.setattr(pv, "VOTE_MIN_SAMPLES", 1)
        monkeypatch.setattr(pv, "VOTE_MIN_AGREEMENT", 0.0)
        monkeypatch.setattr(pv, "VOTE_MIN_CONFIDENCE", 0.0)
        book = VoteBook()
        book.add(1, "AB123CD", 0.9)
        assert book.should_emit(1) is True
        book.mark_emitted(1)
        assert book.is_emitted(1) is True
        assert book.should_emit(1) is False

    def test_prune_removes_stale_tracks(self, monkeypatch):
        monkeypatch.setattr(pv, "TRACK_TTL", 30)
        clock = {"t": 1000.0}
        monkeypatch.setattr(pv.time, "time", lambda: clock["t"])
        book = VoteBook()
        book.add(1, "AB123CD", 0.9)
        assert book.active_count() == 1
        clock["t"] += 31  # au-delà du TTL
        removed = book.prune()
        assert removed == 1
        assert book.active_count() == 0

    def test_prune_keeps_recent_tracks(self, monkeypatch):
        monkeypatch.setattr(pv, "TRACK_TTL", 30)
        clock = {"t": 1000.0}
        monkeypatch.setattr(pv.time, "time", lambda: clock["t"])
        book = VoteBook()
        book.add(1, "AB123CD", 0.9)
        clock["t"] += 10
        book.touch(1)  # revu récemment
        clock["t"] += 5
        assert book.prune() == 0
        assert book.active_count() == 1

    def test_tracks_are_independent(self, monkeypatch):
        monkeypatch.setattr(pv, "VOTE_MIN_SAMPLES", 2)
        monkeypatch.setattr(pv, "VOTE_MIN_AGREEMENT", 0.5)
        monkeypatch.setattr(pv, "VOTE_MIN_CONFIDENCE", 0.5)
        book = VoteBook()
        book.add(1, "AAA111", 0.9)
        book.add(2, "BBB222", 0.9)
        book.add(1, "AAA111", 0.9)
        assert book.should_emit(1) is True
        assert book.should_emit(2) is False  # 1 seule lecture
        assert book.winner(1).text == "AAA111"
        assert book.winner(2).text == "BBB222"
