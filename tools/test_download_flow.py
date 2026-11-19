"""Downloader network flow tests with temporary dirs and mocked responses."""
import csv
import json
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock
from PIL import Image
import download_15 as dl


def test_download_success_and_failure(monkeypatch, tmp_path, capsys):
    root = tmp_path / 'tools'
    root.mkdir()
    (root.parent / 'server').mkdir()
    (root.parent / 'server' / 'birds.json').write_text(json.dumps([
        {'english_name': 'European Robin', 'source_url': 'https://example.test/robin'},
        {'english_name': 'Barn Owl', 'source_url': 'https://example.test/owl'}
    ]), encoding='utf-8')
    monkeypatch.setattr(dl, 'ROOT', root)
    monkeypatch.setattr(dl, 'DEST', root / 'samples')
    buffer = BytesIO()
    Image.new('RGB', (10, 10), 'red').save(buffer, 'JPEG')
    image = buffer.getvalue()

    class Session:
        def __init__(self):
            self.headers = {}
        def get(self, url, params=None, timeout=0):
            if params:
                if params['titles'] == 'Barn Owl':
                    return Mock(json=lambda: {'query': {'pages': {'2': {}}}})
                return Mock(json=lambda: {'query': {'pages': {'1': {'thumbnail': {'source': 'https://example.test/photo'}}}}})
            return Mock(content=image)

    monkeypatch.setattr(dl.requests, 'Session', Session)
    dl.main()
    out = capsys.readouterr().out
    assert 'OK 01/15' in out
    assert 'ПОМИЛКА 02/15' in out
    assert '1/15 фото' in out
    assert (dl.DEST / '01_European_Robin.jpg').is_file()
    with (dl.DEST / 'sources.csv').open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 1
    assert rows[0]['species'] == 'European Robin'


def test_download_all_success(monkeypatch, tmp_path, capsys):
    (tmp_path / 'server').mkdir()
    (tmp_path / 'tools').mkdir()
    birds = [{'english_name': f'Bird {n}', 'source_url': 'https://source.test'} for n in range(15)]
    (tmp_path / 'server' / 'birds.json').write_text(json.dumps(birds), encoding='utf-8')
    monkeypatch.setattr(dl, 'ROOT', tmp_path / 'tools')
    monkeypatch.setattr(dl, 'DEST', tmp_path / 'samples')
    class Session:
        def __init__(self): self.headers = {}
        def get(self, url, params=None, timeout=0):
            return Mock(content=b'data', json=lambda: {'query': {'pages': {'1': {'thumbnail': {'source': 'https://x'}}}}})
    monkeypatch.setattr(dl.requests, 'Session', Session)
    monkeypatch.setattr(dl, 'save_jpeg', lambda _data, path: path.write_bytes(b'jpeg'))
    dl.main()
    assert len(list(dl.DEST.glob('*.jpg'))) == 15
    assert 'Якщо фото' not in capsys.readouterr().out
