"""Actual AI input validation, using model stub (no Hugging Face download)."""
from io import BytesIO
from unittest.mock import Mock
import pytest
from fastapi.testclient import TestClient
from PIL import Image
import main

client = TestClient(main.app)


def picture(format='PNG'):
    data = BytesIO()
    Image.new('RGBA', (14, 14), 'green').save(data, format=format)
    return data.getvalue()


def test_recognizes_png_and_converts_to_rgb(monkeypatch):
    model = Mock(return_value=[
        {'label': '001.Barn_Owl', 'score': 0.66},
        {'label': '002.Robin', 'score': 0.25},
        {'label': '003.Mallard', 'score': 0.09},
    ])
    monkeypatch.setattr(main, 'get_bird_detector', lambda: lambda photo, candidate_labels: [
        {'label': 'a bird', 'score': 0.92}, {'label': 'a cat', 'score': 0.08}
    ])
    monkeypatch.setattr(main, 'get_classifier', lambda: model)
    result = main.predict_bytes(picture())
    assert result['predictedSpecies'] == 'Barn Owl'
    assert result['confidence'] == 66.0
    assert [row['confidence'] for row in result['top3']] == [66.0, 25.0, 9.0]
    assert model.call_args.args[0].mode == 'RGB'


@pytest.mark.parametrize('content', [b'', b'not-an-image', b'x' * (10 * 1024 * 1024 + 1)])
def test_rejects_empty_invalid_and_oversized_input(content):
    with pytest.raises(ValueError):
        main.predict_bytes(content)


def test_rejects_unsupported_name():
    response = client.post('/predict', files={'file': ('file.gif', picture(), 'image/gif')})
    assert response.status_code == 400


def test_model_empty_response_returns_503(monkeypatch):
    monkeypatch.setattr(main, 'get_bird_detector', lambda: lambda photo, candidate_labels: [
        {'label': 'a bird', 'score': 0.92}
    ])
    monkeypatch.setattr(main, 'get_classifier', lambda: Mock(return_value=[]))
    response = client.post('/predict', files={'file': ('file.png', picture(), 'image/png')})
    assert response.status_code == 503
    assert response.json()['detail'] == 'AI unavailable'


def test_cleans_numeric_prefixes_and_underscores():
    assert main.clean_name('002._European_Robin') == 'European Robin'
    assert main.clean_name('  Barn   Owl ') == 'Barn Owl'
