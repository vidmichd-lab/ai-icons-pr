# AI Icons Studio

Private web tool for turning flat icon source images into styled renders through Krea API.

## Stack

- `Vite + React + TypeScript` frontend
- `Yandex Cloud Functions` backend
- `Yandex Object Storage` for static hosting and style preview assets
- `GitHub Actions` for deployment

## Core flows

- Upload up to 10 source images with drag-and-drop.
- Choose a preset style from editable preview cards.
- Generate one image per source with Krea `SeedEdit`.
- Reroll any session with a fresh seed.
- Remove background from the selected result through Krea `gpt-image`.
- Download a single PNG or a ZIP pack if a session has multiple outputs.
- Keep generation history in browser storage with manual clearing.

## Local development

1. Install frontend dependencies:

```bash
npm install
```

2. Install backend dependencies:

```bash
npm --prefix functions/api install
```

3. Run frontend:

```bash
VITE_API_BASE_URL=https://your-api-gateway-url npm run dev
```

4. Build everything:

```bash
npm run build:all
```

## Production deployment

GitHub Actions deploys:

- backend function version to `ai-icons-api`
- static frontend bundle to Object Storage bucket `ai-icons-pr-vidmichd-lab`

Required GitHub secrets:

- `KREA_API_TOKEN`
- `YC_SERVICE_ACCOUNT_KEY_JSON`
- `YC_STORAGE_ACCESS_KEY`
- `YC_STORAGE_SECRET_KEY`

Required GitHub variables:

- `YC_BUCKET_NAME`
- `YC_CLOUD_ID`
- `YC_FOLDER_ID`
- `YC_FUNCTION_NAME`
- `YC_API_GATEWAY_URL`
- `YC_STORAGE_PUBLIC_BASE_URL`

## Notes

- Style presets are stored in `config/styles.json` inside the bucket.
- Default preset previews are shipped from `public/previews`.
- The frontend is private by URL only. No auth is included.
