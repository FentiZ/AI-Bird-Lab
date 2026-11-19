"""Rabbit worker unit tests: API calls and ack/requeue behavior mocked."""
import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

# Allows running worker logic on the host even without RabbitMQ's pika package.
try:
    import pika
except ImportError:
    sys.modules['pika'] = SimpleNamespace()

import worker


def test_completes_job_after_image_inference():
    image = Mock(status_code=200, content=b'jpeg')
    reply = Mock(status_code=200)
    prediction = {'predictedSpecies': 'Robin', 'confidence': 95, 'top3': []}
    with patch.object(worker.requests, 'get', return_value=image) as get, \
            patch.object(worker.requests, 'post', return_value=reply) as post, \
            patch.object(worker, 'predict_bytes', return_value=prediction):
        worker.process(7)
    assert get.call_args.args[0].endswith('/internal/jobs/7/image')
    assert get.call_args.kwargs['headers'] == worker.HEADERS
    assert post.call_args.args[0].endswith('/internal/jobs/7/complete')
    assert post.call_args.kwargs['json'] == prediction
    reply.raise_for_status.assert_called_once()


def test_deleted_job_does_not_trigger_inference():
    image = Mock(status_code=404)
    with patch.object(worker.requests, 'get', return_value=image), \
            patch.object(worker, 'predict_bytes') as model, \
            patch.object(worker.requests, 'post') as post:
        worker.process(8)
    model.assert_not_called()
    post.assert_not_called()


def test_model_error_is_saved_as_failed_job():
    with patch.object(worker.requests, 'get', return_value=Mock(status_code=200, content=b'jpg')), \
            patch.object(worker, 'predict_bytes', side_effect=RuntimeError('model unavailable')), \
            patch.object(worker.requests, 'post', return_value=Mock(status_code=200)) as post:
        worker.process(9)
    assert post.call_args.args[0].endswith('/internal/jobs/9/fail')
    assert 'check AI worker logs' in post.call_args.kwargs['json']['error']


def test_successful_message_is_acked():
    channel = Mock()
    method = SimpleNamespace(delivery_tag=123)
    with patch.object(worker, 'process') as process:
        worker.on_message(channel, method, None, b'42')
    process.assert_called_once_with(42)
    channel.basic_ack.assert_called_once_with(delivery_tag=123)
    channel.basic_nack.assert_not_called()


def test_invalid_job_id_is_acked_without_retry():
    channel = Mock()
    method = SimpleNamespace(delivery_tag=2)
    with patch.object(worker, 'process') as process:
        worker.on_message(channel, method, None, b'invalid')
    process.assert_not_called()
    channel.basic_ack.assert_called_once_with(delivery_tag=2)


def test_transient_server_failure_requeues_message():
    channel = Mock()
    method = SimpleNamespace(delivery_tag=3)
    with patch.object(worker, 'process', side_effect=ConnectionError('SQL unavailable')), \
            patch.object(worker.time, 'sleep') as sleep:
        worker.on_message(channel, method, None, b'21')
    sleep.assert_called_once_with(5)
    channel.basic_nack.assert_called_once_with(delivery_tag=3, requeue=True)
    channel.basic_ack.assert_not_called()
