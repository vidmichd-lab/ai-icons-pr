# Деплой

## Production окружение

- bucket: `ai-icons-practicum`
- function: `ai-icons-api`
- API gateway: `ai-icons-api-gateway`
- API Gateway: `https://d5dmcsqng37bo4fjsrks.akta928u.apigw.yandexcloud.net`
- production frontend: `https://ai-icons-practicum.website.yandexcloud.net/`
- storage public base URL for backend assets: `https://storage.yandexcloud.net/ai-icons-practicum`

## Что деплоится

- frontend bundle в `Object Storage`
- backend function version в `Yandex Cloud Functions`
- gateway spec с proxy routes и CORS под cookie-сессии

## GitHub Actions

Workflow:

- [.github/workflows/deploy.yml](/Users/vidmich/Downloads/icons/repo/.github/workflows/deploy.yml)

## Обязательные GitHub secrets

- `AUTH_BOOTSTRAP_PASSWORD`
- `KREA_API_TOKEN`
- `YC_SERVICE_ACCOUNT_KEY_JSON`
- `YC_STORAGE_ACCESS_KEY`
- `YC_STORAGE_SECRET_KEY`

## Обязательные GitHub variables

- `APP_ORIGIN`
- `AUTH_BOOTSTRAP_LOGIN`
- `AUTH_SESSION_COOKIE`
- `YC_BUCKET_NAME`
- `YC_CLOUD_ID`
- `YC_FOLDER_ID`
- `YC_API_GATEWAY_NAME`
- `YC_FUNCTION_NAME`
- `YC_API_GATEWAY_URL`
- `YC_STORAGE_PUBLIC_BASE_URL`

## Локальная сборка

```bash
npm install
npm --prefix functions/api install
npm run build:all
```
