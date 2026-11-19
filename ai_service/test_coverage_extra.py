"""Coverage of defensive branches and lazy model/queue startup; no real HF/RabbitMQ."""
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock
import sys
import pytest
from PIL import Image
from fastapi.testclient import TestClient
import main
try:
    import pika
except ImportError:
    sys.modules['pika'] = SimpleNamespace()
import worker


def jpg():
    out = BytesIO()
    Image.new('RGB', (12, 12), 'orange').save(out, 'JPEG')
    return out.getvalue()


def test_models_load_once(monkeypatch):
    called = []
    def pipeline(task, model, device):
        called.append((task, model, device))
        return Mock()
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(pipeline=pipeline))
    monkeypatch.setattr(main, 'classifier', None)
    monkeypatch.setattr(main, 'bird_detector', None)
    assert main.get_classifier() is main.get_classifier()
    assert main.get_bird_detector() is main.get_bird_detector()
    assert called == [
        ('image-classification', main.MODEL_NAME, -1),
        ('zero-shot-image-classification', main.BIRD_MODEL_NAME, -1)
    ]


def test_detect_bird_errors_and_ranking(monkeypatch):
    monkeypatch.setattr(main, 'get_bird_detector', lambda: Mock(return_value=[]))
    with pytest.raises(RuntimeError, match='no result'):
        main.detect_bird(Image.new('RGB', (10, 10)))
    monkeypatch.setattr(main, 'get_bird_detector', lambda: Mock(return_value=[{'label': 'a dog', 'score': .7}]))
    with pytest.raises(RuntimeError, match='missing'):
        main.detect_bird(Image.new('RGB', (10, 10)))
    monkeypatch.setattr(main, 'get_bird_detector', lambda: Mock(return_value=[
        {'label': 'a dog', 'score': .15}, {'label': 'a bird', 'score': .83}
    ]))
    assert main.detect_bird(Image.new('RGB', (10, 10))) == (True, 83.0)


def test_read_photo_more_defensive_cases(monkeypatch):
    with pytest.raises(ValueError, match='Пошкоджене'):
        main.read_photo(b'broken')
    png = BytesIO()
    Image.new('RGB', (3, 3)).save(png, 'GIF')
    with pytest.raises(ValueError, match='JPG'):
        main.read_photo(png.getvalue())
    monkeypatch.setattr(main, 'MAX_PIXELS', 100)
    with pytest.raises(ValueError, match='Занадто великі'):
        main.read_photo(jpg())
    monkeypatch.setattr(main, 'MAX_PIXELS', 25_000_000)
    assert main.read_photo(jpg()).mode == 'RGB'


def test_api_http_validation_and_failures(monkeypatch):
    client = TestClient(main.app)
    assert client.post('/predict', files={'file': ('bird.png', jpg(), 'image/png')}).status_code == 400
    assert client.post('/predict', files={'file': ('bird.jpg', jpg(), 'text/plain')}).status_code == 400
    assert client.post('/predict', files={'file': ('bird.jpg', b'', 'image/jpeg')}).status_code == 400
    assert client.post('/predict', files={'file': ('bird.jpg', b'x' * (main.MAX_FILE_SIZE + 1), 'image/jpeg')}).status_code == 400
    monkeypatch.setattr(main, 'predict_bytes', lambda _data: (_ for _ in ()).throw(ValueError('Invalid image data')))
    response = client.post('/predict', files={'file': ('bird.jpg', jpg(), 'image/jpeg')})
    assert response.status_code == 400
    assert 'Invalid image' in response.json()['detail']
    monkeypatch.setattr(main, 'predict_bytes', lambda _data: {'isBird': False})
    assert client.post('/predict', files={'file': ('bird.jpg', jpg(), 'image/jpeg')}).json()['isBird'] is False


def test_worker_http_failures_and_queue_behavior(monkeypatch):
    image = Mock(status_code=500)
    monkeypatch.setattr(worker.requests, 'get', lambda *a, **kw: image)
    with pytest.raises(RuntimeError):
        image.raise_for_status.side_effect = RuntimeError('503')
        worker.process(10)
    image = Mock(status_code=200, content=b'photo')
    monkeypatch.setattr(worker.requests, 'get', lambda *a, **kw: image)
    monkeypatch.setattr(worker, 'predict_bytes', lambda content: {'predictedSpecies': 'Robin'})
    post = Mock(return_value=Mock())
    post.return_value.raise_for_status.side_effect = RuntimeError('upload failed')
    monkeypatch.setattr(worker.requests, 'post', post)
    with pytest.raises(RuntimeError, match='upload failed'):
        worker.process(13)


def test_worker_main_rejects_missing_key(monkeypatch):
    monkeypatch.setattr(worker, 'WORKER_KEY', '')
    with pytest.raises(RuntimeError, match='INTERNAL_WORKER_KEY'):
        worker.main()


def test_worker_main_sets_queue_and_consumes(monkeypatch):
    monkeypatch.setattr(worker, 'WORKER_KEY', 'secret')
    params = SimpleNamespace(heartbeat=None, blocked_connection_timeout=None)
    channel = Mock()
    channel.start_consuming.side_effect = KeyboardInterrupt()
    connection = Mock()
    connection.channel.return_value = channel
    monkeypatch.setattr(worker.pika, 'URLParameters', lambda url: params, raising=False)
    monkeypatch.setattr(worker.pika, 'BlockingConnection', lambda p: connection, raising=False)
    with pytest.raises(KeyboardInterrupt):
        worker.main()
    assert params.heartbeat == 0
    assert params.blocked_connection_timeout == 300
    channel.queue_declare.assert_called_once_with(queue='bird_jobs', durable=True)
    channel.basic_qos.assert_called_once_with(prefetch_count=1)
    assert channel.basic_consume.call_args.kwargs['on_message_callback'] is worker.on_message


def test_worker_main_retries_connection(monkeypatch):
    monkeypatch.setattr(worker, 'WORKER_KEY', 'secret')
    monkeypatch.setattr(worker.pika, 'URLParameters', lambda url: SimpleNamespace(heartbeat=0, blocked_connection_timeout=0), raising=False)
    def connection(_):
        raise OSError('rabbit offline')
    def stop(_):
        raise KeyboardInterrupt()
    monkeypatch.setattr(worker.pika, 'BlockingConnection', connection, raising=False)
    monkeypatch.setattr(worker.time, 'sleep', stop)
    with pytest.raises(KeyboardInterrupt):
        worker.main()
