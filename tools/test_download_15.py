"""Tests for image helper: no Wikipedia access required."""
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from PIL import Image
from download_15 import get_thumbnail, save_jpeg


def test_get_thumbnail():
    assert get_thumbnail({'1': {'thumbnail': {'source': 'https://example.test/bird.jpg'}}}) == 'https://example.test/bird.jpg'
    with pytest.raises(ValueError):
        get_thumbnail({'1': {}})


def test_save_jpeg_converts_png_to_rgb():
    buffer = BytesIO()
    Image.new('RGBA', (15, 15), 'blue').save(buffer, format='PNG')
    with TemporaryDirectory() as folder:
        path = Path(folder) / 'bird.jpg'
        save_jpeg(buffer.getvalue(), path)
        with Image.open(path) as image:
            assert image.format == 'JPEG'
            assert image.mode == 'RGB'


def test_save_jpeg_rejects_huge_files():
    with TemporaryDirectory() as folder:
        with pytest.raises(ValueError):
            save_jpeg(b'x' * (10 * 1024 * 1024 + 1), Path(folder) / 'bird.jpg')
