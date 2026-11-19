# AI Bird Lab — тесты и покрытие

Проект содержит тесты **Python, Solidity, blockchain gateway, React TS и Expo Go**. Старые тесты **ASP.NET Core/xUnit** оставлены отдельно. Все тесты работают с заглушками внешних систем (кроме Solidity: контракт исполняется в **локальном in-memory Hardhat**, без реальных ETH).

## Требования

- Windows + VS Code / PowerShell.
- Docker Desktop, запущенный в режиме Linux containers (для Python).
- Node.js 22+ и npm (для контрактов, React и Expo-тестов).
- Для первого `npm install` нужен доступ к npm Registry.
- **Запускать основной `docker compose up` для unit-тестов не нужно.**

## Все четыре группы одной командой

В корневой папке `X:\AI_Bird_Lab`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_coverage.ps1
```

Скрипт завершится с ошибкой при провале теста либо установленного порога покрытия. Если он остановится, смотрите лог именно того модуля — результат других групп не считается успешно проверенным.

## Запуск модулей отдельно

**Python (AI + RabbitMQ + загрузка тестовых фото)**:

```powershell
docker build -f ai_service/Dockerfile.test -t bird-python-tests .
docker run --rm bird-python-tests
```

Метрики `pytest-cov`: **ветви + строки**. Порог `--cov-fail-under=90`. В отдельной проверке окружения разработки получено **42 PASS; 98% combined line+branch coverage** для `main.py`, `worker.py`, `download_15.py` (16 ноября 2026, Python 3.13). Это не оценка точности моделей на реальных фотографиях.

**Solidity + Node.js gateway**:

```powershell
cd chain
npm install
npm run test:gateway
npm run test:contract
npm run coverage:gateway
npm run coverage:solidity
```

`coverage:gateway` использует `c8` и порог 90% для строк, операторов, функций и ветвей в `server.cjs`.
`coverage:solidity` использует `solidity-coverage` на реальном исполняемом контракте `BirdSubscription.sol`. Отчёт показывает покрытие `statements`, `branches`, `functions`, `lines` (Hardhat/solidity-coverage). Для Solidity 90% — **цель, которую необходимо подтвердить после npm install**, не подтверждённый результат.

**React TS (сайтовый интерфейс)**:

```powershell
cd web
npm install
npm run test:coverage
```

`Vitest + @testing-library/react + @vitest/coverage-v8`. Измеряется `src/App.tsx`, `src/api.ts`, `src/photo.ts`, `src/wallet.ts`. 90% по строкам, ветвям, функциям и операторам. Не включены только файл запуска React (`src/main.tsx`), CSS и конфигурация Vite; никакие функции приложения из исходников не исключены.

**Expo Go (React Native TS)**:

```powershell
cd mobile
npm install
npm run test:coverage
```

`Vitest + @testing-library/react`. Измеряются **и `App.tsx` (экраны, кнопки, состояние)**, и `src/client.ts` (запросы и валидация фото). React Native, Expo ImagePicker и SecureStore подменены в тестовой среде — это unit-тесты поведения, а не проверка реальных разрешений камеры или внешнего вида на телефоне. Порог 90% по четырём метрикам.

## Отчёты

- Python: `coverage/python-coverage.xml` при запуске общего скрипта.
- Gateway: `chain/coverage/` (LCOV и консольный вывод c8).
- Solidity: `chain/coverage/` и/или `chain/coverage.json` (создаёт solidity-coverage).
- React: `web/coverage/index.html`.
- Expo: `mobile/coverage/index.html`.

В `coverage` не включаются `node_modules`, тестовые файлы, автоматические сборочные артефакты. По React и Expo показатели относятся к исходному UI и клиенту, а не только к вспомогательным функциям.

## Что НЕ доказывают 90% покрытия

Покрытие кода **не равно** 90% точности AI-распознавания, безопасности Solidity или успешности сквозной работы с MetaMask/RabbitMQ/MS SQL. Для этих задач дополнительно нужны интеграционные тесты и реальные изображения, включая птиц и изображения без птиц. Локальный контракт не прошёл аудит для оплаты реальной криптовалютой.

**Проверенный здесь результат:** Python: 42 PASS, 98%. Node.js/Hardhat тесты и их реальный процент нельзя проверить в среде подготовки файлов из-за недоступности npm Registry. Пороги настроены, чтобы ты увидел фактическое покрытие после запуска у себя.
