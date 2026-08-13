# FileWorks deploy

**API** → AWS Lambda (container + Function URL) in a **private VPC** (RDS + S3 gateway, no NAT)  
**LLM worker** → second Lambda **outside** the VPC (vision + translation HTTPS)  
**UI** → Cloudflare Pages (Next.js static export)

Environments: `dev`, `staging`, `prod`. AWS account this stack was written against: **722972110637** (`zhenqi`, region `us-east-1`).

## Split of duties

| Layer | Where | Why |
|---|---|---|
| FastAPI + Paddle/AnyDoc | API Lambda in private VPC | RDS + S3 via gateway/interface endpoints; no NAT |
| Vision LLM + translation | Sibling Lambda (no VPC) | Public HTTPS to vendors; invoked by the API Lambda |
| Uploads | S3 presigned PUT from the browser | File bytes never enter Lambda; no NAT Gateway |
| History | S3 (API Lambda via S3 gateway) | Private VPC, no internet |
| Users / plans / quotas | RDS Postgres (not publicly accessible) | Same VPC as the API Lambda |
| Secrets | Secrets Manager | LLM/translate keys + Google client ID |
| Next.js workspace | Cloudflare Pages | Static `out/` via Wrangler Direct Upload |

The API Lambda **is in a VPC** so it can reach RDS. There is **no NAT Gateway and no Internet Gateway**. S3 uses a gateway endpoint; Secrets Manager, CloudWatch Logs, Lambda Invoke, and ECR use interface endpoints. Vision LLM and translation run on `fileworks-<env>-llm`, which is **not** in the VPC.

Browsers PUT to:

`s3://fileworks-<prod|stage|dev>/upload/files/<user_id>/<document_id>/<filename>`

(`staging` maps to bucket alias `stage`.)

API Gateway is not used (29s cap). The Function URL uses the Lambda timeout.

## IAM gap on this AWS account

`zhenqi` can create S3/ECR/roles and read Secrets Manager, but **not** `lambda:*` or `iam:PassRole`. Attach the included policy first:

```bash
./scripts/fw attach-policy
./scripts/fw check
```

`check` also verifies Wrangler is logged into Cloudflare (`npx wrangler whoami`). If not, the frontend step runs `wrangler login`, or set `CLOUDFLARE_API_TOKEN` (and optional `CLOUDFLARE_ACCOUNT_ID`).

## TUI

```bash
./scripts/fw
```

First-time path: **Attach deploy IAM policy** → **Full deploy**. That bootstraps Terraform state, builds/pushes the Lambda image, applies AWS, seeds secrets from `backend/.env`, then builds the UI and deploys it to Pages.

Non-interactive:

```bash
./scripts/fw --env dev full
./scripts/fw --env staging plan
./scripts/fw --env prod frontend
```

Pages projects: `fileworks-dev`, `fileworks-staging`, `fileworks-prod` → `https://fileworks-<env>.pages.dev`. After a UI deploy, the TUI writes that origin into Lambda/S3 CORS.

## Layout

```
fw/                         Rich TUI (python -m fw)
scripts/fw                  launcher
infra/
  deploy.py                 shim → fw.cli
  iam/fileworks-deploy-policy.json
  docker/Dockerfile         Lambda Web Adapter + FastAPI
  terraform/                ECR, Lambda, VPC, RDS, S3, secrets
frontend/
  wrangler.jsonc            Pages output dir
  public/_redirects         SPA fallback
```

State key: `s3://fileworks-tfstate-<account>/fileworks/<env>/terraform.tfstate`.

## Secrets

Terraform creates `fileworks-<env>/app` in Secrets Manager. **Seed** copies LLM/translate keys and `GOOGLE_CLIENT_ID` from `backend/.env` (never committed) and merges them into the existing secret so RDS/JWT values are not wiped. Lambda reads `FILEWORKS_SECRET_ARN` on cold start.

`NEXT_PUBLIC_API_URL` is baked into the Pages build from the Lambda Function URL. Local `npm run dev` still uses `http://127.0.0.1:8000`.
