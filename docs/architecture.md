# Архитектура

## Слои

### Frontend

- `Vite + React + TypeScript`
- SPA без SSR
- UI слой на `shadcn/ui`
- клиент хранит историю в `localStorage`
- превью исходников в истории сохраняются как data URL, чтобы переживать reload браузера
- frontend работает через cookie-сессию и передает запросы к API только с `credentials: include`

### Backend

- `Yandex Cloud Function`
- HTTP доступ через `Yandex API Gateway`
- backend инкапсулирует работу с `Krea API`
- `KREA_API_TOKEN` никогда не уходит в браузер
- download proxy принимает только безопасные `https` URL и режет локальные/private адреса
- backend хранит пользователей и сессии в `Object Storage`
- login/logout/me живут в том же function entrypoint, что и бизнес API

### Storage

- `Yandex Object Storage`
- хранит статический фронтенд
- хранит `config/styles.json`
- хранит `auth/users.json`
- хранит `auth/sessions/*.json`
- дефолтные preview пресетов вшиты в backend как data URL
- хранит preview-картинки пользовательских стилей

## Потоки данных

### Генерация

1. пользователь загружает локальный файл
2. frontend сохраняет локальное preview как data URL для устойчивой истории
3. frontend отправляет файл в backend
4. backend загружает asset в `Krea`
5. backend создает job генерации
6. frontend поллит статус job
7. по завершении frontend сохраняет result URL в историю

### Авторизация

1. пользователь открывает публичный frontend
2. frontend запрашивает `/auth/me`
3. если сессии нет, показывается login screen
4. `/auth/login` проверяет пользователя и ставит `HttpOnly` cookie
5. `API Gateway` authorizer валидирует cookie на каждом защищенном API маршруте
6. backend получает только уже авторизованные запросы

### Стили

1. frontend запрашивает список стилей
2. backend читает `config/styles.json` из bucket
3. если файла нет, backend инициализирует его дефолтным набором
4. backend автоматически мигрирует старые локальные preview пути в встроенные data URL
5. CRUD по стилям обновляет manifest и preview-файлы в storage

## Важные технические решения

- история хранится локально, потому что это дешевле и проще на старте
- blob URL не используются для persisted history, потому что они умирают после reload
- превью результата используется по URL из `Krea`, а скачивание идет через backend proxy, чтобы обойти CORS
- backend proxy дополнительно ограничен по безопасным remote host'ам, чтобы не превращаться в открытый fetch endpoint
- доступ к API контролируется не ссылкой, а cookie-сессией через `API Gateway function authorizer`
- backend и frontend деплоятся независимо, но из одного GitHub Actions workflow
