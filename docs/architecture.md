# Архитектура

## Слои

### Frontend

- `Vite + React + TypeScript`
- SPA без SSR
- UI слой на `shadcn/ui`
- клиент хранит историю в `localStorage`

### Backend

- `Yandex Cloud Function`
- HTTP доступ через `Yandex API Gateway`
- backend инкапсулирует работу с `Krea API`
- `KREA_API_TOKEN` никогда не уходит в браузер

### Storage

- `Yandex Object Storage`
- хранит статический фронтенд
- хранит `config/styles.json`
- хранит preview-картинки пользовательских стилей

## Потоки данных

### Генерация

1. пользователь загружает локальный файл
2. frontend отправляет файл в backend
3. backend загружает asset в `Krea`
4. backend создает job генерации
5. frontend поллит статус job
6. по завершении frontend сохраняет result URL в историю

### Обтравка

1. пользователь выбирает уже сгенерированный результат
2. frontend выполняет локальное background removal без вызова generative API
3. объект сохраняется как новый `PNG` с прозрачным фоном
4. результат добавляется как новая генерация в рамках той же сессии

### Стили

1. frontend запрашивает список стилей
2. backend читает `config/styles.json` из bucket
3. если файла нет, backend инициализирует его дефолтным набором
4. CRUD по стилям обновляет manifest и preview-файлы в storage

## Важные технические решения

- история хранится локально, потому что это дешевле и проще на старте
- результат генерации не проксируется через backend, а используется по URL из `Krea`
- обтравка выполняется детерминированно на клиенте, чтобы не менять сам объект
- backend и frontend деплоятся независимо, но из одного GitHub Actions workflow
