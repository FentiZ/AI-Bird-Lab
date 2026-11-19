# AI Bird Lab — unit tests

Усі тести використовують **підроблені відповіді / mocks**: реальні ETH, модель Hugging Face, MS SQL, RabbitMQ і запущений бекенд не потрібні. Тести Solidity виконуються у власній локальній EVM Hardhat (не основній мережі).

## Запуск у VS Code на Windows

Відкрий кореневу папку та термінал PowerShell. Потрібні **Docker Desktop** (Engine running), **Node.js 22+**, `npm` та інтернет під час першого встановлення пакетів.

```powershell
.\run_tests.ps1
```

Якщо PowerShell блокує `.ps1` політикою виконання, відкрий новий термінал і запусти лише для одного процесу:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_tests.ps1
```

## Запуск окремих модулів

**Python AI та RabbitMQ (29 тестів, без завантаження моделей):**

```powershell
docker build -f ai_service/Dockerfile.test -t birdlab-ai-tests .
docker run --rm birdlab-ai-tests
```

**ASP.NET Core (xUnit, без локального SDK та SQL):**

```powershell
docker build -f server.tests/Dockerfile.test -t birdlab-api-tests .
docker run --rm birdlab-api-tests
```

**Solidity + Hardhat + blockchain gateway (node:test):**

```powershell
cd chain
npm install
npm test
cd ..
```

**React TypeScript (Vitest + Testing Library):**

```powershell
cd web
npm install
npm test
cd ..
```

**Expo Go (Vitest; чиста логіка API, фото й помилок):**

```powershell
cd mobile
npm install
npm test
cd ..
```

## Що перевіряється

| Модуль | Перевірки |
| --- | --- |
| `ai_service` | JPEG/PNG, CLIP bird/non-bird, Top-3, confidence, відео/GIF/WebP/PDF, MIME spoofing, пошкоджені файли, модель недоступна, RabbitMQ ACK/NACK, повтор, `failed`, API headers |
| `server` | валідація зображень, результатів AI, HMAC токенів, прострочення, підпис внутрішнього воркера, статистика, CSV, каталог, повідомлення RabbitMQ |
| `chain` | Solidity: ціна, продовження підписки, 30 днів, дозвіл на виведення; gateway: challenge, одноразовий nonce, перевірка підпису, статус, помилки |
| `web` | API + Bearer, HTTP 402, перевірка фото й MIME до відправки, відображення `not_bird`, FormData, MetaMask, сума ETH, показ екранів |
| `mobile` | LAN API, Bearer, FormData, JPG/PNG, відхилення HEIC/відео/WEBP/PDF, 204, 402, 503 |
| `tools` | завантаження картинки, обробка відсутньої URL, конвертація PNG/JPEG, перевірка розміру |

## Важливо

- Docker Compose додатково перевіряється командою `docker compose config --quiet`; **це не unit-тест**, а валідація конфігурації.
- Юніт-тести не підтверджують, що SQL, RPC, RabbitMQ, Docker або Expo Go реально запущені. Після unit-тестів перевір окремо інтеграційний сценарій: MetaMask -> підписка -> фото -> RabbitMQ -> AI -> SQL -> історія.
- Для роботи `docker compose up --build -d` **ніщо додатково запускати не потрібно**. Тестові Dockerfile не змінюють основні сервіси.
- `server.tests` використовує xUnit; база SQL замінена чистими функціями, але SQL-запити не охоплені справжніми інтеграційними тестами.
- Мобільні тести перевіряють логіку запитів і фото, **не симуляцію камери/екранів Expo Go**.
