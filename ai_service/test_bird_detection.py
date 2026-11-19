"""Photo-only and bird/non-bird gating tests without downloading HF weights."""
from io import BytesIO
from unittest.mock import Mock
import pytest
from PIL import Image
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)


def sample(fmt="JPEG"):
    output = BytesIO()
    Image.new("RGB", (24, 24), "green").save(output, format=fmt)
    return output.getvalue()


def fake_gate(label="a bird", bird_score=0.85):
    others = [{"label": "a dog", "score": 0.75 if label == "a dog" else 0.10}]
    values = [{"label": "a bird", "score": bird_score}] + others
    return lambda image, candidate_labels: values


def test_bird_image_calls_species_model(monkeypatch):
    species = Mock(return_value=[{"label": "Robin", "score": 0.92},
                                 {"label": "Owl", "score": 0.06},
                                 {"label": "Mallard", "score": 0.02}])
    monkeypatch.setattr(main, "get_bird_detector", lambda: fake_gate())
    monkeypatch.setattr(main, "get_classifier", lambda: species)
    output = main.predict_bytes(sample())
    assert output["isBird"] is True
    assert output["birdConfidence"] == 85.0
    assert len(output["top3"]) == 3
    species.assert_called_once()


def test_no_bird_skips_species_model(monkeypatch):
    species = Mock()
    monkeypatch.setattr(main, "get_bird_detector", lambda: fake_gate("a dog", 0.12))
    monkeypatch.setattr(main, "get_classifier", lambda: species)
    output = main.predict_bytes(sample())
    assert output["isBird"] is False
    assert output["predictedSpecies"] == ""
    assert output["top3"] == []
    assert "не виявлено птаха" in output["message"]
    species.assert_not_called()


def test_uncertain_detection_skips_species_model(monkeypatch):
    species = Mock()
    monkeypatch.setattr(main, "get_bird_detector", lambda: fake_gate(bird_score=0.28))
    monkeypatch.setattr(main, "get_classifier", lambda: species)
    assert main.predict_bytes(sample())["isBird"] is False
    species.assert_not_called()


@pytest.mark.parametrize("filename,mime", [
    ("video.mp4", "video/mp4"), ("animated.gif", "image/gif"),
    ("document.pdf", "application/pdf"), ("note.txt", "text/plain")
])
def test_rejects_other_upload_formats(filename, mime):
    assert client.post("/predict", files={"file": (filename, sample(), mime)}).status_code == 400


def test_rejects_webp_even_if_named_jpg(monkeypatch):
    detector = Mock()
    monkeypatch.setattr(main, "get_bird_detector", lambda: detector)
    response = client.post("/predict", files={"file": ("bird.JPG", sample("WEBP"), "image/jpeg")})
    assert response.status_code == 400
    detector.assert_not_called()


def test_rejects_png_animation():
    f = BytesIO()
    pictures = [Image.new("RGB", (12, 12), color) for color in ("red", "blue")]
    pictures[0].save(f, format="PNG", save_all=True, append_images=pictures[1:], duration=100, loop=0)
    with pytest.raises(ValueError, match="Анімовані"):
        main.read_photo(f.getvalue())


def test_rejects_extension_or_declared_mime_mismatch():
    response = client.post("/predict", files={"file": ("fake.jpg", sample("PNG"), "image/jpeg")})
    assert response.status_code == 400
    response = client.post("/predict", files={"file": ("fake.png", sample("PNG"), "image/jpeg")})
    assert response.status_code == 400
