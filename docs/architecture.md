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
- дефолтные preview пресетов вшиты в backend как data URL
- хранит preview-картинки пользовательских стилей

## Потоки данных

### Генерация

1. пользователь загружает локальный файл
2. frontend отправляет файл в backend
3. backend загружает asset в `Krea`
4. backend создает job генерации
5. frontend поллит статус job
6. по завершении frontend сохраняет result URL в историю

### Стили

1. frontend запрашивает список стилей
2. backend читает `config/styles.json` из bucket
3. если файла нет, backend инициализирует его дефолтным набором
4. backend автоматически мигрирует старые локальные preview пути в встроенные data URL
5. CRUD по стилям обновляет manifest и preview-файлы в storage

## Важные технические решения

- история хранится локально, потому что это дешевле и проще на старте
- превью результата используется по URL из `Krea`, а скачивание идет через backend proxy, чтобы обойти CORS
- backend и frontend деплоятся независимо, но из одного GitHub Actions workflow
