# FileWorks Frontend

Next.js UI for FileWorks — convert, transform, and download any file format.

```bash
npm install
npm run dev
```

Open http://localhost:3000

Requires the FastAPI backend on http://127.0.0.1:8000 (proxied via `/api`).

Production UI is a static export on **Cloudflare Pages** (`python3 infra/deploy.py --env <env> frontend`). Local `npm run dev` is unchanged.

