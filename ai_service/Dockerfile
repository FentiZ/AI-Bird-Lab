FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py worker.py test_main.py test_worker.py ./
CMD ["python", "-u", "worker.py"]
