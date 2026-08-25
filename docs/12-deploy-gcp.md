# 12 — Deploying AgroVision on Google Cloud Platform

**Audience:** the engineering team preparing AgroVision for a client whose cloud
is Google Cloud. **Scope:** what must be true before any GCP deploy, the
deployment options with honest cost, the prerequisites, and a step-by-step
runbook for the recommended path.

This document is the *operational* companion to the architecture section in
[`technical-documentation.md` → GCP Infrastructure & Deployment](./technical-documentation.md#gcp-infrastructure--deployment).
That section describes the **target** architecture; this one describes **how to
get there from today's repo**, including the things that are not built yet.

> **Everything AgroVision needs is a first-party GCP service.** Runtime =
> Cloud Run, database = Cloud SQL (PostgreSQL + PostGIS), files = Cloud Storage,
> secrets = Secret Manager, auth = Identity Platform, images = Artifact
> Registry, CI = Cloud Build. There is no third-party dependency that would not
> run on the client's GCP account.

---

## 1. Pre-deploy blockers (must be closed before *any* public deploy)

These are not optional hardening — the app will not run correctly (or safely) on
GCP until each is done. Track them as release-gating.

| # | Blocker | Where | What "done" means |
|---|---|---|---|
| B1 | **No `Dockerfile`** | repo root (missing) | A multi-stage image that runs `.next/standalone/server.js` **and** copies `public/` + `.next/static` (the standalone tracer omits both — see `next.config.ts`). Draft in §7. |
| B2 | **No build/CI config** | repo root (missing) | A `cloudbuild.yaml` (or equivalent) that builds and pushes to Artifact Registry. §7. |
| B3 | **Cloud Storage backend is a `TODO` that throws** | `src/lib/storage.ts:71` | `putEvidence()` must actually write to GCS via `@google-cloud/storage` when `GCS_BUCKET_EVIDENCE` is set. Today, setting that env var throws. §8. |
| ~~B4~~ | ~~**Authentication has no credential check**~~ | `src/lib/session.ts` (`resolveLoginWithIdToken`), `src/lib/auth/` | **DONE (B-27, migration 0057).** ID tokens are verified server-side (RS256 signature against Google's certs, `iss`/`aud`/`exp`/`iat`) before any cookie is issued; the `sub` claim goes to `app.resolve_session()`. The email-only login is development-only and needs all three of `AUTH_MODE=stub`, `NODE_ENV != production`, and `app.auth_settings.stub_login_enabled`. What remains is **operational**, not code: enabling Identity Platform and linking accounts — §9. |
| B5 | **Production-readiness gate is red** | `app.check_production_readiness()` | Run `npm run db:check`. Every `blocking = true` row (demo tenants `is_demo`, non-empty `master_items`, the `evidence_links` mutation-test gap, etc.) must clear before go-live. §10. |
| B6 | **465 MB of static tiles in the image** | `public/tiles` (3,571 files) | Move the orthophoto XYZ pyramid to a Cloud Storage bucket (CDN-fronted) so it is not baked into every container image / Cloud Run cold start. §8. |

**B4 was the hard stop; it is closed in code.** The remaining risk moved from
"anyone who knows an email can sign in" to "nobody can sign in until Identity
Platform is configured and accounts are linked" — a deploy that skips §9 will
serve a login page that refuses to work and says which env vars are missing.
That is the intended failure direction, but it does mean §9 is now a
**prerequisite of the deploy**, not a follow-up.

---

## 2. The free-tier question — honest answer

**There is no genuinely $0 "always-free" deployment of this app.** The reason is
not Cloud Run — it is the database. AgroVision *requires* managed PostgreSQL +
PostGIS, and **Cloud SQL has no always-free tier.**

| Component | Always-free? | Reality for this app |
|---|---|---|
| **Cloud SQL (Postgres + PostGIS)** | ❌ None | Hard cost floor. Smallest usable shared-core instance is the minimum spend. |
| **Cloud Run** | ✅ Generous (2M req, 360k vCPU-s, 180k GiB-s / mo) | Free **only if scaled to zero**. The docs' `--min-instances=1` keeps CPU allocated 24/7 and breaks the free tier. |
| **Cloud Storage** | ⚠️ 5 GB free — **US regions only** | Not free in `asia-southeast2` (Jakarta). 465 MB tiles + evidence exceed 5 GB anyway. |
| **Artifact Registry** | ⚠️ 0.5 GB free | The image (with tiles removed, B6) fits comfortably; keep old tags pruned. |
| **Secret Manager** | ✅ 6 active secrets + 10k accesses/mo free | We use 3 secrets — within free. |
| **HTTPS Load Balancer + Cloud CDN** | ❌ ~$18+/mo for the forwarding rule | Not needed for a pilot — Cloud Run serves a free managed-TLS `*.run.app` URL. |
| **Identity Platform** | ✅ 50k MAU free | Comfortably free at pilot scale. |

**Two facts make cost a non-issue for the current (pre-planting) stage:**

1. **$300 / 90-day free trial credit** (new GCP billing accounts) covers the
   *entire* architecture — including the full production version — for ~3
   months. For a pilot, this is effectively free.
2. **Steady-state, cost-optimized, is ~$15–30/month** (see §4).

> All prices below are **rough estimates for `asia-southeast2` (Jakarta)** and
> **must be confirmed** in the [GCP Pricing Calculator](https://cloud.google.com/products/calculator).
> Jakarta pricing runs slightly above US regions.

---

## 3. Deployment options

Three viable shapes. All run entirely on the client's GCP.

### Option A — Single Compute Engine VM (cheapest flat cost, already scripted)

The `deploy/` folder **already implements this**: `setup-vm.sh` provisions an
Ubuntu VM (Node 22, nginx, certbot, Docker), runs PostGIS via `docker compose`,
builds the standalone server, and runs it under systemd behind nginx TLS.

- **Cost:** ~$15–20/mo (e2-small, 2 GB) flat.
- **Pros:** cheapest steady-state; one box; the scripts exist and are idempotent.
- **Cons:** you self-manage OS patching **and database backups**; no autoscale;
  no managed PITR. The always-free `e2-micro` is US-regions-only, so a Jakarta
  VM is not free.
- **Use when:** the client wants absolute-minimum flat cost and accepts
  self-managed ops. See [`deploy/README.md`](../deploy/README.md).

### Option B — Cloud Run + Cloud SQL, pilot-stripped ✅ **(recommended)**

The architecture the **code already assumes** (standalone output, Cloud SQL
socket string in `.env.example`, two-service-account model), minus the
LB/CDN/min-instances that only matter under real traffic.

- **Cloud Run** `--min-instances=0` (scale to zero), `--cpu=1`,
  `--memory=512Mi`, `--concurrency=80`. Serve on the free `*.run.app` URL.
- **Cloud SQL** smallest shared-core PostgreSQL 16 + PostGIS, Public IP + the
  built-in connector (no VPC to manage for a pilot).
- **Cloud Storage** buckets for evidence (private) and tiles (B6).
- **Skip** the global Load Balancer and Cloud CDN for now.
- **Cost:** ~$15–30/mo steady-state; ~$0 during the 90-day credit.
- **Pros:** managed backups + PITR; scales to zero when idle; least throwaway
  work (it *is* the intended architecture); a clean upgrade path to Option C.
- **Cons:** cold-start latency after idle (acceptable for a low-traffic B2B
  pilot); shared-core DB must be sized up before heavy use.

### Option C — Full production architecture (from `technical-documentation.md`)

Global external HTTPS Load Balancer + Cloud CDN (fronting tiles/static),
Cloud Run `--min-instances=1`, Cloud SQL on **Private IP**, separate migration
Job, full observability.

- **Cost:** ~$70–150+/mo depending on instance sizes and traffic.
- **Use when:** real users, real traffic, planting underway. Overkill today.
- Fully specified already in
  [`technical-documentation.md`](./technical-documentation.md#target-production-architecture-region-asia-southeast2-jakarta).

### Recommendation

**Start on Option B, funded by the $300 / 90-day credit.** It matches the
client's GCP mandate, reuses the architecture the code is already written for
(so nothing is thrown away when you scale up), is effectively free for the pilot
window, and upgrades to Option C by *adding* an LB + CDN + private IP later
without re-architecting. Keep Option A in your pocket if the client prioritizes
minimum flat cost over managed convenience — it is already scripted.

| | A — Single VM | B — Cloud Run + Cloud SQL | C — Full prod |
|---|---|---|---|
| Est. steady cost/mo | ~$15–20 | ~$15–30 | ~$70–150+ |
| Managed DB backups / PITR | ❌ self-managed | ✅ | ✅ |
| Autoscale | ❌ | ✅ (to zero) | ✅ (warm) |
| Ops burden | Highest | Low | Low |
| Cold starts | None | Some when idle | None |
| Already scripted in repo | ✅ `deploy/` | ⚠️ needs B1–B3 | ⚠️ + LB/CDN |
| Best for | Min flat cost | **Pilot (now)** | Real traffic |

---

## 4. Prerequisites

### 4.1 Accounts & access
- A GCP **project** on the client's billing account (or your own for the pilot,
  migrated later). Note the `PROJECT_ID`.
- **Billing enabled** (required even to use free-tier / credit).
- IAM: whoever runs the runbook needs Project **Owner** or a bundle of
  Cloud Run Admin, Cloud SQL Admin, Storage Admin, Secret Manager Admin,
  Artifact Registry Admin, and Service Account Admin.

### 4.2 Local tooling
- `gcloud` CLI (authenticated: `gcloud auth login`, `gcloud config set project PROJECT_ID`).
- Docker (only if building images locally instead of Cloud Build).
- Node **22 LTS** (Next.js 16 needs ≥ 20.9; the repo's `setup-vm.sh` standardizes
  on 22 — prefer `node:22-slim` in the Dockerfile over the `node:20` draft in the
  old docs).

### 4.3 Enable APIs (once per project)
```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  identitytoolkit.googleapis.com          # Identity Platform (§9)
```

### 4.4 Region
Use **`asia-southeast2` (Jakarta)** for lowest latency to Indonesian field
users — this is the region already assumed in `.env.example`'s Cloud SQL socket
string. Keep Cloud Run, Cloud SQL, and buckets in the same region.

### 4.5 Two service accounts (the non-negotiable security split)
AgroVision uses **two Postgres identities** — runtime (`app_rw`, DML only) and
owner (DDL + migrations). This maps to two service accounts. **Never merge
them**; giving the request-serving container the owner credential bypasses every
RLS / append-only guarantee.

```bash
gcloud iam service-accounts create sa-agrovision-run \
  --display-name "AgroVision runtime (app_rw)"
gcloud iam service-accounts create sa-agrovision-migrate \
  --display-name "AgroVision migrations (owner)"
```

IAM grants (least privilege):
- `sa-agrovision-run`: `roles/cloudsql.client`,
  `roles/secretmanager.secretAccessor` (scoped to the app_rw password + session
  secret), `roles/storage.objectAdmin` on the **evidence bucket only**.
- `sa-agrovision-migrate`: `roles/cloudsql.client`,
  `roles/secretmanager.secretAccessor` (scoped to the **owner** secret only).

### 4.6 Three secrets (Secret Manager)
```bash
printf '%s' "$SESSION_SECRET"     | gcloud secrets create session-secret     --data-file=-  # openssl rand -hex 32
printf '%s' "$APP_RW_DB_URL"      | gcloud secrets create db-app-rw-url       --data-file=-  # DATABASE_URL (app_user)
printf '%s' "$OWNER_DB_URL"       | gcloud secrets create db-owner-url        --data-file=-  # MIGRATION_DATABASE_URL (owner)
```
`bootstrap-role.mjs` already documents that in production the password comes from
Secret Manager, not `.env`.

---

## 5. Environment variables reference

From `.env.example`, mapped to their GCP source.

| Variable | Used by | Value on GCP |
|---|---|---|
| `MIGRATION_DATABASE_URL` | migrate + bootstrap (owner) | `db-owner-url` secret. Socket form: `postgres://USER:PASS@/agrovision?host=/cloudsql/PROJECT:asia-southeast2:INSTANCE` |
| `DATABASE_URL` | app runtime (`app_rw`) | `db-app-rw-url` secret, same socket form, `app_user` role |
| `APP_DB_USER` / `APP_DB_PASSWORD` | `db:bootstrap` (one-time) | Provided when running bootstrap; not needed by the running service |
| `DATABASE_POOL_MAX` | `src/lib/db.ts` (default 10) | Keep `max-instances × pool_max` **under** the Cloud SQL connection limit |
| `SESSION_SECRET` | `src/lib/session.ts` (≥ 32 chars) | `session-secret` secret |
| `GCS_BUCKET_EVIDENCE` | `src/lib/storage.ts` | Evidence bucket name — **only after B3 is implemented** |
| `NEXT_PUBLIC_BASEMAP_STYLE_URL` | map component | Basemap style URL (build-time; `NEXT_PUBLIC_*` is inlined at build) |
| `PORT` | Next standalone server | Cloud Run injects `PORT` (usually 8080); the server reads it |

> `NEXT_PUBLIC_*` vars are baked in at **build time**, not injected at runtime.
> If the basemap URL differs per environment, it must be set during the Cloud
> Build step, not on the Cloud Run service.

---

## 6. Recommended runbook — Option B (Cloud Run + Cloud SQL)

Assumes §4 prerequisites are done and B1–B4 are closed. Placeholders:
`PROJECT`, `REGION=asia-southeast2`, `INSTANCE=agrovision-pg`.

### 6.1 Create the database (once)
```bash
gcloud sql instances create agrovision-pg \
  --database-version=POSTGRES_16 \
  --region=asia-southeast2 \
  --tier=db-custom-1-3840 \        # 1 vCPU / 3.75 GB. For the cheapest pilot use a
                                   # shared-core tier (db-g1-small / db-f1-micro); size up before real load.
  --storage-type=SSD --storage-size=10GB \
  --backup --enable-point-in-time-recovery

gcloud sql databases create agrovision --instance=agrovision-pg
# Enable extensions (0001_extensions.sql needs these): connect and run
#   CREATE EXTENSION IF NOT EXISTS postgis, btree_gist, pg_trgm, citext;
# (postgis/btree_gist/pg_trgm/citext are all supported on Cloud SQL PG16.)
```

### 6.2 Bootstrap the app role (once, as owner)
`bootstrap-role.mjs` creates `app_user` and `GRANT`s `app_rw`. This is
intentionally **not** a migration (role/password are per-environment). Run it
once against the owner connection — from Cloud Shell, a bastion, or a one-off
`gcloud sql connect`, with `APP_DB_USER` / `APP_DB_PASSWORD` set.

### 6.3 Artifact Registry + build (B1, B2)
```bash
gcloud artifacts repositories create agrovision \
  --repository-format=docker --location=asia-southeast2

REPO=asia-southeast2-docker.pkg.dev/$PROJECT/agrovision
gcloud builds submit --tag $REPO/web:$(git rev-parse --short HEAD)
```

### 6.4 Run migrations FIRST (owner identity, Cloud Run Job)
Migrations must run before the service starts. Same image, different command.
```bash
gcloud run jobs deploy agrovision-migrate \
  --image $REPO/web:$(git rev-parse --short HEAD) \
  --region asia-southeast2 \
  --service-account sa-agrovision-migrate@$PROJECT.iam.gserviceaccount.com \
  --set-cloudsql-instances $PROJECT:asia-southeast2:agrovision-pg \
  --set-secrets MIGRATION_DATABASE_URL=db-owner-url:latest \
  --command node --args db/migrate.mjs
gcloud run jobs execute agrovision-migrate --region asia-southeast2 --wait
```

### 6.5 Deploy the service (runtime identity)
```bash
gcloud run deploy agrovision-web \
  --image $REPO/web:$(git rev-parse --short HEAD) \
  --region asia-southeast2 \
  --service-account sa-agrovision-run@$PROJECT.iam.gserviceaccount.com \
  --set-cloudsql-instances $PROJECT:asia-southeast2:agrovision-pg \
  --set-secrets DATABASE_URL=db-app-rw-url:latest,SESSION_SECRET=session-secret:latest \
  --min-instances 0 --max-instances 3 --concurrency 80 \
  --cpu 1 --memory 512Mi \
  --no-allow-unauthenticated      # private until §9 accounts are linked
```
Flip to `--allow-unauthenticated` only **after** §9 is done: the env vars set
and at least one `app.users.external_id` linked to an Identity Platform UID.
Token verification itself ships in the image (B-27); what a premature flip
exposes is a login page nobody can get past, not an open door. Keep `max-instances × DATABASE_POOL_MAX` under the Cloud SQL
connection limit.

### 6.6 Upload tiles to a bucket (B6)
```bash
gcloud storage buckets create gs://$PROJECT-agrovision-tiles --location=asia-southeast2
gcloud storage cp -r public/tiles gs://$PROJECT-agrovision-tiles/tiles
# Point the map component at the bucket URL; add Cloud CDN when moving to Option C.
```

---

## 7. Container image (B1/B2) — reference

No `Dockerfile` exists yet. It must honor the `next.config.ts` note: standalone
output omits `public/` and `.next/static`.

```dockerfile
# --- build stage ---
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build                                   # -> .next/standalone + .next/static

# --- runtime stage ---
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public              # NOT auto-included by tracer
COPY --from=build /app/.next/static ./.next/static  # NOT auto-included by tracer
COPY --from=build /app/db ./db                      # migrate.mjs + migrations for the Job
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
```
The migration Job reuses this image, overriding the command to
`node db/migrate.mjs`. `pg` is a runtime dependency, so it is in the bundle.

**Before wiring tiles to a bucket (B6),** the 465 MB `public/tiles` will bloat
the image and slow cold starts — exclude it via `.dockerignore` and serve from
the tiles bucket instead.

---

## 8. Evidence storage backend (B3)

`src/lib/storage.ts:71` currently **throws** when `GCS_BUCKET_EVIDENCE` is set.
Implement the GCS branch:
- Add `@google-cloud/storage`; on Cloud Run it authenticates via the attached
  service account (no key file).
- Write `bucket(GCS_BUCKET_EVIDENCE).file(key).save(bytes)`; keep the existing
  content-addressed key (`kind/companyId/<sha0-2>/<sha256>-<name>`) so re-uploads
  dedupe.
- Store `gs://bucket/key` in `app.evidence_files.storage_path` (schema already
  expects `gs://`, migration `0010_evidence.sql`).
- Serve files back via **short-lived signed URLs**, never public ACLs.
- Bucket must be **private**, same region, with `roles/storage.objectAdmin`
  granted to `sa-agrovision-run` only.

---

## 9. Authentication — Identity Platform (B-27, implemented)

The flow, as built:
1. The browser posts email + password **straight to Identity Platform**
   (`identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`) and gets an
   ID token. The password never reaches Cloud Run, so it cannot appear in a
   request log.
2. The Server Action receives only that token.
3. `src/lib/auth/identity-platform.ts` verifies it: RS256 only, signature against
   Google's public certificates for the token's `kid`, `iss` =
   `https://securetoken.google.com/<projectId>`, `aud` = `<projectId>`, and
   `exp`/`iat`/`auth_time` within a 60-second skew.
4. The `sub` claim goes to `app.resolve_session()` — the single `SECURITY
   DEFINER` door — and only then is a session cookie issued.

Proof that each rejection actually fires: `npm run auth:verify` (36 checks).

### One-time setup

1. **Enable Identity Platform** in the console and add the sign-in providers you
   need (email/password is what the login form drives today).
2. **Create an account per user.** Self-signup is not required and is safer left
   off: a token for an unknown person is refused anyway (step 4 below).
3. **Link each account** by setting `app.users.external_id` to that account's
   Identity Platform **UID**, over `MIGRATION_DATABASE_URL` (superuser — the app
   role cannot write it):

   ```sql
   UPDATE app.users SET external_id = 'IDP_UID_HERE'
    WHERE email = 'orang@perusahaan.co.id';
   ```

   Linking is deliberately an admin act, not something a first login performs by
   itself. Verify with `SELECT email, external_id, is_active FROM app.users;`
4. **Set the two env vars** on the Cloud Run service (already wired in
   `cloudbuild.yaml` as `_IDENTITY_PROJECT_ID` / `_IDENTITY_API_KEY`):
   `IDENTITY_PLATFORM_PROJECT_ID` (the GCP project id, also the `aud`) and
   `IDENTITY_PLATFORM_API_KEY` (the project's Web API key — public by design;
   it only names the project a sign-in request goes to). Leave `AUTH_MODE`
   unset: unset means `identity-platform`, and `AUTH_MODE=stub` is refused
   outright when `NODE_ENV=production`.

Symptom guide: "Login belum dikonfigurasi …" on the login page means step 4 is
missing (the message names the variable). "terverifikasi di Identity Platform,
tetapi belum terhubung ke pengguna AgroVision" means step 3 is missing for that
person — the credentials were correct.

### The database has the last word

`app.auth_settings.stub_login_enabled` (migration 0057) defaults to `false`, and
`INSERT/UPDATE/DELETE` on that table are revoked from `app_rw`, so the running
application cannot switch passwordless login on even if its env is wrong. Only a
superuser connection can — which is what `npm run db:seed:dev` /
`db:seed:demo` do for local work, and `npm run db:purge:demo` undoes. While it is
on, `app.check_production_readiness()` reports it as **blocking**.

---

## 10. Post-deploy verification

1. `gcloud run jobs execute agrovision-migrate --wait` succeeded (all migrations
   applied). Cross-check with `npm run db:status` against the instance.
2. **Production-readiness gate** (B5): run `npm run db:check` — every
   `blocking = true` row from `app.check_production_readiness()` must be cleared
   (demo tenants purged: `npm run db:purge:demo`; `master_items` intentionally
   empty; `evidence_links` mutation-test gap resolved).
3. Service responds on its `*.run.app` URL; static assets and map tiles load
   (confirms B1's `public/` + `.next/static` copy and B6 bucket wiring).
4. An evidence upload lands in the GCS bucket and reads back via signed URL
   (confirms B3).
5. A linked account signs in with its Identity Platform password; an unlinked
   one is refused with "belum terhubung ke pengguna AgroVision"; and
   `npm run auth:verify` passes 36/36 (confirms B-27).
6. Cloud Logging shows container stdout; `withRls` failures and the migrate
   runner log there.

---

## 11. Cost-control checklist (keep the pilot near-free)

- Cloud Run `--min-instances=0` (scale to zero when idle).
- Smallest Cloud SQL shared-core tier; size up only when measured.
- **No** Load Balancer / Cloud CDN until Option C.
- Tiles + static in a bucket (B6), not in the image / not served by Cloud Run.
- Prune old Artifact Registry tags (stay under 0.5 GB free).
- Set a **billing budget + alert** (e.g. $30/mo) the day you enable billing.
- Track the **90-day / $300 credit** expiry; decide A-vs-B steady-state before it
  lapses.

---

## 12. Summary

- **Free tier alone: no** — Cloud SQL has no always-free tier and this app needs
  managed PostgreSQL + PostGIS. But the **$300 / 90-day credit makes the pilot
  effectively free**, and cost-optimized steady-state is **~$15–30/mo**.
- **Recommended path: Option B** (Cloud Run + Cloud SQL, pilot-stripped) — it is
  the architecture the code already assumes, is fully GCP-native end to end
  (including Identity Platform auth), and upgrades cleanly to full production.
- **Before any public deploy, close B1–B5** (Dockerfile, CI, GCS backend, auth,
  readiness gate). B4 is closed in code (B-27); what is left of it is the §9
  account linking, without which nobody can sign in.
- Everything AgroVision needs runs on the client's GCP. Nothing here forces a
  non-GCP dependency.
