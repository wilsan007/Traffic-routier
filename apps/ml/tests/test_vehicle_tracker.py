"""Tests du wrapper de suivi ByteTrack (vehicle_tracker.py).

On n'exécute pas ultralytics ici : on injecte un modèle factice exposant la
même interface que YOLO.track() (results[i].boxes.id/.xyxy/.conf/.cls) pour
valider le parsing et le filtrage par classe véhicule, plus le repli gracieux.
"""
import numpy as np
import pytest

from vehicle_tracker import TrackedVehicle, VehicleTracker


class _Arr:
    """Imite un tenseur torch minimal : .int().tolist() et .tolist()."""
    def __init__(self, data):
        self._data = data

    def int(self):
        return _Arr([int(v) for v in self._data])

    def tolist(self):
        return self._data


class _Boxes:
    def __init__(self, ids, xyxy, conf, cls):
        self.id = _Arr(ids) if ids is not None else None
        self.xyxy = _Arr(xyxy)
        self.conf = _Arr(conf)
        self.cls = _Arr(cls)


class _Result:
    def __init__(self, boxes, names):
        self.boxes = boxes
        self.names = names


class _FakeModel:
    """Modèle factice : renvoie des résultats prédéfinis à chaque track()."""
    COCO = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck", 0: "person"}

    def __init__(self, result):
        self._result = result
        self.calls = []

    def track(self, frame, **kwargs):
        self.calls.append(kwargs)
        return [self._result]


def _frame():
    return np.zeros((240, 320, 3), dtype=np.uint8)


class TestUpdateParsing:
    def test_parses_and_filters_vehicles(self):
        boxes = _Boxes(
            ids=[1, 2, 3],
            xyxy=[[10, 20, 110, 100], [0, 0, 50, 60], [200, 10, 260, 90]],
            conf=[0.9, 0.8, 0.7],
            cls=[2, 0, 7],  # car, person, truck
        )
        model = _FakeModel(_Result(boxes, _FakeModel.COCO))
        tracker = VehicleTracker(model=model)

        vehicles = tracker.update(_frame())
        # La personne (classe 0) est écartée ; voiture et camion gardés.
        assert [v.track_id for v in vehicles] == [1, 3]
        assert all(isinstance(v, TrackedVehicle) for v in vehicles)
        car = vehicles[0]
        assert (car.x, car.y, car.width, car.height) == (10, 20, 100, 80)
        assert car.label == "car"

    def test_track_kwargs_enable_persistence(self):
        boxes = _Boxes([1], [[0, 0, 10, 10]], [0.9], [2])
        model = _FakeModel(_Result(boxes, _FakeModel.COCO))
        VehicleTracker(model=model).update(_frame())
        assert model.calls[0]["persist"] is True
        assert "tracker" in model.calls[0]

    def test_no_detection_when_id_none(self):
        # boxes.id None => aucun objet suivi (0 détection).
        boxes = _Boxes(None, [], [], [])
        model = _FakeModel(_Result(boxes, _FakeModel.COCO))
        assert VehicleTracker(model=model).update(_frame()) == []


class TestAvailabilityAndFallback:
    def test_unavailable_when_no_model(self):
        tracker = VehicleTracker(model=None)
        assert tracker.available is False
        assert tracker.update(_frame()) == []

    def test_available_with_model(self):
        boxes = _Boxes([1], [[0, 0, 10, 10]], [0.9], [2])
        tracker = VehicleTracker(model=_FakeModel(_Result(boxes, _FakeModel.COCO)))
        assert tracker.available is True

    def test_update_swallows_errors(self):
        class _Boom:
            def track(self, frame, **kwargs):
                raise RuntimeError("inference failed")

        tracker = VehicleTracker(model=_Boom())
        assert tracker.update(_frame()) == []
        assert tracker.last_error is not None
