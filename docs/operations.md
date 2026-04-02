# Операции

## Где смотреть

- product behavior: [product.md](/Users/vidmich/Downloads/icons/repo/docs/product.md)
- system design: [architecture.md](/Users/vidmich/Downloads/icons/repo/docs/architecture.md)
- code conventions: [code-style.md](/Users/vidmich/Downloads/icons/repo/docs/code-style.md)
- UI rules: [ui.md](/Users/vidmich/Downloads/icons/repo/docs/ui.md)
- infra and deploy: [deployment.md](/Users/vidmich/Downloads/icons/repo/docs/deployment.md)

## Управление доступом

- bootstrap admin создается автоматически при первом логине из `AUTH_BOOTSTRAP_LOGIN` и `AUTH_BOOTSTRAP_PASSWORD`
- основной root-admin интерфейса: `vidmich`
- только `vidmich` видит `Панель управления` и controls для CRUD по стилям
- менеджеров можно добавлять из UI через `Панель управления` или локально через [scripts/auth-users.mjs](/Users/vidmich/Downloads/icons/repo/scripts/auth-users.mjs)
- каждому пользователю доступно 100 генераций на календарный месяц по UTC-месяцу
- счетчик списывается на каждый `POST /generations`, независимо от скачивания результата

Примеры:

```bash
node scripts/auth-users.mjs list ai-icons-practicum
node scripts/auth-users.mjs upsert ai-icons-practicum manager1 'StrongPassword123!' 'Менеджер 1' manager
node scripts/auth-users.mjs disable ai-icons-practicum manager1
```

## При изменении проекта обновлять

- продуктовый сценарий
- архитектурные допущения
- правила UI, если меняется библиотека или композиция
- деплой, если меняется инфраструктура

## Как ссылаться дальше

При обсуждении проекта использовать ссылки на документы из `docs/`, а не пересказывать договоренности заново.
