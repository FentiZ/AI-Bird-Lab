# AI Bird Lab — Blockchain, RabbitMQ, Docker, Expo Go

Продовження твого **AI Bird Lab**. Мінімальний навчальний варіант: Python + Hugging Face, ASP.NET Core 8, MS SQL Server, RabbitMQ, Solidity (Hardhat), React TypeScript, Expo Go. **Без реальних грошей і без необхідності встановлювати Python/.NET/SQL локально для серверної частини**.

## Що працює

1. Вебкористувач підключає **MetaMask**, підписує одноразове повідомлення, отримує токен входу.
2. Викликає `subscribe()` у контракті Solidity. Вартість: **0.001 тестового ETH**; термін: **30 днів**. Повторна оплата подовжує термін, а не обнуляє його.
3. Сервер **ASP.NET Core перевіряє `isActive(wallet)` в Ethereum** перед прийомом фотографії. Користувач без підписки отримує HTTP `402`.
4. ASP.NET записує фото й статус `queued` у **MS SQL**, публікує в RabbitMQ лише `jobId`.
5. **Python-воркер** бере `jobId`, перевіряє фото за допомогою **CLIP** `openai/clip-vit-base-patch32`: чи справді на ньому є птах. Якщо ні — зберігає статус `not_bird` і пояснення, **не** запускаючи класифікатор видів. Якщо так — викликає модель `dima806/bird_species_image_detection`, записує Top-3 через ASP.NET.
6. Вебсайт і мобільний додаток бачать історію, статус, фото та результат. Є пошук, видалення, каталог 15 видів, статистика, CSV.

**Це навчальний прототип, не платіжний сервіс для mainnet:** контракт не проходив аудит, токени мають базову саморобну схему, немає повноцінного керування користувачами, моніторингу або захисту від зловживань. Не переводь справжні ETH, не використовуй реальні ключі на Hardhat і не публікуй його в інтернеті.

## Схема

```text
                      [ React + TypeScript :5173 ]      [ Expo Go, phone ]
                                     |                       |
                                     +------ HTTP API -------+
                                               |
                                     [ ASP.NET Core :5080 ]
                                       /       |        \
                                      /        |         \
                            [ MS SQL ]   [ RabbitMQ ]   [ Node chain gateway ]
                                               |                 |
                                         [ Python AI ]      [ Hardhat :8545 ]
                                               |                 |
                                        [ Hugging Face ]   [ Solidity subscription ]

MetaMask (browser) ----------------- transaction -------------------^ 
```

- `server/` — основний REST API, SQL, авторизація, RabbitMQ publisher.
- `ai_service/` — Python AI модель + RabbitMQ worker.
- `chain/` — Solidity, локальна Hardhat мережа, розгортання контракту, перевірка підписів.
- `web/` — React TypeScript + MetaMask.
- `mobile/` — React Native TS + Expo Go (запускається **окремо на ПК**, не в Docker).
- `tools/download_15.py` — необов'язкове завантаження 15 прикладів із Wikipedia.

## Перевірка: чи є птах на фото? (оновлено)

Під час завантаження **лише JPG/JPEG/PNG, до 10 МБ**, з коректним вмістом файлу. GIF, WebP, PDF, відео, HEIC й анімовані файли не підтримуються. Розширення, MIME та справжній формат перевіряються на різних рівнях: React/Expo, ASP.NET і Pillow у Python.

Порядок роботи: **вхід → оплата тестової підписки → фото → RabbitMQ → CLIP (птах/не птах) → якщо птах, ViT (Top-3)**. У SQL зберігаються `done`, `not_bird`, `failed` та `queued`; `not_bird` видно у веб- та мобільній історії. Non-bird не враховується у статистиці визначених видів і CSV з визначеними видами.

Встановлення пакетів не змінюється (`requirements.txt` уже містить `transformers`, `torch`, `pillow`). Під час першого AI-аналізу **завантажаться ваги двох моделей**, що потребує більше RAM/часу. Щоб оновити встановлений проєкт, **не замінюй `.env` і не запускай `docker compose down -v`**: після заміни вихідних файлів достатньо `docker compose up --build -d`. Для тесту завантаж `bird.jpg`, `cat.jpg` та `movie.mp4` — відповідно прогноз виду / `not_bird` / відмова до постановки в чергу (залежно від правильності прогнозу CLIP).

## 1. Запуск Docker на Windows

Потрібні **Docker Desktop** (з Linux containers і WSL 2), інтернет для завантаження образів / бібліотек і щонайменше **8 ГБ вільної RAM** (краще більше). SQL Server, Torch та модель можуть використовувати багато пам'яті.

Відкрий PowerShell у корені розпакованого проєкту:

```powershell
Copy-Item .env.example .env
notepad .env
```

У `.env` заміни `MSSQL_SA_PASSWORD`, `RABBITMQ_PASSWORD`, `API_SIGNING_KEY`, `INTERNAL_WORKER_KEY` на свої значення (пароль SQL має виконувати вимоги складності). **`DEPLOY_PRIVATE_KEY` — відкритий ключ стандартного локального тестового акаунта Hardhat, тільки для локального тесту.**

Потім:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f api ai chain-deploy
```

`Ctrl+C` виходить тільки з перегляду логів (контейнери працюють). Перші збірки можуть бути довгими. Модель завантажується з Hugging Face під час **першого** AI-завдання.

**URL-и:**

- Вебсайт: http://localhost:5173
- ASP.NET health: http://localhost:5080/api/health
- Hardhat JSON-RPC: http://127.0.0.1:8545
- RabbitMQ UI: http://localhost:15672 (логін/пароль з `.env`)
- MS SQL: `localhost,14333` (`sa` + пароль з `.env`)

`chain-deploy` має завершитися з кодом 0, після чого створюється адреса контракту в Docker volume (`contract-data`), яку повертає `/api/blockchain`.

### MetaMask + тестова підписка

1. Додай у MetaMask **окрему тестову** мережу (або сайт запропонує додати її): URL `http://127.0.0.1:8545`, Chain ID `31337`, символ `ETH`.
2. Виконай `docker compose logs chain`. Hardhat надрукує **тестові акаунти з тестовими приватними ключами**. Імпортуй в MetaMask **акаунт #1** (не #0, який розгортає контракт). Усі ключі Hardhat **публічні й небезпечні в реальних мережах**.
3. На http://localhost:5173 натисни **Підключити гаманець**. Підпиши повідомлення (це безкоштовно). Не підписуй повідомлень, яких не очікуєш.
4. Натисни **Оплатити 0.001 test ETH**, підтвердь **тестову** транзакцію в MetaMask. Після підтвердження сервер прочитає `isActive` з контракту.
5. Завантаж JPG/PNG; результат з'явиться у вкладці «Історія» (спочатку `queued`, потім `done` для птаха або `not_bird`, якщо птаха не виявлено).

**Оплата виконується лише у вебверсії.** Для Expo Go мобільне застосування вже оплаченої підписки працює через токен із вебверсії; інтеграція WalletConnect для мобільних транзакцій не входить у просту версію.

## 2. Expo Go на телефоні

Встанови **Node.js 22.13+** і Expo Go, який підтримує SDK 58. З папки `mobile`:

```powershell
cd mobile
npm install
npx expo install --fix
npx expo start --lan
```

Скануй QR-код телефоном. ПК і телефон мають бути **в одній Wi-Fi мережі**, без блокування з'єднань VPN / брандмауером.

У вкладці **Підписка** мобільного додатка:

1. Вкажи адресу API **з IP комп'ютера**, не `localhost`: наприклад, `http://192.168.1.50:5080`. Дізнатися IP: `ipconfig` → `IPv4 Address`.
2. На комп'ютері увійди на вебсайті через MetaMask, натисни «Скопіювати токен для Expo Go». **Токен — секрет**: не публікуй його і не відправляй незнайомим.
3. Встав токен у мобільний додаток, натисни «Зберегти та підключитися».
4. Перейди на вкладку **Фото**, обери з галереї JPG/PNG або зроби знімок, натисни «Надіслати на AI».
5. Переглянь готовий результат в **Історії** (кнопка «Оновити»).

Якщо Android/iOS не може під'єднатися до API: перевір `http://<IP_ПК>:5080/api/health` у браузері телефону, дозволь порт **5080** у Windows Firewall тільки для **приватної домашньої мережі**. Expo Go потребує сумісної версії Expo SDK; за проблем із залежностями виконай `npx expo install --fix`. На iOS та Android можуть діяти обмеження щодо HTTP-з'єднань. Для реального розгортання потрібен HTTPS.

## 3. RabbitMQ

Черга `bird_jobs` — **durable**. Повідомлення — лише текст з числовим ID. Python використовує `prefetch=1` і підтверджує повідомлення `ack` **після** запису результату в SQL через ASP.NET API. У разі тимчасової помилки повертає задачу в чергу. При пошкодженому фото/помилці AI у SQL записується `failed`. Фото без птаха отримує окремий статус `not_bird`.

Після падіння воркера незавершені повідомлення будуть доставлені повторно; API завершення має ідемпотентне оновлення статусу. Це навчальний варіант, без DLQ, ліміту повторів і просунутого моніторингу.

## 4. Команди

```powershell
docker compose ps
docker compose logs -f ai
docker compose logs -f rabbitmq
docker compose logs -f api
docker compose down
```

`docker compose down` зупиняє контейнери **зі збереженням** бази SQL і кешу моделі. Через те, що Hardhat — тимчасова локальна мережа, після повного зупинення мережі слід перезібрати її разом з адресою контракту (тестові підписки зникнуть). Щоб повністю скинути також SQL-історію, кеш та контрактні дані:

```powershell
docker compose down -v
docker compose up --build -d
```

**Обережно:** `down -v` видаляє **всі дані SQL**, фотозаписи та кеш завантажених моделей цієї Compose-групи.

### Тест 15 видів

За потреби з кореня проєкту (локальний Python 3.12):

```powershell
py -3.12 -m pip install requests pillow
py -3.12 tools/download_15.py
```

Скрипт зберігає фото в `samples/` та `samples/sources.csv`, якщо Wikipedia дозволить їх отримати. При невдачі додай власні JPG/PNG; фактичні AI-висновки не заготовлені наперед. Вибери усі 15 фото через вебінтерфейс і експортуй `bird_analysis.csv`.

## 5. API

| HTTP | URL | Опис |
|---|---|---|
| GET | `/api/health`, `/api/birds`, `/api/blockchain` | стан, каталог, адреса контракту |
| GET | `/api/auth/challenge` | одноразове повідомлення для MetaMask |
| POST | `/api/auth/verify` | підпис → токен |
| GET | `/api/auth/me` | адреса та **дійсний on-chain статус** |
| POST | `/api/analyze` | JPG/PNG + Bearer → `202 queued` або `402` |
| GET | `/api/analyses` | історія цього гаманця |
| GET | `/api/analyses/{id}/image` | фото (Bearer) |
| DELETE | `/api/analyses/{id}` | видалення свого фото |
| GET | `/api/stats`, `/api/export` | статистика та CSV |

Авторизовані запити потребують `Authorization: Bearer <token>`; ключ для `/internal/jobs/` із `.env` потрібен лише AI-воркеру. Обидва секрети **ніколи не включати у frontend**.

## 6. Тести та реальні обмеження

**Можна перевірити локально:**

```powershell
docker compose exec ai python -m unittest -v test_worker.py
docker compose run --rm chain node --test tests/subscription.test.cjs
```

Також можна перевірити модулі локально без Docker:

```powershell
py -3.12 -m pip install pillow fastapi python-multipart pytest httpx
py -3.12 -m pytest -q ai_service/test_main.py ai_service/test_worker.py
cd chain
npm install
npm test
```

Моделі: [CLIP — попередня перевірка птаха](https://huggingface.co/openai/clip-vit-base-patch32) і [ViT — класифікація виду](https://huggingface.co/dima806/bird_species_image_detection). Для фактичного тесту потрібен інтернет і ресурси для PyTorch. **Оцінка CLIP відносна до обраних категорій, не є каліброваною ймовірністю**, тому можливі хибні позитивні/негативні результати. Перевірка типу файлу не може гарантовано відрізнити реальне фото від якісної ілюстрації в PNG/JPG.

**Важливо:** вихідний код створено і проведено перевірку синтаксису JS/Python та базові модульні тести. Повну збірку Docker/.NET/Expo, транзакцію у браузері та сквозний тест із реальною моделлю в поточному середовищі не виконано — це потрібно перевірити на Windows із Docker Desktop.


## Unit tests (усі модулі)

Додано окремі тести для Python, ASP.NET Core, Solidity/blockchain gateway, React, Expo та завантажувача фото.
Запуск із кореня через PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -File .\run_tests.ps1`.
Всі команди та обмеження: **[TESTS.md](TESTS.md)**. Тестування не витрачає тестові ETH та не потребує працюючої бази SQL.


## Автоматичні тести та coverage (нова версія)

Unit-тести для Python AI/RabbitMQ, Solidity/Hardhat, blockchain gateway, React TS та Expo Go:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_coverage.ps1
```

Деталі і звіти: [TEST_COVERAGE.md](TEST_COVERAGE.md). Python: локально перевірено 42 тести та 98% coverage. Для Node.js/Hardhat результати з'являться після npm install та запуску на вашому комп'ютері.
