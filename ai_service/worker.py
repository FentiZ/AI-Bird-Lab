"""RabbitMQ consumer: fetch photo by job ID, classify, save via ASP.NET API."""
import os
import time
import requests
import pika
from main import predict_bytes

RABBIT_URL = os.environ.get('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672/')
API = os.environ.get('API_BASE_URL', 'http://127.0.0.1:5080').rstrip('/')
WORKER_KEY = os.environ.get('INTERNAL_WORKER_KEY', '')
HEADERS = {'X-Worker-Key': WORKER_KEY}


def process(job_id):
    image = requests.get(f'{API}/internal/jobs/{job_id}/image', headers=HEADERS, timeout=30)
    if image.status_code == 404:
        return  # The owner deleted the job; nothing left to do.
    image.raise_for_status()
    try:
        result = predict_bytes(image.content)
    except Exception as error:
        print('AI failed:', str(error), flush=True)
        response = requests.post(f'{API}/internal/jobs/{job_id}/fail', headers=HEADERS,
                                 json={'error': 'Model failed; check AI worker logs'}, timeout=30)
        response.raise_for_status()
        return
    response = requests.post(f'{API}/internal/jobs/{job_id}/complete', headers=HEADERS,
                             json=result, timeout=30)
    response.raise_for_status()
    print('Completed job', job_id, result['predictedSpecies'], flush=True)


def on_message(channel, method, properties, body):
    try:
        job_id = int(body.decode('utf-8'))
        process(job_id)
        channel.basic_ack(delivery_tag=method.delivery_tag)
    except ValueError:
        channel.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as error:
        print('Worker retry:', error, flush=True)
        time.sleep(5)
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=True)


def main():
    if not WORKER_KEY:
        raise RuntimeError('INTERNAL_WORKER_KEY is missing')
    while True:
        try:
            # Heartbeat disabled here because CPU inference can run for several minutes.
            settings = pika.URLParameters(RABBIT_URL)
            settings.heartbeat = 0
            settings.blocked_connection_timeout = 300
            connection = pika.BlockingConnection(settings)
            channel = connection.channel()
            channel.queue_declare(queue='bird_jobs', durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue='bird_jobs', on_message_callback=on_message)
            print('AI worker started, waiting for jobs...', flush=True)
            channel.start_consuming()
        except Exception as error:
            print('RabbitMQ unavailable:', error, flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
