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

## Origins and the API endpoint

Five rules keep CORS and the endpoint from drifting. Break one and browser calls fail.

| Rule | Where | Why |
|---|---|---|
| The browser calls the Lambda Function URL **directly** | `frontend/public/config.js` | Cloudflare proxies cut responses at ~100s; conversions run to 900s, so a same-origin `/api` proxy would break them |
| The API endpoint is **runtime** config, never baked into JS | `config.js` → `src/lib/runtime-config.ts` | Changing the endpoint is a static-file swap, not a bundle rebuild |
| Preview hosts are covered by **patterns**, not lists | `cors_origin_regex` (API), `cors_wildcard_origins` (S3) | `<hash>.<project>.pages.dev` changes every deploy; patterns need no apply |
| **Sign in only on registered origins** | Google Cloud console | Google forbids wildcard JavaScript origins and offers no API, so preview hosts can never sign in |
| **Never redirect the browser to S3** | `/history/{id}/file-url` | A cross-origin redirect makes the follow-up preflight send `Origin: null`; no bucket rule matches that without opening the bucket to every site |

Hand the browser a URL and let it call S3 itself, keeping its real `Origin`. The old
`/history/{id}/file` still redirects plain downloads and `curl`, which send no
`Origin`, but answers a cross-origin fetch with a 409 naming `/file-url` rather than
letting it die as an unexplained CORS error.

Two things make this class of bug readable when it does happen. `UnhandledErrorMiddleware`
keeps a crashing endpoint inside the CORS layer, so a 500 arrives as a 500 instead of a
missing-header CORS failure. And the UI blames the backend being down only on localhost;
on a deployed origin it says the request was blocked and points at CORS or a server error.

Consequence: **test on the stable `https://fileworks-<env>.pages.dev`**. `fw frontend`
publishes the stable alias, writes `config.js` from the Terraform `api_url` output,
and prints preview hosts only as a note. `config.js` also carries `canonicalOrigin`,
so a browser that lands on a `*.pages.dev` preview host redirects itself to the
stable origin instead of failing on CORS and `origin_mismatch`.

The Function URL is stable across `push-image` and `apply`; it only changes if the
function or URL resource is destroyed and recreated. `fw status` verifies all of
this: it preflights CORS from the stable origin against both the API and the two
S3 buckets the browser talks to directly, and compares the deployed
`config.js` against `api_url`, warning when the UI is pinned to a stale endpoint.

Prod keeps exact origins only (no preview regex, no wildcards) and `fw frontend`
never rewrites prod CORS.

## The Lambda needs public egress

The API Lambda runs in private subnets so it can reach RDS. VPC endpoints only
cover AWS services, so a private subnet with no NAT has **no route to the public
internet** — and Google sign-in needs one: `verify_google_id_token` fetches
Google's signing certs from `www.googleapis.com`, and Stripe calls are external too.

Without it, `/api/auth/google` does not fail fast. It hangs for the full connect
timeout and then returns `401 Invalid Google token: ... Connection to
www.googleapis.com timed out`, which reads like a token problem rather than a
networking one. `enable_nat_gateway` (default `true`) provisions the IGW, public
subnet, EIP, single NAT, and the private `0.0.0.0/0` route. Turn it off only for
an environment that never signs anyone in.

Quick check that egress works, independent of any browser:

```bash
curl -sS -X POST "$API_URL/api/auth/google" \
  -H 'Content-Type: application/json' -d '{"id_token":"dummy"}'
```

A fast `401 Invalid Google token: Token format` means egress is fine. A slow
`401 ... timed out` means the NAT path is missing.

## Concurrency and autoscaling

Lambda **already scales on demand**. This account’s Concurrent executions quota
(`L-B99A9384`) is **1000** — the AWS default. Requesting 100 is a decrease and
AWS rejects it (`desired value greater than the default quota value of 1000`).

A console value of **10** is almost always **reserved concurrency** on the
function (a hard cap). This stack sets `lambda_reserved_concurrency = -1`
(unreserved) so API and LLM share the 1000 pool.

`fw lambda-quota` only requests an increase when the current quota is below
the Terraform `lambda_account_concurrency` target (default 1000). You need a
support request only if you want **more than 1000**.

```bash
./scripts/fw --env staging lambda-quota
```

Staging/prod also enable **provisioned-concurrency autoscaling** on the API
`live` alias (`lambda_provisioned_min` / `max` in `envs/<env>.tfvars`). That
keeps warm instances under load; it does **not** raise the account ceiling.
Provisioned capacity counts against the same quota — leave headroom for the
LLM function (one convert can use API + LLM at once).

The API Function URL for new deploys is the `live` alias (required for
provisioned concurrency). Apply also keeps the older `$LATEST` Function URL so
the Cloudflare Worker does not 502 mid-cutover. Run `fw frontend` after apply
so `api.<env>.fileworks.ai` points at the alias URL.

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

First-time path: **Attach deploy IAM policy** → **Full deploy**. That bootstraps Terraform state, builds/pushes the Lambda image, applies AWS, seeds secrets from `backend/.env`, then builds the UI and deploys it to Pages. `lambda-quota` is optional: this account is already at the AWS default of 1000.

Non-interactive:

```bash
./scripts/fw attach-policy
./scripts/fw --env staging lambda-quota   # no-op unless quota is below 1000
./scripts/fw --env dev full
./scripts/fw --env staging plan
./scripts/fw --env staging push-image   # RDS migrates on the next API Lambda boot
./scripts/fw --env staging logs -f
./scripts/fw --env staging logs --function api -f
./scripts/fw --env staging logs --function llm -f --since 2h
./scripts/fw --env staging logs --no-follow --function both --since 2h
```

`fw logs` (`-f` / `--follow`, the default) live-tails CloudWatch for the API Lambda (`/aws/lambda/fileworks-<env>-api`) and/or the LLM worker. Ctrl-C stops the stream. `--no-follow` prints a snapshot and exits. The Infra menu **Lambda logs -f** action prompts for which function. Reading logs needs `logs:FilterLogEvents` on FileWorksDeploy — re-run **Attach deploy IAM policy** if `aws logs tail` is denied.

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

Terraform creates `fileworks-<env>/app` in Secrets Manager. **Seed** copies LLM/translate keys, `GOOGLE_CLIENT_ID`, and `GOOGLE_API_KEY` from `backend/.env` (never committed) and merges them into the existing secret so RDS/JWT values are not wiped. Lambda reads `FILEWORKS_SECRET_ARN` on cold start.

`NEXT_PUBLIC_API_URL` / `config.js` use Terraform `api_url`. Set `public_api_url`
in `envs/<env>.tfvars` (or `PUBLIC_API_URL` in `backend/.env.<env>`) to a custom
host such as `https://api.staging.fileworks.ai`. Empty falls back to the Lambda
Function URL. Local `npm run dev` still uses `http://127.0.0.1:8000`.

`fw frontend` also deploys `infra/cloudflare/api-proxy` when a custom API host is
set. The Worker forwards `/api/*` to the Function URL (Lambda rejects a custom
`Host` header). Staging public host is `https://api.staging.fileworks.ai`. If
that hostname already has a manual A/CNAME, delete it in Cloudflare DNS and
re-run `fw frontend` so the Worker can take the hostname as a Custom Domain
(needed for TLS on the nested `api.staging` name).
