# AgroVision — Technical Documentation

AgroVision is a dynamic, database-backed management platform for a mixed durian + coconut agroforestry project of up to 100,000 ha in Kalimantan, Indonesia. Built on Next.js 16 (App Router, React Server Components + Server Actions) over PostgreSQL 16 + PostGIS, its defining engineering principle is honesty: real persistence with the database as the authoritative security boundary (Row-Level Security, append-only privilege revocation), every dashboard figure computed from actual approved data, and — because the project is still in the seedling-procurement phase with nothing planted and no harvest yet — features that assume productive trees are built schema-complete but deliberately disabled rather than faked. This document describes the product scope, application and data architecture, the security model, the functional modules, the intended Google Cloud infrastructure and deployment runbook, the agronomic methodology, and the operations/testing workflow.

## Table of Contents

- [Status & Honesty Notes](#status--honesty-notes)
- [Product Overview & Scope](#product-overview--scope)
- [Application Architecture](#application-architecture)
- [Data Model & Migrations](#data-model--migrations)
- [Security Model & RLS](#security-model--rls)
- [Functional Modules & Workflows](#functional-modules--workflows)
- [GCP Infrastructure & Deployment](#gcp-infrastructure--deployment)
- [Agronomic Methodology & Data-Integrity Doctrine](#agronomic-methodology--data-integrity-doctrine)
- [Operations, Testing & Local Development](#operations-testing--local-development)

## Status & Honesty Notes

AgroVision is intentionally built so that scaffolding is never disguised as finished product. The status of each area is summarized below and referenced throughout the document.

**Production-live (real persistence, values computed from approved data):**
- **Authentication** — Identity Platform ID tokens are verified server-side (signature, `iss`/`aud`, expiry) before a session cookie is issued (B-27). The old email-only login still exists for development, but a production build refuses to serve it and the database switch that enables it defaults to off.
- Block & Map registry (PostGIS areas, GeoJSON APIs, MapLibre map)
- Farm Activities — weeding, spraying, harvesting, fertilizing, pruning (full draft → submit → approve lifecycle)
- Pre-Farming — Land Suitability classifier, Land Preparation, Nursery/seedling stock (read)
- Agri-Input catalogs (chemical, equipment)
- Accounting **cost-side** reflection; Expenditure + Budget module; cross-module Approval inbox (11 modules)
- Master Data (database-driven dropdowns), Users & Access (read + grant)
- Three dashboards (Operational, Financial, Sustainability)
- Carbon accounting (computed in-DB) and Organic/Compliance registries; Traceability seed chain

**Demo-scaffold / not production-ready (real mechanism, guarded so it cannot be mistaken for production):**
- **Estimate-only agronomy** — emission factors and allometric coefficients are IPCC Tier-1 estimates flagged `requires_validation`; `master_items` content is intentionally empty; demo tenants are flagged `is_demo` (a blocking production-readiness item).

**Coming-soon (schema present, UI disabled or placeholder):**
- Deforestation module (teaser only — the single `ready:false` nav stub)
- Harvest **revenue side**: revenue, P&L, and break-even remain `null` (em-dash) until an approved harvest exists
- Form builder, custom report builder, and the `fertilizer_schedules` rules engine (all phase 2)
- Top-level backward/forward traceability tracing (`PlaceholderPage`)

## Product Overview & Scope

### What AgroVision is

AgroVision is a management platform for an **agroforestry / plantation project in Kalimantan, Indonesia**, built around a mixed **durian + coconut** planting model:

- **Durian** serves as the forestry/timber component; **coconut** is the agri component (product direction: copra / fresh coconut water). Per `docs/11-refinement-30072026.md`, coconut is planted on a 5×7 layout with durian interspersed, and coconut must be a *dwarf/genjah* variety so canopies do not shade each other.
- The project is planned at up to **100,000 ha** (`docs/00-refinement-concept.md`), divided into blocks of roughly 5–30 ha (≈3,300+ blocks). Because agroforestry blocks are mixed-crop, there is **no plot subdivision inside a block** — tracking is per block.
- **Critical scope constraint:** the field is still in the *seedling procurement phase*. **Nothing is planted and there is no harvest yet.** Features that assume productive trees (harvest recording, revenue, traceability chain, DBH-based carbon sequestration) are deliberately built as schema-complete but UI-disabled / "coming soon" rather than faked.

The overriding requirement from `docs/00-refinement-concept.md` is that the platform be **dynamic, not a static mockup**: real persistence, master data from the database (not `constants.ts`), every dashboard number computed from actual data with honest empty states, and live cross-module chains (e.g. an approved expenditure immediately moves cost-per-hectare and the Financial Report).

The implementation is a **Next.js 16 (16.2.9)** web app (`pg`, `maplibre-gl`, `recharts`, `@react-pdf/renderer`, `zod`) backed by **PostgreSQL + PostGIS**, with the schema delivered as 35 sequential SQL migrations in `db/migrations/` (`0001_extensions.sql` … `0035_fix_pending_view_security_invoker.sql`).

### Target users & roles

`docs/00` defines three conceptual roles, which the UI dictionary (`src/lib/i18n.ts`) surfaces as:

- **`creator` / "Petugas Lapangan" (Field Officer)** — data entry, primarily mobile. Submission is intended to be mobile-only (`docs/11` §5).
- **`approver`** — approve/reject/edit submissions, and is a superset of creator.
- **`super_admin`** — manages master data, users, and configuration.
- (`viewer` — read-only, also present.)

Note a genuine vocabulary gap between docs and DB: the database enum `app.user_role` in `db/migrations/0002_core.sql` originally defined eight values — `admin, manager, approver, sustainability_manager, auditor, supervisor, surveyor, viewer` — while the app session layer (`src/lib/session.ts`) resolves an `app_role` via `app.resolve_session()` and the sidebar/i18n speak in terms of `super_admin/approver/creator/viewer`. The conceptual role model and the physical enum are not yet fully reconciled (see [Data Model](#data-model--migrations) for the `app.app_role` supersession in `0014`).

Management and the **finance director** are the primary report/dashboard consumers. `docs/11` frames finance explicitly as a *consumer* of data, never an input role — Accounting has no input forms of its own.

### Module map (agreed IA, docs/11)

The navigation in `src/components/layout/Sidebar.tsx` matches the regrouping agreed in `docs/11-refinement-30072026.md` one-to-one (three dashboards; Pre-Farming; standalone Block & Map; Farm Activities; Agri-Input; Field Survey; Sustainability; Accounting; Report; Approval; plus Settings). Routes live under `src/app/(app)/`, with folder names still in Indonesian from before the regroup (e.g. Accounting → `costing/`, Pre-Farming items under `operasional/`).

```mermaid
mindmap
  root((AgroVision))
    Dashboard
      Operational
      Sustainability
      Financial / Accounting
    Pre-Farming
      Land Suitability
      Land Preparation
      Seedling / Nursery
    Block & Map
    Farm Activities
      Weeding
      Fertilizing
      Pruning
      Spraying
      Harvesting
    Agri-Input
      Chemical
      Equipment
    Field Survey
      Adoption & Observation
    Sustainability
      Carbon Accounting
      Certification
      Traceability
      Deforestation (coming soon)
    Accounting
      Reflection (auto cost)
      Expenditure
      Budget
    Report
      Financial
      Operational
      Sustainability
    Approval (inbox)
    Settings
      Master Data
      Users
```

Route mapping (as built):

| Group | Routes under `src/app/(app)/` |
|---|---|
| Dashboard ×3 | `dashboard/`, `dashboard/sustainability/`, `dashboard/financial/` |
| Pre-Farming | `operasional/kesesuaian-lahan/` (suitability), `operasional/persiapan-lahan/` (land prep), `nursery/` |
| Block & Map | `operasional/blok/` |
| Farm Activities | `aktivitas/weeding/`, `operasional/pemupukan/` (fertilizing), `operasional/pruning/`, `aktivitas/spraying/`, `aktivitas/panen/` (harvesting) |
| Agri-Input | `agri-input/chemical/`, `agri-input/equipment/` |
| Field Survey | `survei/` (Adoption & Observation) |
| Sustainability | `keberlanjutan/karbon/`, `keberlanjutan/sertifikasi/`, `keberlanjutan/traceability/`, `keberlanjutan/deforestation/` (`ready:false` — the only "coming soon" stub in the nav) |
| Accounting | `costing/refleksi/`, `costing/pengeluaran/`, `costing/anggaran/` |
| Report | `laporan/keuangan/`, `laporan/operasional/`, `laporan/keberlanjutan/` |
| Approval | `approval/` |
| Settings | `pengaturan/master-data/`, `pengguna/` |

**Key architectural decision (docs/11 §4):** *Accounting is a reflection module, not an input module.* There is no "input expense" form for finance; costs appear automatically when an operational submission is approved, computed as `volume × rate` from a configured price list / catalog (see the `costing/refleksi/` route and `db/migrations/0033_price_list.sql`). Standard-costing caveats (price-list versioning, standard cost vs actual cash) are flagged as open risks in `docs/11` §10.

### Multi-tenant model (company → estate → block)

The land is split across multiple corporate entities (`docs/00` estimates 5–10 companies), so the data model is multi-tenant. The core tenancy tables are in `db/migrations/0002_core.sql` and `0003_gis.sql`, and the hierarchy is actually **four levels**, one deeper than the "company/estate/block" phrasing in the brief:

```
app.companies   (e.g. 'PT Agro Lestari Nusantara', timezone Asia/Jakarta)
  └── app.estates      (MultiPolygon geom, area_ha generated via ST_Area)
        └── app.divisions   (e.g. 'Divisi Agroforestry 2')
              └── app.blocks     (foundation entity — every module references block_id)
```

`app.blocks` (`0003_gis.sql`) carries `company_id`, `estate_id`, `division_id`, a required `geom geometry(MultiPolygon, 4326)`, a generated `area_ha`, and a `verification_status` (`draft` → verified) plus versioned boundaries (`app.block_boundary_versions`) so historical carbon/area calculations are not overwritten when a boundary is re-drawn.

Access scoping (per `docs/00` E.3):

- **`app.user_company_access`** (`0014_core_fix.sql`) and the session layer let one user hold access to one or several companies; `src/lib/session.ts` exposes `getSessionCompanies()` and `switchCompany()` for tenant switching, gated by `app.session_companies($user)`.
- **`app.user_estate_access`** (`0002_core.sql`) narrows a user to specific estates; *no rows means access to the whole company.*
- Tenant isolation is enforced in the database via **Row-Level Security** (`db/migrations/0013_rls.sql`, refined by `0018`, `0020`, `0035`), not only in application code — described in detail in the [Security Model](#security-model--rls) section.

## Application Architecture

AgroVision is a **Next.js 16.2.9 App Router** application (React 19.2.4) running the server-first model end to end: pages are React Server Components, all mutations go through Server Actions, and the browser ships almost no data-fetching code. There is no separate API layer for the core CRUD — the database access layer in `src/lib/db.ts` is called directly from Server Components and Server Actions.

> Note: `AGENTS.md` warns that this Next.js has "breaking changes" versus the public releases and that the canonical guides live in `node_modules/next/dist/docs/`. Treat the App Router conventions here (e.g. `experimental.serverActions`) as pinned to 16.2.9.

### Rendering & data-access model

Server Components read data through the RLS-aware helpers in `src/lib/db.ts`:

- `withRls(ctx, fn)` opens a single `pg` transaction, sets the Postgres session context (`app.current_user_id`, `app.current_role`, `app.current_company_id`) via `set_config(..., true)` (transaction-local, so context never leaks across pooled connections), runs the callback, then `COMMIT`/`ROLLBACK`. It **fails closed**: called without a `userId` it throws rather than silently returning zero rows.
- `rlsQuery(ctx, sql, params)` is the one-shot form.
- `queryWithoutRlsContext(sql, params)` is the deliberately long-named escape hatch, used only for pre-session work (login lookup, `app.resolve_session()`).

The app connects as the least-privilege `app_user` login role (a member of `app_rw`, not `postgres`) so that append-only and RLS enforcement in the database actually apply — connecting as superuser would bypass the entire security layer. The `pg` `Pool` is a singleton (stashed on `globalThis.__agrovisionPool` to survive dev hot-reload), sized by `DATABASE_POOL_MAX` (default 10). The mechanics of `withRls` and its fail-closed guarantee are covered in depth in [Security §2](#2-withrls--transaction-local-rls-context).

### Server Actions and progressive enhancement

Server Actions live under `src/lib/actions/*` (each file starts with `"use server"`). They are the sole write path and are designed to work as plain HTML `<form action={...}>` submissions — no client JS required for the form to function. Client components layer on `useActionState` for pending/error state (see `src/app/(app)/survei/[formId]/SurveyForm.tsx`).

Because a Server Action is reachable by a **direct POST**, not only through the UI, every action re-establishes identity and authorization server-side. The pattern is visible throughout `src/lib/actions/operational.ts`:

```ts
const ctx = await requireRole("creator", "approver", "super_admin");
if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
const parsed = fertSchema.safeParse({ /* fields from FormData */ });
if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), ... };
// ... call repo, then revalidatePath(...) for each affected route
```

Each action: (1) calls `requireRole(...)` / `requireContext()` from `src/lib/session.ts`, (2) validates the `FormData` with a **Zod v4** schema, (3) delegates to a repo function (`src/lib/repo/operational.ts`) that runs inside `withRls`, and (4) calls `revalidatePath(...)` for every route whose cached data changed (e.g. the harvest action revalidates `/aktivitas/panen`, `/approval`, `/dashboard/financial`, `/costing/refleksi`). Errors are normalized to human messages by `toMessage()`, which even maps specific Postgres constraint/RLS failures (`lsa_one_per_block`, `row-level security`) to friendly Indonesian text. Authorization is thus enforced in two independent layers: `requireRole` in the action, and RLS in the database as a backstop.

### Sessions & authorization

`src/lib/session.ts` implements an **HMAC-signed, httpOnly cookie** session (`agrovision_session`, 12-hour max-age, `SHA-256` via `node:crypto`, `timingSafeEqual` compare). The cookie stores the Identity Platform subject (`externalId`) plus the selected `companyId` — not the internal UUID — because `app.users` is behind RLS (migration 0018) and can only be resolved through the `SECURITY DEFINER` function `app.resolve_session()`. `getSession()` re-verifies against the database on every request (a user can be deactivated or re-roled after the cookie was issued), and re-checks that the selected company is still allowed via `app.session_companies()`.

Roles are `creator | approver | super_admin | viewer`. `switchCompany()` lets a user change active entity without re-login (only to permitted entities); `null` company means "all my entities" mode.

**Authentication has two modes, selected by `AUTH_MODE` (B-27, migration 0057).** The default — and the only one a production build will serve — is `identity-platform`: the browser exchanges the password directly with Identity Platform, and only the resulting **ID token** reaches the server, where `src/lib/auth/identity-platform.ts` verifies its RS256 signature against Google's public certificates and checks `iss`/`aud`/`exp`/`iat` before `resolveLoginWithIdToken()` hands the `sub` claim to `app.resolve_session()`. The password never touches this server.

The legacy email-only login survives as `resolveLoginWithEmailStub()` for development and for `scripts/at-verify.mjs`, behind **three** gates that must all be open: `AUTH_MODE=stub`, `NODE_ENV != production`, and the database switch `app.auth_settings.stub_login_enabled` (default `false`, flipped on only by `db:seed:dev` / `db:seed:demo`, and reported as **blocking** by `app.check_production_readiness()` while on). The application role `app_rw` has no write privilege on that table, so the app cannot enable its own stub — see [Security §3](#3-session-layer). Evidence: `npm run auth:verify` (36 checks: forged signatures, `alg:none`, HS256 key confusion, wrong `aud`/`iss`, expiry, and the mode matrix).

### Layout / request flow

`src/components/layout/AppLayout.tsx` is a Server Component acting as the auth gate for the whole `(app)` route group: it calls `getSession()`, `redirect("/login")` if absent, then loads the entity list (`getSessionCompanies`) and locale, and renders `Sidebar` + `Topbar` + `<main>`. A typical request:

1. Browser requests a page under `(app)`; `AppLayout` runs on the server, resolves the session, redirects to `/login` if none.
2. The page (Server Component) calls repo functions → `rlsQuery`/`withRls` with the session's `RlsContext`; the transaction sets Postgres context and RLS scopes rows to the tenant/entity. HTML streams back.
3. A form submit (or direct POST) hits a Server Action → `requireRole` → Zod validation → repo write inside `withRls` → `revalidatePath` → the affected Server Components re-render with fresh data.

### Internationalization (id/en)

i18n is dependency-free and split by runtime boundary:

- `src/lib/i18n.ts` is **pure** (no `next/headers`): it exports `Locale` (`"id" | "en"`, default `id`), the `MESSAGES` dictionary (dotted-namespace keys), and `getDict(locale)` returning a `t(key, fallback?)` function. Missing keys fall back to the key itself (an honest, visible fallback), then to Indonesian.
- `src/lib/i18n-server.ts` is server-only: `getLocale()` reads the `agrovision_locale` cookie via `next/headers`.

Language is chosen by `setLocaleAction` (`src/lib/actions/auth.ts`), which writes the `agrovision_locale` cookie (non-httpOnly, 1-year) and `revalidatePath("/", "layout")`.

### Deployment target

`next.config.ts` sets `output: "standalone"` for containerized deploy to Cloud Run (produces a minimal `server.js`; a comment notes the Dockerfile must copy `public/` and `.next/static` into the standalone output manually). It also raises `experimental.serverActions.bodySizeLimit` to `"8mb"` (up from the 1 MB default) so expenditure forms can upload receipt/invoice photos, while still capping resource abuse. The full target infrastructure is described in [GCP Infrastructure & Deployment](#gcp-infrastructure--deployment).

### MapLibre GL client map

`src/components/map/BlockMap.tsx` is a `"use client"` component built on **MapLibre GL v6** with **free, no-API-key basemaps**: EOX Sentinel-2 cloudless (annual WMTS mosaics, years 2018–2024) and OpenStreetMap raster tiles. Its central design rule is that it **never calls `setStyle()`**: both basemaps are added as layers and switched by `visibility`; the Sentinel-2 year is changed with `RasterTileSource.setTiles()`; and the block/plot data layers are added once on `load` and never removed — eliminating the class of "setStyle drops layers" bugs including a React StrictMode double-mount race. Data comes from `/api/blocks/geojson`, `/api/plots/geojson`, and per-block detail from `/api/blocks/{id}/summary` (fetched client-side with `credentials: "same-origin"`). Block polygon fills are clickable for a cost/area summary popover, and the component surfaces an on-screen diagnostic line (feature counts, render counts, fetch failures) so silent load failures become visible.

### Schema-driven survey forms

The Field Survey module renders forms from schemas stored in the database rather than from hardcoded JSX. `getSurveyForm(ctx, formId)` (`src/lib/repo/operational.ts`) loads a published form's fields (`section_name`, `code`, `label`, `field_type`, `is_required`, `options.choices`), and `SurveyForm.tsx` groups fields by section and renders each according to its `fieldType` at runtime. On submit, `submitSurveyAction` (`src/lib/actions/survey.ts`) re-fetches the schema server-side, validates required fields against it, coerces values per type (`number` → numeric column, `date` → date column, `yes_no` → boolean), and writes via `submitSurvey` inside RLS — the submitted survey then enters the approval queue.

## Data Model & Migrations

AgroVision persists everything in **PostgreSQL 16 with PostGIS** (extensions provisioned in `db/migrations/0001_extensions.sql`: `postgis`, `btree_gist`, `pg_trgm`, `citext`). Every object lives in a single `app` schema. The estates comment records the target platform explicitly: geometry columns and `GENERATED ALWAYS AS (ST_Area(geom::geography)/10000.0) STORED` area columns were "Diuji pada PostGIS 3.4 / PG16".

At the time of writing there are **35 forward-only migrations** (`0001`–`0035`) in `db/migrations/`. Migrations `0001`–`0013` lay down the original schema; `0014` onward are audit-driven fixes and feature refinements (the file headers cite `docs/03-audit-refinement.md` and `docs/04`). There are no down-migrations — the runner only rolls forward.

### Migration runner & checksum ledger

`db/migrate.mjs` is a small Node script (uses `pg`, no ORM). It:

- Creates the ledger `app.schema_migrations (version PK, checksum, applied_at, duration_ms)` if absent.
- Loads `*.sql` files sorted by name, hashing each with a **truncated SHA-256** (`createHash('sha256')...slice(0,16)`).
- Runs each pending file in **one transaction per file** — failure mid-file rolls back the whole file and the ledger row is never written.
- Connects with `MIGRATION_DATABASE_URL` (a superuser/owner connection), deliberately **separate** from the app's `DATABASE_URL`, so the application role never holds DDL rights.

Three modes:

```bash
node db/migrate.mjs            # apply pending migrations
node db/migrate.mjs --status   # show PENDING / ok / CHECKSUM BERUBAH per file
node db/migrate.mjs --verify   # exit 1 if any applied migration drifted
```

**Checksum drift is a hard stop.** On `--apply`, if an already-applied file's checksum differs from the ledger, the runner aborts ("Jangan edit migrasi yang sudah jalan. Buat file migrasi baru."). `--verify` also flags applied versions whose files have gone missing ("FILE HILANG"). This is what makes the "data survives restart" acceptance test reproducible.

### Tenancy, roles & RLS (context for the tables)

- **`app.companies`** is the tenant root; almost every domain table carries `company_id`, and child tables reach the tenant through a parent (e.g. block → company).
- Authorization is not `users.company_id` (that is only a "home entity"). It is the join table **`app.user_company_access`** (added in `0014`), checked by `app.company_in_scope()`. Estate-level narrowing uses `app.user_estate_access`.
- Roles evolved: the original 8-value `app.user_role` enum was superseded by **`app.app_role`** = `creator | approver | super_admin | viewer` (`0014`). Row-Level Security is enabled on tenant tables with `security_invoker` views on top; `0018_security_fix.sql` adds a `rls_exempt_tables` registry for genuinely global reference tables.

### Core geospatial hierarchy

`companies → estates → divisions → blocks → plots`, plus a many-to-many crop overlay for agroforestry:

- **`estates`** / **`blocks`** / **`plots`** all carry `geometry(MultiPolygon, 4326)` with GiST indexes and a stored generated `area_ha`. Blocks add `CHECK (ST_IsValid(geom))`, a boundary provenance enum, and a `verification_status`. `0014` made `blocks.geom` **nullable** so a block can be registered before it is digitized (~3,300 blocks can't all be drawn at once).
- **`block_boundary_versions`** keeps boundary history append-only — old geometry is never overwritten because past carbon calcs depend on the area as it was then.
- **`plot_crop_layers`** (PK `plot_id, crop_id`, with `layer_order`) models stacked agroforestry canopies.
- `0004_gis_ops.sql` adds `boundary_imports`, `boundary_overlaps` (overlaps are *reported for review*, not hard-rejected, via `app.detect_block_overlaps()` with a 100 m² tolerance), and `drone_orthophotos`.

### Operational / field records

Nursery & traceability (`0005`): `suppliers`, `seed_batches` (live/dead counts are *derived* from the latest inspection, not stored), `nursery_inspections`, `seed_distributions`. Planting & tree inventory (`0007`): `planting_plans`, append-only `planting_records`, `tree_survey_points` (point sampling, not per-tree), and optional individual `trees`.

Seedling-phase operations were added in `0017_reports.sql`: **`land_preparations`**, **`land_suitability_assessments`** (deliberately one-per-block, enforced by a partial unique index), **`fertilizer_applications`**, **`pruning_records`**, and **`dbh_measurements`** (diameter-at-breast-height, the basis of the sequestration side). Farm activities were completed in `0034`: **`weeding_records`**, **`spraying_records`**, **`harvest_records`**, plus Agri-Input catalogs **`agri_input_chemicals`** and **`agri_input_equipment`**.

These record tables share a common shape: `block_id`, `approval_status app.record_status`, `rejection_reason`, `created_by` — and a `client_uuid UNIQUE` for offline sync idempotency where relevant.

### Costing & accounting

`0008` created `cost_centers`, `vendors`, `activity_types`, **`activities`** (the join point of costing/carbon/certification), **`cost_transactions`**, `budgets`, `erp_sync_logs`. `0016_costing_fix.sql` reworked this heavily:

- `cost_transactions` gained `cost_category_id`, `supplier_id`, `fiscal_period_id`, `unit_price_idr`, `is_overhead`, `approval_status`, and audit columns; the ERP-specific `erp_document_no` was renamed to `external_document_no` (decision: standalone, not ERP-coupled). Constraints enforce `amount_idr >= 0`, overhead-vs-block scoping, and "rejection needs a reason".
- **`budgets`** was dropped and rebuilt around `fiscal_periods` + a polymorphic `scope_type/scope_id` (`company | estate | block`), validated by a trigger since the scope FK can't be declared.
- `0023` dropped the legacy `status` column (and `app.cost_status` enum) once it was confirmed redundant with `approval_status` — removing a second source of truth.
- **`price_list`** (`0033`) drives the Accounting module, which has no input form: cost/revenue are *reflections* of operational volume × configured rate (`driver` ∈ `block_area_ha`, `landprep_area_ha`, `seedling_qty`, `fertilizer_qty`).

### Carbon / MRV

`0009_carbon.sql` is the most integrity-focused module:

- **`emission_factors`** is **append-only and versioned** (revision = new row with `version+1`); a partial unique index `WHERE valid_to IS NULL` enforces one active version per code. Because `0013` revokes UPDATE, new versions are published only through the `SECURITY DEFINER` function `app.publish_emission_factor()` (`0014`).
- **`carbon_runs`** are immutable once approved; corrections create a new run via `supersedes_run_id`. `carbon_run_blocks` snapshots `area_ha` and `boundary_version` per block so runs stay reproducible after boundaries change.
- `activity_emissions` snapshots both quantity and factor value. `sequestration_models`, `mrv_packages`, `mrv_package_sections` round out MRV.
- `0026_carbon_reference.sql` seeds **Tier-1 IPCC estimate** emission factors, allometric coefficients (`AGB = a·DBH^b`), and sequestration models, and adds `app.generate_carbon_run()` which *computes* runs from PostGIS areas + approved DBH measurements. **Honesty guardrail:** these coefficients are explicitly flagged (`allometric_coefficients.requires_validation = true`, source strings marked "perkiraan — perlu validasi"), and `app.check_production_readiness()` reports them. `0027` closed a tenant-authorization hole in that `SECURITY DEFINER` function. See [Agronomic Methodology](#carbon-accounting--ipcc-tier-1-marked-requires_validation) for the computation detail.

### Compliance & organic registries

- `0030_compliance_registry.sql`: global reference **`compliance_items`** (groups A–H — permits, food safety, export, mill, sustainability, timber legality, carbon, lender frameworks; ~50 seeded rows) + tenant-scoped **`compliance_tracking`** (`app.compliance_status` enum).
- `0032_organic_certification.sql`: **`organic_items`** (per-market standards SNI/EU/NOP/JAS/… and land-history evidence K1–K7) + **`organic_tracking`** (`app.organic_status` incl. `in_conversion`).
- The original Rainforest-Alliance-style audit chain (`0011_cert.sql`: `standards → standard_versions → standard_criteria`, `cert_programs`, `cert_assessments`/`_items`, `cert_findings`, `capa`, `cert_decisions`, `certificates`) is retained underneath these registries.

### Master data, agronomy references & land suitability

- `0015_master.sql`: generic **`master_types`/`master_items`** back every dropdown (edited by super_admin without redeploy). Structure is seeded (12 required types) but **`master_items` content is intentionally empty** — seeding from dummy data was cancelled to avoid laundering fabricated numbers. Attribute-heavy masters get their own tables: `fertilizer_types`, `fertilizer_schedules`, `allometric_coefficients`.
- `0031`: **`fertilizer_recommendations`** per block × crop × phase, parameters in JSONB, doses nullable and `is_provisional = true` until locally calibrated.
- `0028_land_suitability.sql`: **`land_suit_criteria`** stores BBSDLP/Djaenudin suitability class bands as JSONB `bands` data (matching + Liebig minimum law), seeded for COCONUT and DURIAN; results are written back to `land_suitability_assessments` (`suit_class`, `subclass`, `limiting[]`).

### Forms & submissions (dynamic form builder)

`0006_survey.sql`: **`forms → form_versions → form_fields`**, with submissions pinned to a **version** (`survey_submissions.form_version_id`) so old data stays readable when a form changes. **`submission_values`** stores one typed row per answer (`value_text/num/bool/date/geom/json`) rather than a JSONB blob, so answers are queryable. `assignments` and `sync_sessions` support offline field work.

### Evidence, workflow & audit

- `0010`: **`evidence_files`** are first-class (hash-verified, geotagged) with polymorphic **`evidence_links`** so one photo can back a tree survey *and* a certification criterion. `0014` moved verification into append-only `evidence_verifications`.
- `0012`: **`approval_requests`/`approval_steps`** for staged approvals, and an append-only **`audit_log`** (bigserial) written by the generic `SECURITY DEFINER` trigger `app.write_audit()`, attached to sensitive tables (`blocks`, `emission_factors`, `carbon_runs`, `cert_decisions`, `cost_transactions`).

### Important enums

| Enum | Values | Notes |
|------|--------|-------|
| `record_status` | draft, submitted, under_review, approved, rejected, cancelled | canonical approval state machine (`0014`); replaced older Indonesian-language enums |
| `app_role` | creator, approver, super_admin, viewer | authorization role (`0014`) |
| `field_type` | text, number, date, single_choice, multi_choice, yes_no, scale, table, photo, document, signature, gps, polygon, qr_scan | 14 form-builder field types (renamed to English in `0014`) |
| `verification_status` | draft, submitted, verified, rejected | block boundary verification |
| `boundary_source` | gps_survey, drone_ortho, shapefile_import, manual_digitize, legacy_document | |
| `land_use` | productive, conservation, buffer, infrastructure, nursery | |
| `run_status` / `carbon_status` | draft…superseded / net_sink, neutral, net_emitter, data_incomplete | carbon runs |
| `budget_scope` | company, estate, block | polymorphic budget scoping |
| `compliance_status` / `organic_status` | belum_mulai…tidak_relevan / …in_conversion, tersertifikasi | registries keep Indonesian labels |

Many enum values were renamed from Indonesian to English in `0014` via `ALTER TYPE … RENAME VALUE` (data-preserving); registry enums added later (`0030`/`0032`) keep Indonesian labels intentionally.

### Key views

All aggregation views use `WITH (security_invoker = true)` so they honor the caller's RLS (no cross-tenant leak).

- **`v_pending_approvals`** (`0025`, extended in `0034`, fixed in `0035`) — a `UNION ALL` inbox over every approval-bearing table (cost, fertilizer, land prep/suitability, pruning, nursery, DBH, survey, weeding, spraying, harvest), filtered to `submitted`/`under_review`. Backed by the single decision function `app.decide_record(module, id, decision, reason)`.
- **`v_block_cost_summary`** (`0017`) — cost and cost-per-ha per block, **approved transactions only**; `cost_per_ha` is deliberately NULL (not 0) when area is unknown.
- **`v_budget_vs_actual`** (`0017`, redefined in `0018`) — actual vs budget per fiscal period × cost category × scope, with utilisation % and `is_over_budget`.
- **`v_spend_by_category`** (`0024`) — approved spend rolled up by hierarchical cost category / sub-category, isolating overhead.
- **`v_seedling_stock`** (`0017`) — per-batch live/dead/damaged from the latest *approved* nursery inspection (`LATERAL … LIMIT 1`).

Views are whitelisted in `report_allowed_views` and referenced by `report_definitions` rows (query-driven reports, not hardcoded pages) — `RPT-FINANCIAL` is live; `RPT-OPERATIONAL`/`RPT-SUSTAINABILITY` were seeded as `is_stub = true` (sustainability was un-stubbed in `0026` once estimate coefficients existed).

### Core ER overview

```mermaid
erDiagram
  companies   ||--o{ estates : has
  companies   ||--o{ users : has
  estates     ||--o{ divisions : has
  estates     ||--o{ blocks : has
  blocks      ||--o{ plots : has
  blocks      ||--o{ block_boundary_versions : versions
  plots       ||--o{ plot_crop_layers : layers
  crops       ||--o{ plot_crop_layers : in
  blocks      ||--o{ activities : on
  activities  ||--o| activity_emissions : yields
  emission_factors ||--o{ activity_emissions : uses
  blocks      ||--o{ cost_transactions : incurs
  companies   ||--o{ carbon_runs : owns
  carbon_runs ||--o{ carbon_run_blocks : snapshots
  blocks      ||--o{ carbon_run_blocks : covers
```

### Notable honesty / scaffold flags

- `master_items`, `emission_factors`, and `allometric_coefficients` are **structurally complete but value-empty or estimate-only** by design; `app.check_production_readiness()` surfaces unvalidated coefficients, uncited factors, undefined fiscal periods, demo companies (`companies.is_demo`), and passwordless login left switched on (`app.auth_settings.stub_login_enabled`) as production blockers.
- `fertilizer_schedules` is a "reference + schedule" table, not a rules engine (a phase-2 TODO). Custom report builder UI over `report_definitions`/`report_definition_fields` is likewise marked phase 2.
- `price_list` is explicitly noted as a single point of failure lacking historical versioning ("versioning menyusul di technical meeting").

## Security Model & RLS

AgroVision treats the PostgreSQL database — not the Next.js layer — as the authoritative security boundary. Every tenant-isolation, role-separation, and append-only rule is enforced by database privileges and Row-Level Security (RLS) policies, so that even a bypassed application check (or a Server Action invoked directly by POST) cannot read or mutate another tenant's data. The application layer is defense-in-depth on top of this, not the primary gate.

### 1. The app never connects as a superuser

`src/lib/db.ts` connects through a single `pg.Pool` using `DATABASE_URL`, which points at the least-privilege login role `app_user` (a member of `app_rw`). This is load-bearing: append-only and RLS are enforced by *revoking* privileges from `app_rw`, and a superuser bypasses RLS and REVOKE entirely. The module comment states this explicitly — connecting as `postgres` would make the entire security layer inert and cause tests to *false-pass*. The role itself is provisioned out-of-band by `db/bootstrap-role.mjs` (run once per environment as superuser), which creates `app_user`, grants it `app_rw`, then re-applies privilege revocations (see §6).

Two DB roles exist: `app_rw` (the application) and `app_ro` (read-only, e.g. reporting). Neither is a superuser.

### 2. `withRls` — transaction-local RLS context

RLS policies read three request settings: `app.current_user_id`, `app.current_role`, `app.current_company_id`. `withRls(ctx, fn)` in `src/lib/db.ts` opens a transaction and sets them via **parameterized** `set_config(..., true)` — the trailing `true` makes each setting transaction-local, so it is discarded on `COMMIT`/`ROLLBACK` and never leaks to another request sharing the same pooled connection:

```ts
await client.query("BEGIN");
await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
await client.query("SELECT set_config('app.current_role', $1, true)", [ctx.role ?? "viewer"]);
await client.query("SELECT set_config('app.current_company_id', $1, true)", [ctx.companyId ?? ""]);
```

Values are passed as bind parameters, not interpolated, so context cannot be injected. Critically, `withRls` **fails closed**: if `ctx.userId` is missing it throws before touching the DB. The comment explains why this matters — with no context, RLS silently returns *zero rows without error*, which looks like "no data yet" rather than a bug. The SQL helpers `app.current_user_id()`, `app.current_company_id()`, and `app.current_role_name()` (defined in `0013_rls.sql`) read these settings back with `NULLIF(current_setting(..., true), '')`, so an empty/absent setting resolves to NULL.

There is a deliberately conspicuously-named escape hatch, `queryWithoutRlsContext()`, used only for pre-session work (login resolution and reading non-RLS tables) via SECURITY DEFINER functions — see §5.

### 3. Session layer

`src/lib/session.ts` implements HMAC-signed, `httpOnly` cookies (`agrovision_session`, 12-hour expiry). The cookie stores the Identity Platform subject (`externalId`), **not** the internal UUID — partly to survive the future JWT migration, and partly because `app.users` is itself RLS-closed (see §5). `decode()` verifies the HMAC with a length-check before `timingSafeEqual` (which throws on unequal lengths). Every request re-verifies against the DB via `app.resolve_session()`: the cookie proves "who," never "what you may do," so a deactivated user or changed role takes effect immediately. The selected `companyId` is re-checked against `app.session_companies()` on every load, so a tampered cookie cannot select an inaccessible entity.

`requireRole(...allowed)` gates Server Actions in the app layer; its own comment notes that UI-level authorization is never sufficient because actions are POST-reachable, and that DB RLS is the second layer that holds even if the check is skipped.

**Identity verification (B-27, migration 0057).** `resolveLoginWithIdToken()` verifies a Google Identity Platform ID token before any cookie is issued: `alg` must be `RS256` (rejecting both `alg:none` and the HS256 confusion attack, where the *public* certificate is used as an HMAC secret), the signature must verify against the `kid`'s certificate from Google's [x509 endpoint](https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com) (cached per its own `Cache-Control`, refreshed once on an unknown `kid` because Google rotates keys), `iss`/`aud` must both bind to the configured project (otherwise a valid token from *any* Firebase project would be accepted), and `exp`/`iat`/`auth_time` are checked with a 60-second clock skew. Claims are read only *after* the signature verifies. No new dependency: `node:crypto` only, which also lets `scripts/verify-idtoken.mjs` import the module directly and prove each rejection with self-minted keys.

Provisioning is deliberately separate from authentication: a verified token whose `sub` matches no `app.users.external_id` is refused with "belum terhubung ke pengguna AgroVision". Linking a person to an Identity Platform account is a super_admin act (`docs/12-deploy-gcp.md` §9), not a side effect of logging in.

**The stub login is gated in three places, one of which is the database.** `app.lookup_login_email` is dropped; its replacement `app.lookup_login_stub()` raises `42501` unless `app.auth_settings.stub_login_enabled` is true. That table is registered in `app.privilege_revocations` (`INSERT, UPDATE, DELETE` revoked from `app_rw`), so a compromised or careless application layer cannot switch passwordless login on — only a superuser connection (the dev/demo seeds) can. `app.check_production_readiness()` no longer keys on the *existence* of a function, but on that switch plus a belt-and-braces clause should the legacy function ever reappear.

### 4. Tenant isolation and the three-policy pattern

Tenant scope is defined by `app.company_in_scope(p_company_id)` (`0014_core_fix.sql`), which checks membership in `app.user_company_access` for the current user AND honors the optional selected-entity filter (`current_company_id() IS NULL` = "all my entities" mode; set = one selected entity). For performance, `0018` introduced `app.accessible_company_ids()` — an inlinable `SETOF uuid` used as `company_id IN (SELECT app.accessible_company_ids())` so the planner hashes it once per query instead of calling the function once per row (finding #31: a 6–7x scan cost).

The mature pattern (established across `0018` and `0025`) layers three policies on writable tenant tables:

1. **`<table>_tenant`** — PERMISSIVE, the base tenant filter (`company_id IN (SELECT app.accessible_company_ids())`, or an `EXISTS` join to the parent for child tables that derive tenancy through `blocks`/`forms`/`cert_programs`/etc.). PERMISSIVE policies OR together to *grant* visibility.
2. **`<table>_viewer_readonly`** — RESTRICTIVE `FOR ALL`, `WITH CHECK (COALESCE(app.current_role_name(),'viewer') <> 'viewer')`. RESTRICTIVE policies AND together, so this denies all writes to `viewer` regardless of any PERMISSIVE grant.
3. **`<table>_role_split`** — RESTRICTIVE `FOR UPDATE`, enforcing creator/approver separation (see §7).

RESTRICTIVE-on-`FOR ALL` has a sharp edge the codebase learned the hard way: `0018 §5` made `report_builtin_protect` a `RESTRICTIVE FOR ALL`, whose `USING` clause also filters `SELECT`, accidentally *hiding* the three built-in reports from everyone. `0020` split it into per-command `FOR UPDATE/DELETE/INSERT` policies and documents the lesson: to restrict only writes, never use `FOR ALL`.

RLS coverage is data-driven. `0018 §1` enumerates every table and maps it to how tenancy is derived; anything intentionally global (IPCC reference tables, standards, etc.) is recorded in `app.rls_exempt_tables` with a reason, so "no RLS" is a logged decision rather than an oversight — the root cause of the earlier `0014` leak, where RLS was enabled on a hand-listed subset and the unlisted tables were wide open. All RLS tables also get `FORCE ROW LEVEL SECURITY` so the table owner is subject to policies too.

### 5. SECURITY DEFINER functions that self-gate

A bootstrap deadlock exists: `app.users` is RLS-closed, but you need a user context to read it. The resolution is a small set of narrow SECURITY DEFINER functions, each with `SET search_path = app, pg_catalog` (minimized to prevent search-path hijacking), `REVOKE ALL ... FROM PUBLIC`, and an explicit `GRANT EXECUTE ... TO app_rw`:

- `app.resolve_session(external_id)` and `app.session_companies(user_id)` — the only doors into identity, keyed on the JWT subject.
- `app.lookup_login_stub(email)` — development only, and self-gating: raises `42501` unless `app.auth_settings.stub_login_enabled`. Replaced `app.lookup_login_email`, which migration 0057 dropped when ID-token verification landed (B-27).
- `app.grant_company_access` / `app.revoke_company_access` (`0018 §2`) and `app.grant_estate_access` / `app.revoke_estate_access` (`0025 §4`) — the *only* way to write authorization data. Each **self-gates**: it raises unless `app.current_role_name() = 'super_admin'`, and `grant_company_access` additionally refuses to grant a company the caller cannot themselves access ("super_admin hanya boleh memberi akses ke entitas yang ia sendiri akses"). Direct `INSERT/UPDATE/DELETE` on `user_company_access`/`user_estate_access` is revoked from `app_rw`, because if the app could write those tables, every tenant policy (all derived from them) would collapse — this was finding #2/#6, CRITICAL.
- `app.publish_emission_factor(...)` (`0018 §4`) — SECURITY DEFINER, self-gates to `approver`/`super_admin`, requires a session (`v_actor`), validates provenance/value/name, forbids backdating the validity timeline, and sets `approved_by` **from the session, not a caller parameter** (previously forgeable).

The adversarial suite confirms `resolve_session` and `session_companies` work with *no* context while `SELECT count(*) FROM app.users` still returns 0 in that same contextless state.

### 6. Append-only via privilege revocation, with a single source of truth

Append-only isn't developer discipline — it's `REVOKE UPDATE, DELETE` from `app_rw` on `audit_log`, `evidence_files`, `emission_factors`, `evidence_verifications` (and `DELETE` on `master_types`, and `INSERT/UPDATE/DELETE` on the two authorization tables). The trap `0019` fixed: `bootstrap-role.mjs` re-runs `GRANT ... ON ALL TABLES`, which *restores* revoked privileges. When the revocation list lived in two places (migration + script), the script's copy drifted and silently reopened the CRITICAL authorization hole. `0019` made the list **data**: table `app.privilege_revocations` is the single source of truth, read by `bootstrap-role.mjs` (which re-applies every revocation *after* the blanket grant and then verifies) and checked by the test suite. New append-only tables must be registered there.

### 7. Creator/approver separation and `rejection_reason`

`0018 §9` added `ct_role_split` on `cost_transactions`; `0025 §3` generalized the same RESTRICTIVE `FOR UPDATE` policy to every record table (`fertilizer_applications`, `land_preparations`, `land_suitability_assessments`, `pruning_records`, `nursery_inspections`, `dbh_measurements`, `survey_submissions`). The policy exploits that on `UPDATE`, `USING` tests the *old* row and `WITH CHECK` the *new* row:

```sql
USING (app.current_role_name() IN ('approver','super_admin')
       OR (created_by = app.current_user_id()
           AND approval_status IN ('draft','rejected')))
WITH CHECK (app.current_role_name() IN ('approver','super_admin')
       OR approval_status IN ('draft','submitted'))
```

So a creator can only touch their own draft/rejected records and can only move them into draft/submitted — they cannot approve their own work or rewrite an already-approved row (finding #27). `app.decide_record(module, id, decision, reason)` (`0025 §2`) is the single cross-module decision route; it is intentionally SECURITY *INVOKER* so the role-split policies still gate it, and it merely tidies routing. It requires a non-empty `reason` for rejections. That rule is also enforced at rest: `0018 §10` adds a `..._rejection_needs_reason` CHECK constraint (`approval_status <> 'rejected' OR rejection_reason present`) on all eight approval tables — previously only 2 of 11 enforced it (finding #18).

### 8. Cross-tenant integrity via composite FKs

Rather than trigger-based checks, `0018 §6–§7` enforce that a cost transaction's block, fiscal period, and budget scope all belong to the *same* company, using composite unique indexes (e.g. `blocks (company_id, id)`) referenced by composite foreign keys (`ct_block_same_company`, `ct_period_same_company`, `budgets_*_same_company`). The engine now rejects "tenant A's money landing on tenant B's block" (finding #21) without any application code.

### 9. Health-check functions

Three functions turn "forgot to secure X" from a silent hole into a visible, testable failure (all granted to `app_rw`/`app_ro`):

- `app.check_rls_coverage()` (`0020`) — returns any `app` table with RLS off and not exempt, any RLS-on table with no policy (which silently denies everything), and any view missing `security_invoker=true` (which would bypass the caller's RLS). Must return **zero rows**.
- `app.check_privilege_revocations()` (`0019`) — returns any revocation from the ledger that `app_rw` still holds. Must return zero rows.
- `app.check_production_readiness()` (`0021`, extended by `0024`, rewritten by `0057`) — aggregates blocking items (`auth_settings.stub_login_enabled` still on, the legacy `lookup_login_email` function reappearing, any RLS-coverage leak, any privilege leak, any `is_demo` company still loaded) and non-blocking ones (allometric coefficients pending expert validation, emission factors without citation, no fiscal periods defined). Rows with `blocking = true` must be zero before a public deploy.

The `security_invoker` requirement is not theoretical: `0035` is a one-line fix for a regression where `CREATE OR REPLACE VIEW v_pending_approvals` in `0034` dropped the option, making the cross-module approval inbox leak across tenants until re-set.

### 10. Adversarial RLS test suite

`db/verify-adversarial.mjs` is the companion to the happy-path `db/verify.mjs` and exists specifically because the original tests false-passed twice (once by running as superuser, once by only testing budget scope `'block'`). It connects as **`app_user`**, sets context per-request with `set_config`, and asserts that operations *fail*. It covers: self-granting cross-tenant access (both direct INSERT and via the gated function), tenant A being unable to see any of tenant B's blocks/users/companies, cross-tenant composite-FK rejection, `publish_emission_factor` role-gating / backdating / negative-value / forged-`approved_by`, the `v_budget_vs_actual` fan-out bug at company and estate scope, creator being unable to UPDATE approved rows (asserting `rowCount === 0`, since RLS filters rather than throwing), viewer read-only enforcement, built-in report / system master-type protection, global-row and duplicate protection, `rejection_reason` enforcement, the privilege-revocation ledger holding, and the contextless session-bootstrap path. It also runs `check_rls_coverage()` and `check_privilege_revocations()` inline and asserts both return zero rows. Fixtures set up two tenants (A/B) and four A-side roles (creator/approver/viewer/super_admin) plus a tenant-B user; the whole run executes inside a transaction that is rolled back. Test invocation is documented in [Operations & Testing](#verification-suites).

## Functional Modules & Workflows

All screens live under `src/app/(app)/` (Next.js route group, Indonesian route segments) and read/write through thin repositories in `src/lib/repo/*`. Every repo call goes through `rlsQuery` / `withRls` (`src/lib/db.ts`), so Postgres Row-Level Security is enforced on every query — the TypeScript layer does almost no business logic, it shapes rows and defers aggregation to SQL views/functions. A recurring, deliberate convention: **unknown values render as em-dash, never `0`** ("not yet computed" ≠ "computed to zero"), which is what keeps the financial screens honest before harvest data exists (the full doctrine is in [Agronomic Methodology & Data-Integrity Doctrine](#the-data-honesty-doctrine)).

### The record lifecycle (shared by most modules)

Operational and financial records share an `approval_status` state machine: rows are inserted as `draft` → `submitted` → `approved` / `rejected` (with `rejection_reason`). In code this is `create*()` (writes `'draft'`), `submitOpRecord()` / `submitExpenditure()` (`draft|rejected → submitted`), and the cross-module `decideRecord()` (`submitted|under_review → approved|rejected`). The enum is `app.record_status`. This lifecycle is **live** for expenditures and all farm activities.

### Dashboards — live

- **Operational** (`dashboard/page.tsx`): KPIs for approved spend, pending-approval count, block count, over-budget alerts, recent expenditures. Reads `totalApprovedSpend`, `listPendingApprovals`, `listBlocks`, `budgetVsActual`, `listExpenditures`. A code comment records that a former dummy version showed 12 fabricated KPIs (planting progress, survival rate) that were removed.
- **Financial** (`dashboard/financial/page.tsx`): reflection-model KPIs — allocated budget, approved spend, revenue, P&L, spend-by-component. Explicitly labels itself a *refleksi*; **revenue and laba/rugi are `null` (em-dash) until approved harvest exists** — not fabricated.
- **Sustainability** (`dashboard/sustainability/page.tsx`): aggregates latest carbon run (net emitter/sink), organic certification progress, K1–K7 land-history evidence. Carries the IPCC Tier-1 "needs validation" banner and a **Deforestation "coming soon" teaser** (dashed card).

### Pre-Farming

- **Land Suitability** (`operasional/kesesuaian-lahan`, repo `suitability.ts`) — **live**. Real classifier implementing the BBSDLP MATCHING method + **Liebig law of the minimum**: `matchClass()` finds the best class (S1→N) whose band matches each characteristic, then `classify()` sets the block class to the **worst** characteristic class; subclass = worst class + limiting-factor symbols (e.g. `S3rc`). Criteria bands are **data**, read from `app.land_suit_criteria` per crop (`classifyBoth` runs DURIAN + COCONUT). Results saved to `app.land_suitability_assessments` as `draft` with `suit_class`/`subclass`/`limiting`/`params` JSON. (Note: `operational.ts` also carries a legacy `createLandSuitability` with `score_durian`/`score_coconut` columns; the classifier path is the active one.) Methodology detail in [Agronomic Methodology](#land-suitability--bbsdlp-matching--liebigs-law-of-the-minimum).
- **Land Preparation** (`operasional/persiapan-lahan`) — **live**. `createLandPreparation` → `app.land_preparations` (`soil_ph`, `planting_hole_count`, `effective_area_ha`, `status::app.prep_status`), draft→submit lifecycle.
- **Seedling / Nursery** (`nursery/page.tsx`, `listSeedStock`) — **live read**. Stock + survival % computed from view `app.v_seedling_stock` over `seed_batches` / `nursery_inspections`; `nursery_inspection` records participate in the approval inbox.

### Block & Map — live

`operasional/blok` (repo `blocks.ts`). Server-paginated block registry (designed for ~3,300 blocks, `listBlocks`), `createBlock` with optional GeoJSON (blocks may exist before boundaries are digitized; overlaps are **reported for review via `app.detect_block_overlaps`, not rejected**). PostGIS `blocksGeoJson` / `plotsGeoJson` emit FeatureCollections with `ST_SimplifyPreserveTopology` for the MapLibre map.

### Farm Activities — live, full lifecycle

`aktivitas/weeding`, `aktivitas/spraying`, `aktivitas/panen`, plus fertilizing and pruning under `operasional/`. Repo `operational.ts` unifies **reads** across `fertilizer_applications`, `land_preparations`, `land_suitability_assessments`, `pruning_records`, `weeding_records`, `spraying_records`, `harvest_records` via one `TABLES` map + `listOpRecords`; **inserts are per-module** (`createFertilizerApplication`, `createWeedingRecord`, `createSprayingRecord`, `createHarvestRecord`, `createPruningRecord`). Weeding/spraying/harvest tables were added in migration `0034`. `harvest_records` (`crop_code`, `quantity_ton`, `grade`) is the **revenue source** for the accounting reflection.

### Agri-Input — live catalog

`agri-input/chemical` and `agri-input/equipment` (repo `agriInput.ts`). Chemical inventory over `app.agri_input_chemicals` (stock, reorder level, organic flag, embedded recommendation phase/note) with `listChemicalOptions` feeding the spraying dropdown; equipment over `app.agri_input_equipment` (purchase price, fuel type/consumption). Create + list only (no approval lifecycle on the catalog itself).

### Field Survey / Adoption & Observation — schema-driven, partially live

`survei/` + `survei/[formId]` (in `operational.ts`). **Live path**: `listPublishedForms` → `getSurveyForm` renders a published `app.forms` + `form_versions` + `form_fields` schema dynamically; `submitSurvey` writes one `app.survey_submissions` row + typed `app.submission_values` (`value_text`/`value_num`/`value_bool`/`value_date` chosen by `field_type`). Seeded forms include `SRV-BIBIT` (Survei Kondisi Bibit) and `SRV-ADOPT` (Adoption & Observation). Submissions are inserted as `submitted` and flow to the approval inbox. **Scaffold**: the form **builder** (authoring schemas) is fase 2 — the UI states this and the forms list is effectively read-only.

### Sustainability

- **Carbon Accounting** (`keberlanjutan/karbon`) — **live compute, unvalidated coefficients**. Numbers are computed in-database by `app.generate_carbon_run` from block area × DBH measurements × IPCC reference factors; the page cites IPCC 2006 & 2019 Refinement Vol. 4/Vol. 2. `carbonNeedsValidation()` counts `allometric_coefficients WHERE requires_validation` and drives a mandatory **"Tier 1 default, not MRV-grade, needs expert validation"** banner. Reads `carbon_runs`, `carbon_run_blocks`, `emission_factors`.
- **Organic Certification registry** (`keberlanjutan/sertifikasi`) — **live**. `organicRegistry` splits `organic_items` into standards vs K1–K7 evidence with per-company status from `organic_tracking`; `setOrganicStatus` is an idempotent upsert. The same page also drives the broader **compliance/permit registry** (`compliance_items` groups A–H + `compliance_tracking`, `setComplianceStatus`). A separate classic cert model exists in `sustainability.ts` (`cert_programs`, `cert_assessments`, `certificates` with active/expiring/expired/revoked state, `capa`, `cert_findings`).
- **Traceability** — **two surfaces**: `keberlanjutan/traceability` is live and renders the real chain `seed_batches → seed_distributions → blocks` (`traceSeedBatches`); the code comments note there is **no harvest chain yet**. The top-level `traceability/page.tsx` is an explicit `PlaceholderPage` (backward/forward tracing to be built).
- **Deforestation** — **coming soon** (teaser only on the sustainability dashboard).

### Accounting reflection model — live (cost side), pending harvest (revenue side)

Repo `pricing.ts`, page `costing/refleksi`. No manual cost entry: reflected cost = **Σ (real operational volume × catalog rate)** from `app.price_list`, where each cost row's `driver` maps to a volume query in `DRIVER_SQL` (`block_area_ha`, `landprep_area_ha` (approved), `seedling_qty`, `fertilizer_qty` (approved)). Revenue = approved `harvest_records` tonnage × per-crop revenue rate (`REV-DUR-A`, `REV-COCO`). `balanceIdr` is **`null` until an approved harvest exists**. `setPriceRate` edits catalog rates (approver/super_admin). Separately, `costing/pengeluaran` + `costing/anggaran` are a full expenditure/budget module (`cost_transactions`, `budgets`, `fiscal_periods`, views `v_block_cost_summary`, `v_budget_vs_actual`, `v_spend_by_category`) with mandatory evidence upload, stored via Cloud Storage (`putEvidence()`/`getSignedReadUrl()` in `storage.ts`; falls back to local disk when `GCS_BUCKET_EVIDENCE` is unset) and linked to its transaction via `evidence_links`, viewable from a short-lived signed URL at `/api/evidence/[id]`.

### Reports — definition-driven, one stub

`laporan/{operasional,keuangan,keberlanjutan}` (repo `reports.ts`). Reports are assembled from stored `report_definitions` + `report_definition_fields` (bands: kpi/chart/table), not hardcoded pages. `runReport` interpolates `base_view` into SQL but **only after checking it against the `app.report_allowed_views` whitelist** (defense against a malicious definition row). The report **builder** is fase 2. `pnlSummary` (break-even) is a deliberate **stub**: `revenueIdr` and `breakEvenMonths` return `null` because there is no harvest/revenue yet — computing break-even now would fabricate a denominator.

### Cross-module Approval inbox — live

`approval/page.tsx`, repo `costing.ts`. `listAllPending` reads the UNION view `app.v_pending_approvals` and `decideRecord` routes decisions through a single SQL function `app.decide_record(module_key, id, decision, reason)`. Covers **11 modules**: `cost_transaction`, `fertilizer_application`, `land_preparation`, `land_suitability_assessment`, `pruning_record`, `nursery_inspection`, `dbh_measurement`, `survey_submission`, `weeding_record`, `spraying_record`, `harvest_record` (last three added in `0034`). An older single-module `listPendingApprovals` (expenditures only) also still exists and feeds the operational dashboard.

### Master Data — live

`pengaturan/master-data` (repo `master.ts`). All dropdowns are database-driven (`master_types` / `master_items`) — adding an item as super_admin appears app-wide without redeploy (the project's acceptance test 1). Hierarchical cost categories: `listCategoryOptions` returns **leaves only** with breadcrumb labels ("Tenaga Kerja › Upah Harian"); `listParentCategoryOptions` returns parents for budgeting. Items are **deactivated, never deleted** (may be referenced by transactions). `fertilizer_types` (N-P₂O₅-K₂O) is a dedicated table. Fertilizer **recommendations** (`fertilizer.ts`, `fertilizer_recommendations`, idempotent per block×crop×phase, `is_provisional` flag) feed the pemupukan screen.

### Users & Access — live (read + grant)

`pengguna/page.tsx` (`listUsers` in `master.ts`) lists users with role and estate-access count. Estate-scoped access grant/revoke lives in SQL functions from `0025` (`user_estate_access`, `user_company_access`), and roles (`super_admin`, `approver`, writer/viewer) gate approval actions both in Server Actions and in RLS policies.

## GCP Infrastructure & Deployment

> **Status note.** The application is written *for* Google Cloud but is not yet wired to it. `next.config.ts` targets Cloud Run, `.env.example` documents the Cloud SQL socket string, and `src/lib/storage.ts` has a Cloud Storage code path — but there is **no `Dockerfile`, no `cloudbuild.yaml`, and no Terraform in the repo today**, and the GCS backend in `putEvidence()` is an unimplemented `TODO` that throws if `GCS_BUCKET_EVIDENCE` is set. This section documents (a) what the code already assumes about GCP and (b) the production architecture those assumptions imply, clearly labelling which pieces are code-ready versus still to be built.

### What the codebase already commits to

| Signal | File | Implication for GCP |
|---|---|---|
| `output: "standalone"` | `next.config.ts` | Ships a self-contained `.next/standalone/server.js`; ideal for a slim Cloud Run container. |
| Dockerfile note: `cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/` | `next.config.ts` comment | The standalone tracer does **not** copy `public/` or `.next/static/`; the container image must copy them explicitly or CSS/JS/images/map tiles 404 at runtime. |
| `serverActions.bodySizeLimit: "8mb"` | `next.config.ts` | Server-Action request bodies (evidence photos / invoice scans) up to 8 MB; the Cloud Run request size limit and any load-balancer body cap must be ≥ this. |
| `DATABASE_URL` = `app_user` (member of `app_rw`) | `.env.local`, `src/lib/db.ts` | The **runtime** connects as a least-privilege role; RLS + append-only are enforced by privilege revocation on this role. |
| `MIGRATION_DATABASE_URL` = `postgres` (superuser/owner) | `.env.local`, `db/migrate.mjs`, `db/bootstrap-role.mjs` | **Migrations and role bootstrap** connect as the schema owner. The app "never has DDL rights" (comment in `migrate.mjs`). |
| `postgres://USER:PASS@/agrovision?host=/cloudsql/PROJECT:asia-southeast2:INSTANCE` | `.env.example` | Cloud Run → Cloud SQL over the built-in connector's **Unix socket**, region `asia-southeast2` (Jakarta). |
| `GCS_BUCKET_EVIDENCE`, `storage_path text -- gs://...` | `.env.example`, `db/migrations/0010_evidence.sql` | Evidence files are meant to live in a Cloud Storage bucket; the DB stores the `gs://` key, sha256, size, MIME, and EXIF geometry. |
| `SESSION_SECRET` (min 32 chars) | `.env.local`, `src/lib/session.ts` | HMAC session-signing secret; a Secret Manager entry in production. |
| `AUTH_MODE`, `IDENTITY_PLATFORM_PROJECT_ID`, `IDENTITY_PLATFORM_API_KEY` | `.env.example`, `src/lib/auth/config.ts`, `cloudbuild.yaml` | Login mode (B-27). Unset = `identity-platform`, which needs both Identity Platform values; the API key is the project's public Web API key and is passed to the browser as a prop (deliberately **not** `NEXT_PUBLIC_*`, so one image serves every environment). `AUTH_MODE=stub` is refused when `NODE_ENV=production`. |
| `postgis/postgis:16-3.4` | `docker-compose.yml` | Local parity with the Cloud SQL target: **PostgreSQL 16 + PostGIS 3.4** (extensions in `0001_extensions.sql`: `postgis`, `btree_gist`, `pg_trgm`, `citext`). |
| `public/tiles/ortho/{z}/{x}/{y}.png` (6,061 tiles, z14–z19) + `public/overlays/polygon-block-real.geojson` | `public/` | A static XYZ **orthophoto tile pyramid** and a block-boundary overlay, currently served as Next static assets. (Note: `BlockMap.tsx` presently draws the EOX Sentinel-2 and OSM raster basemaps from external hosts; the local `ortho` pyramid is shipped but not yet referenced by the map component.) |

### The two-role DB pattern → two service accounts, two secrets

The single most important design fact for GCP mapping: the app already separates **two Postgres identities** (the security rationale is in [Security §1 and §6](#security-model--rls)).

```
db/migrate.mjs        → MIGRATION_DATABASE_URL  → owner/superuser (DDL, ledger writes)
db/bootstrap-role.mjs → MIGRATION_DATABASE_URL  → creates app_user, GRANT app_rw
src/lib/db.ts (Pool)  → DATABASE_URL            → app_user ∈ app_rw (DML only; UPDATE/DELETE
                                                   revoked on audit_log, evidence_files,
                                                   emission_factors — see 0013_rls.sql)
```

This maps **cleanly onto two Cloud Run identities and two Secret Manager secrets**:

- **Runtime service account** (`sa-agrovision-run`) — attached to the Cloud Run *service*; can read only the `app_rw` DB password secret, the session secret, and write the evidence bucket. Cannot run DDL.
- **Migration service account** (`sa-agrovision-migrate`) — attached to a Cloud Run *Job* that runs `db/migrate.mjs`; can read only the owner/superuser DB secret. Never serves traffic.

Never merge these. Giving the request-serving container the owner credential would let a compromised request bypass every RLS/append-only guarantee the schema is built on.

### Target production architecture (region `asia-southeast2`, Jakarta)

```mermaid
flowchart TB
    user[Users / field surveyors]

    subgraph edge[Global edge]
      lb[HTTPS External Application<br/>Load Balancer]
      cdn[Cloud CDN]
    end

    user -->|HTTPS| lb
    lb --> cdn

    subgraph region[Region: asia-southeast2 Jakarta]
      direction TB

      subgraph run[Cloud Run]
        svc["Service: agrovision-web<br/>standalone next server.js<br/>min-instances=1, autoscale<br/>SA: sa-agrovision-run app_rw"]
        job["Job: agrovision-migrate<br/>node db/migrate.mjs<br/>SA: sa-agrovision-migrate owner"]
      end

      sql[("Cloud SQL for PostgreSQL 16<br/>+ PostGIS 3.4<br/>Private IP, automated backups + PITR")]

      subgraph gcs[Cloud Storage]
        bkev[["Bucket: evidence uploads<br/>private, gs:// keys in DB"]]
        bktiles[["Bucket: orthophoto XYZ tiles<br/>+ static _next assets"]]
      end
    end

    ar[(Artifact Registry<br/>Docker repo)]
    sm[[Secret Manager<br/>app_rw pwd · owner pwd · SESSION_SECRET]]
    obs[Cloud Logging /<br/>Monitoring / Error Reporting]

    cdn -->|dynamic| svc
    cdn -->|cached tiles + static| bktiles
    svc -->|Unix socket /cloudsql/...| sql
    job -->|Unix socket /cloudsql/...| sql
    svc -->|signed URLs / read-write| bkev
    ar -->|image| svc
    ar -->|image| job
    sm -.->|mounted at runtime| svc
    sm -.->|owner secret only| job
    svc --> obs
    job --> obs
```

**Component decisions**

- **Cloud Run (service `agrovision-web`)** — runs the containerized standalone server. Set `--min-instances=1` (avoid cold starts and pg pool re-warm on a low-traffic B2B app), `--max-instances` per budget, `--concurrency=80`, `--memory=512Mi–1Gi`, `--cpu=1`. Keep `DATABASE_POOL_MAX` (default 10 in `db.ts`) low enough that `max-instances × pool_max` stays under the Cloud SQL connection limit.
- **Cloud SQL for PostgreSQL 16 + PostGIS 3.4** — enable the `postgis`, `btree_gist`, `pg_trgm`, `citext` extensions (all `CREATE EXTENSION IF NOT EXISTS` in `0001_extensions.sql`). Use **Private IP** + the built-in Cloud Run ↔ Cloud SQL connector, which mounts the instance at `/cloudsql/PROJECT:asia-southeast2:INSTANCE` — exactly the `?host=/cloudsql/...` socket form in `.env.example`, so **no code change** is needed vs local TCP. (The Serverless VPC Access / Auth Proxy path is the alternative if you standardize on private-IP networking; the socket connector is simpler and already assumed by the connection string.)
- **Artifact Registry** — a Docker repo (e.g. `asia-southeast2-docker.pkg.dev/PROJECT/agrovision/web`) holding the built image, consumed by both the service and the migration job (same image, different entrypoint/command).
- **Secret Manager** — three secrets: `db-app-rw-password`, `db-owner-password`, `session-secret`. Injected as env vars: the service gets the first + third; the job gets the second. `bootstrap-role.mjs` already documents "in production, password comes from Secret Manager, not `.env`."
- **Cloud Storage** —
  - *Evidence bucket* (private): target for `putEvidence()`. The current code writes `file://.../.evidence/...` locally; the production path (`@google-cloud/storage → bucket(...).file(key).save(bytes)`) is the documented but **unimplemented** `TODO` in `storage.ts:71-79`. Object key is content-addressed (`kind/companyId/<sha0-2>/<sha256>-<name>`) so re-uploads dedupe. Serve back to users via short-lived signed URLs, not public ACLs.
  - *Tiles/static bucket* (CDN-fronted): host the `public/tiles/ortho` pyramid and, optionally, `_next/static`. Fronting these with **Cloud CDN** offloads the 6,000+ raster tiles and hashed static assets from Cloud Run.
- **HTTPS Load Balancer + Cloud CDN** — a global external Application Load Balancer with a serverless NEG to Cloud Run for dynamic routes and a backend bucket (CDN-enabled) for tiles/static. Managed TLS cert. Ensure the LB request-size limit accommodates the 8 MB Server-Action bodies.
- **IAM least privilege** — as above: `sa-agrovision-run` gets `roles/cloudsql.client`, `roles/secretmanager.secretAccessor` (scoped to its two secrets), `roles/storage.objectAdmin` on the evidence bucket only. `sa-agrovision-migrate` gets `roles/cloudsql.client` + accessor on the owner secret only. Neither is a project-level editor.
- **Backups & recovery** — Cloud SQL **automated daily backups + point-in-time recovery (PITR)** via WAL retention; this is the real durability guarantee behind the schema's append-only audit design.
- **Observability** — Cloud Logging captures container stdout/stderr (the migrate runner and `withRls` failures log there), Cloud Monitoring for Cloud Run + Cloud SQL metrics/alerts, Error Reporting for unhandled exceptions.

### The container image (needs to be authored)

No `Dockerfile` exists yet. It must honor the `next.config.ts` comment — the standalone output omits `public/` and `.next/static/`:

```dockerfile
# --- build stage ---
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build            # produces .next/standalone + .next/static

# --- runtime stage ---
FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public                 # NOT auto-included
COPY --from=build /app/.next/static ./.next/static     # NOT auto-included
COPY --from=build /app/db ./db                         # migrate.mjs + migrations for the Job
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

The migration **Job** reuses this image but overrides the command to `node db/migrate.mjs` (the `db/migrations/*.sql` files and `db/migrate.mjs` are copied in above). `pg` is a runtime dependency, so it is present in the standalone bundle.

### Deploy / migration runbook

Prereqs (one-time per environment): create the Cloud SQL instance with PostGIS, run `db/bootstrap-role.mjs` once against `MIGRATION_DATABASE_URL` to create `app_user` and `GRANT app_rw` (intentionally *not* a migration — role/password are per-environment), and load the three secrets.

```bash
PROJECT=your-project
REGION=asia-southeast2
REPO=asia-southeast2-docker.pkg.dev/$PROJECT/agrovision
INSTANCE=$PROJECT:$REGION:agrovision-pg

# 1. Build + push image to Artifact Registry
gcloud builds submit \
  --tag $REPO/web:$(git rev-parse --short HEAD)

# 2. Run migrations FIRST, as the owner identity (Cloud Run Job)
#    (mirrors: npm run db:migrate → node --env-file db/migrate.mjs)
gcloud run jobs deploy agrovision-migrate \
  --image $REPO/web:$(git rev-parse --short HEAD) \
  --region $REGION \
  --service-account sa-agrovision-migrate@$PROJECT.iam.gserviceaccount.com \
  --set-cloudsql-instances $INSTANCE \
  --set-secrets MIGRATION_DATABASE_URL=db-owner-url:latest \
  --command node --args db/migrate.mjs
gcloud run jobs execute agrovision-migrate --region $REGION --wait

# 3. Deploy the request-serving revision, as app_rw (least privilege)
gcloud run deploy agrovision-web \
  --image $REPO/web:$(git rev-parse --short HEAD) \
  --region $REGION \
  --service-account sa-agrovision-run@$PROJECT.iam.gserviceaccount.com \
  --set-cloudsql-instances $INSTANCE \
  --min-instances 1 --max-instances 10 --concurrency 80 \
  --set-secrets \
      DATABASE_URL=db-app-rw-url:latest,\
      SESSION_SECRET=session-secret:latest \
  --set-env-vars GCS_BUCKET_EVIDENCE=agrovision-evidence,GOOGLE_CLOUD_PROJECT=$PROJECT

# 4. Smoke test
curl -fsS https://<lb-domain>/login            # app responds
gcloud run jobs execute agrovision-migrate \   # ledger check
  --region $REGION --command node --args db/migrate.mjs,--status --wait
# expect: "Tidak ada migrasi tertunda." (all migrations applied, no checksum drift)
```

**Ordering matters:** migrate before deploy so a new revision never serves against a schema it predates. The runner is safe to re-run — it uses the `app.schema_migrations` ledger, applies one file per transaction, refuses to proceed on checksum drift, and reports `FILE HILANG` if repo and DB diverge. A production-readiness gate also exists: `npm run db:check` calls `app.check_production_readiness()` and can be run as a post-deploy Job step.

> **Caveat before enabling GCS in production:** setting `GCS_BUCKET_EVIDENCE` today makes `putEvidence()` **throw** (`storage.ts:71-79`) — the `@google-cloud/storage` client is not yet added as a dependency or wired in. Implementing that upload path (and switching `storage_path` from `file://` to `gs://`) is a required predecessor to turning the env var on.

**Grounding paths:** `next.config.ts`, `.env.local`, `.env.example`, `package.json` (`db:*` scripts), `db/migrate.mjs`, `db/bootstrap-role.mjs`, `src/lib/db.ts`, `src/lib/storage.ts`, `src/lib/session.ts`, `db/migrations/0001_extensions.sql`, `db/migrations/0010_evidence.sql`, `db/migrations/0013_rls.sql`, `docker-compose.yml`, `public/tiles/ortho/`, `public/overlays/polygon-block-real.geojson`, `src/components/map/BlockMap.tsx`.

## Agronomic Methodology & Data-Integrity Doctrine

AgroVision's agronomy is deliberately *conservative and auditable*: every scientific claim traces to a cited method, provisional numbers are labelled provisional, and the platform refuses to fabricate figures where data is absent. This section documents the four methodological engines (land suitability, fertilizer recommendation, organic certification, carbon accounting) and the cross-cutting data-honesty doctrine that governs all of them.

### Land suitability — BBSDLP matching + Liebig's law of the minimum

The reference methodology is documented in `docs/07-kesesuaian-lahan` (a Markdown file despite the extension-less name): the Indonesian national standard *Petunjuk Teknis Evaluasi Lahan* (BBSDLP), specifically the "Kriteria Kesesuaian Lahan untuk Komoditas Pertanian Versi 3.0" for semi-detailed mapping (1:50.000). The doc opens with an honesty caveat — the tabulated bands were gathered from journals *citing* the BBSDLP book, not the primary source, and inter-journal inconsistencies exist (especially durian climate parameters); for formal use it instructs citing Ritung dkk. (2011) or BBSDLP 2019 directly.

Suitability classes are the standard four-band ladder:

| Class | Meaning |
|---|---|
| **S1** | Sangat sesuai (highly suitable, no meaningful limitation) |
| **S2** | Cukup sesuai (moderately suitable; reduces productivity) |
| **S3** | Sesuai marginal (severe limitations; high input) |
| **N** | Tidak sesuai (not suitable) |

The engine lives in `src/lib/repo/suitability.ts`. Its design decision is that **class criteria are data, not code** — bands are read from `app.land_suit_criteria` (JSON `bands` column) joined to `app.crops`, so agronomists can edit thresholds without a code change. The pure logic implements the *matching method under Liebig's law of the minimum* (docs/07 §4.1):

- `matchClass()` finds the **best** class (scanning S1→N) whose band contains the value. Numeric bands use `{min, max}`; categorical bands use `{set: [...]}` (e.g. drainage classes, texture). A value that is present but falls in **no** band → `N` (outside all criteria).
- `classify()` then applies the minimum law: overall class = the **worst** (lowest) class across all assessed characteristics (`RANK` = S1:0 … N:3, reduce to max). The **subclass** is the worst class suffixed with the sorted, de-duplicated limiting symbols — e.g. `S2w,d,a,n` for a block limited by water, drainage, pH and nutrients (matching the worked example in docs/07 §4.2).
- Crucially, if **no** characteristic is assessed (`assessed.length === 0`) it returns `overall: null` — an honest "not yet assessed", not a fabricated S1. This is the data-honesty doctrine expressed in the classifier itself.

`classifyBoth()` runs both configured commodities (`DURIAN`, `COCONUT`) against one parameter set; results persist via `saveSuitability()` into `app.land_suitability_assessments` with `approval_status = 'draft'` (feeding the same approval workflow as other operational records). The module header comment states the doctrine the UI must surface: *"Ini kesesuaian FISIK, bukan kelayakan ekonomi"* — physical suitability is not economic feasibility (docs/07 §4.5 recommends adding R/C, B/C, NPV, IRR before investment decisions). The doc also warns never to mix methods (§4.5): the Simple Limitation Method and the Sys parametric criteria can classify the identical land unit as `N` versus `S3`.

### Fertilizer recommendation — three approaches and a provisional generator

The methodology doc `docs/09-pupuk.md` is a framework for *how to produce* recommendations, not a dose table. Its governing warning: **no valid coconut/durian fertilizer recommendation exists without local data** — literature numbers serve only as (a) rating classes and (b) a starting point. Notably, the leaf critical-value table in §3.3 is **deliberately left blank** — the author refuses to fill it from memory because an error in critical values propagates into every downstream dose.

The doc distinguishes four approaches with different roles (§1):

| Approach | Basis | Role |
|---|---|---|
| **Uji tanah** (soil test) | Soil nutrient status vs sufficiency class | Setting **amendments** (lime, dolomite, organic matter) |
| **Analisis daun/jaringan** (tissue analysis) | Indicator-organ nutrient concentration vs critical level | Diagnosing the **limiting nutrient** (primary method for deep-rooted perennials) |
| **Neraca hara** (nutrient balance) | Removed + immobilised − supply | Setting the **dose** |
| **Uji respons lapangan** (omission plot) | Yield response to dose | **Calibration/validation** — mandatory at scale, 3–4 yr cycles |

The generator `src/lib/fertGenerate.ts` implements the first three approaches as a **rule-based, transparent, always-provisional** engine. Its contract (per the header comment) is that output is *never* final for auditors — literature `BASE` doses (g/tree/yr, per crop × phenological phase `vegetatif`/`generatif`/`pemulihan`) are only a starting point, and **every number carries a `basis[]` audit trail** explaining the calculation. Key behaviours:

- `generateRecommendation()` takes the base dose and adjusts it by approach. `uji_tanah` scales N/P/K/Mg by soil thresholds (e.g. K-dd < 0.3 cmol/kg → K₂O ×1.3) and flags pH/Al criticality for liming (Al toxicity on durian roots, docs/09 §2). `analisis_jaringan` compares leaf concentration to **provisional** sufficiency thresholds and pushes a `basis` line explicitly stating those thresholds are provisional because §3.3 was left blank. `neraca_hara` scales all nutrients by target-yield vs a reference yield.
- `pickKSource()` encodes the doc's headline agronomic finding (§6.3): coconut always gets **KCl** (it needs chloride — von Uexküll 1990, critical < 0.25% Cl), durian gets **K₂SO₄** at generative phase (fruit quality) and **KNO₃** at recovery (K+N), otherwise KCl.
- Assumed uptake efficiencies (N 50%, P 20%, K 60%) are emitted in the `basis` with an explicit note that they are §7.1 starting points requiring omission-plot calibration.

The doc closes (§11) with the doctrine the whole system honours: local critical values and local uptake efficiency each need 3–5 years of response data, and until then *recommendations are provisional and must be stated as such internally — never presented as final numbers to management or auditors.* This engine feeds the `fertilizer_recommendations` table (see [Data Model](#master-data-agronomy-references--land-suitability)), whose doses are nullable and `is_provisional = true` until locally calibrated.

### Organic certification — sits above basic legality

`docs/10-organic-sertification.md` frames organic certification as a layer that **stands above legality, not a substitute for it** (§ scope note): NIB, KKPR, AMDAL/environmental approval, HGU, IUP-B, STD-B, and FPKM 20% remain mandatory, and no certification body will certify a unit whose land legality is unresolved. In the codebase this is mirrored by two distinct registries in `src/lib/repo/sustainability.ts`:

- **Compliance registry** (`complianceRegistry()` / `setComplianceStatus()`) over `app.compliance_items` + `app.compliance_tracking`, grouped A–H, tracking the prerequisite permits (the `is_prerequisite` flag marks legal prerequisites).
- **Organic registry** (`organicRegistry()` / `setOrganicStatus()`) over `app.organic_items` + `app.organic_tracking`, split into `standards` (SNI 6729:2016, EU 2018/848, USDA NOP, JAS, GB/T 19630, …) and `evidence` items. Status uses an Indonesian enum (`app.organic_status`: `belum_mulai`, `tersertifikasi`, etc.); both setters are idempotent upserts keyed on `(company_id, item_code)`.

The doc's substantive positions worth noting for accuracy: retroactive recognition of the 36-month conversion period is the highest time-value item (documenting land history *before* clearing); group-of-operators certification is unavailable to the corporate estate (Art. 36 caps: 2.000 members, ≤5 ha, ≤€25.000) so the estate certifies as a single *operator*; mined KCl is generally permissible (resolving the coconut chloride need); and organic durian at scale has *no commercial precedent* (Phytophthora with no equivalent permitted fungicide), so the doc recommends a 50–200 ha pilot rather than full-scale organic durian.

### Carbon accounting — IPCC Tier-1, marked `requires_validation`

Carbon figures are computed **in the database**, not hand-written, by `app.generate_carbon_run()` (migration `db/migrations/0026_carbon_reference.sql`). The function computes, per block: land-clearing emission = `area_ha` (from PostGIS geometry) × `EF-LANDCLEAR` where an approved land-preparation exists; and sequestration = Σ allometric biomass from **approved** `dbh_measurements` via `AGB = a·DBH^b`, expanded by root-shoot ratio and carbon fraction, converted C→CO₂e (×44/12). Results write to `app.carbon_runs` + `app.carbon_run_blocks` so they are reproducible and auditable. `src/lib/repo/sustainability.ts` reads these (`latestCarbonRun()`, `carbonByBlock()`) and preserves `null` distinctly from `0`.

The reference coefficients are **estimated IPCC Tier-1 values**, and the migration is unusually candid about it: the header states they were requested explicitly by the user ("pakai angka dummy yang mendekati") so the Carbon module could be shown, *with safeguards kept in place*:

- `app.allometric_coefficients.requires_validation = true` (pantropic Chave et al. 2014 / IPCC defaults, not calibrated for Kalimantan durian/coconut, uncertainty 55%).
- `app.emission_factors.source_standard` labels each factor "perkiraan — perlu validasi" (e.g. `EF-LANDCLEAR` 210 tCO₂e/ha at 50% uncertainty, `EF-FERT-N2O` at 60%).
- `carbonNeedsValidation()` returns true whenever any coefficient is unvalidated; the module header states the UI **must** display that warning. `listEmissionFactors()` sets `requiresNote` by regex-matching `perkiraan|perlu validasi` in the source standard.

The stance (migration comment): the numbers *may* appear for demo, but are **never silently treated as final**. `check_production_readiness()` reports unvalidated coefficients and un-cited emission factors as **non-blocking** notes (they don't stop go-live, but they surface).

### The data-honesty doctrine

The doctrine originates in `docs/00-refinement-concept.md` (concept:38–40): *remove all hardcoded/dummy numbers from dashboards and reports, no exceptions*; where there is no data, render an honest empty state, because **fabricated numbers on a financial dashboard are a fatal failure**. It is enforced in code, not just prose:

**1. EMPTY (em-dash), never 0.** `src/lib/format.ts` exports `EMPTY = "—"` and every formatter (`formatIdr`, `formatHa`, `formatNumber`, `formatPct`, `formatDate`, …) returns `EMPTY` for `null`/`undefined`. The header comment states the unbreakable rule: `null` means "no data yet" and renders as an em-dash, **not** as 0 — showing 0 for absent data is a fabricated number, "persis yang dilarang concept:40." Repo functions consistently preserve `null` from the DB rather than coalescing to 0.

**2. Demo rows flagged `is_demo`.** Migration `db/migrations/0024_cost_breakdown.sql` adds `app.companies.is_demo boolean NOT NULL DEFAULT false`, commented "Wajib nol di produksi" (must be zero in production). Existing dev entities (`DEV`, `DEMO`) are flagged true.

**3. Production-readiness gate blocks go-live.** `app.check_production_readiness()` (defined in `db/migrations/0021_login_lookup.sql`, extended in `0024`) returns `(item, blocking, detail)` rows and is designed to run in a pipeline rather than live as an easily-missed doc note. **Blocking** rows (must be zero before public deploy): passwordless login still switched on (`app.auth_settings.stub_login_enabled`, since 0057 — before that, the *presence* of the stub function, which meant the gate could never go green while local development needed it), RLS coverage gaps, privilege-revocation leaks, and — added in 0024 — **any `is_demo` company still present** (detail instructs `npm run db:purge:demo`). **Non-blocking** notes: unvalidated allometric coefficients, emission factors without citation, and undefined fiscal periods. The function comment states plainly: "Baris dengan blocking = true harus nol sebelum deploy publik."

**4. The synthetic kriging pilot dataset is clearly synthetic-for-demo.** `docs/pilot-data.geojson` is the *real* base grid: 567 point features carrying only geometry/grid metadata (`id`, `left/top/right/bottom`, `row_index`, `col_index`, `jenis` = durian/coconut, `layer`, `path`) — no measured agronomic values. `docs/pilot-data-filled.geojson` is the *derived* demo layer: the same 567 features expanded to 73 property keys with a full complement of interpolated agronomic values across three families — `ls_*` (14 land-suitability inputs: temperatur, curah_hujan, ktk, ph, drainase, tekstur, …), `tanah_*` (16 soil parameters mirroring docs/09 §2.1: ph_h2o, ph_kcl, c_organik, n_total, p_tersedia, k_dd, al_dd, cl, bobot_isi, …), and `daun_*` (12 leaf-tissue values: n, p, k, ca, mg, s, cl, b, cu, zn, mn, fe). Because the base grid held no such measurements, every value in the "-filled" file is a synthetic surface (kriging/IDW interpolation, per the technique named in docs/09 §8's "Peta status hara") produced to exercise the suitability and fertilizer engines in a demo — not field data. The `-filled` suffix and the empty base file make the synthetic-for-demo provenance explicit.

## Operations, Testing & Local Development

This section is a practical runbook for standing up AgroVision locally and running its verification suites. Everything below is grounded in `package.json`, `docker-compose.yml`, the `db/` scripts, and `scripts/at-verify.mjs`.

### Local Postgres + PostGIS (Docker)

The database runs in Docker. `docker-compose.yml` pins `postgis/postgis:16-3.4` — deliberately matched to the Cloud SQL target (PostgreSQL 16 + PostGIS 3.4) so behavior in dev mirrors production.

```bash
docker compose up -d db
```

Key details:
- Host port **55433** maps to container `5432` (chosen to avoid clashing with a native Postgres on 5432).
- DB name `agrovision`, superuser `postgres` / password `dev`.
- Data persists in the named volume `agrovision-pgdata`; a healthcheck runs `pg_isready` every 3s.

Connection strings live in `.env.local` and drive the npm scripts:

```
MIGRATION_DATABASE_URL=postgres://postgres:dev@localhost:55433/agrovision   # superuser — migrations, seeds
DATABASE_URL=postgres://app_user:apppass@localhost:55433/agrovision         # app_rw login role — the running app
APP_DB_USER=app_user
APP_DB_PASSWORD=apppass
```

The two-role split is load-bearing: migrations and seeds run as superuser (`MIGRATION_DATABASE_URL`), but the app — and the RLS test suites — connect as the unprivileged `app_user` (`DATABASE_URL`), a member of `app_rw`.

### First-time bootstrap

`app_user` is **not** created by migrations. Run the bootstrap once against a fresh database:

```bash
npm run db:migrate      # apply all migrations (db/migrate.mjs, ledger app.schema_migrations)
npm run db:bootstrap    # create app_user, GRANT app_rw, re-apply REVOKEs from ledger 0019
```

`db/bootstrap-role.mjs` creates the login role, grants `app_rw`/`app_ro` usage, then re-applies the privilege *revocations* recorded in migration `0019`. `db/verify.mjs` explicitly does **not** create the role itself — its header notes a previous version did `DROP/CREATE ROLE` and silently wiped those revocations, exactly the bug class the ledger exists to prevent.

### Migration scripts

The runner is `db/migrate.mjs` (35 SQL files, `db/migrations/0001_extensions.sql` onward), one transaction per file, tracked in `app.schema_migrations`:

| Script | Command | Purpose |
| --- | --- | --- |
| `db:migrate` | `node --env-file=.env.local db/migrate.mjs` | Apply pending migrations |
| `db:status` | `… migrate.mjs --status` | Show applied/pending without changing anything |
| `db:verify` | `… migrate.mjs --verify` | Compare on-disk file checksums against the ledger (drift detection) |
| `db:check` | inline `pg` one-liner | Runs `SELECT … FROM app.check_production_readiness()` and `console.table`s blocking items |

`db:check` is the production-readiness gate: it surfaces anything that must not ship (notably any `is_demo` tenant).

### Seed scripts

Two seeders, both run as superuser:

- **`db:seed:dev`** (`db/seed-dev.mjs`) — minimal, environment-specific. Seeds only what the UI cannot create: one placeholder company, one estate, four users (one per role). It deliberately does **not** seed `master_items`, `fiscal_periods`, or any numeric values — the header notes those must be created by a super_admin through the UI, because that is precisely what acceptance test 1 proves.
- **`db:seed:demo`** (`db/seed-demo.mjs`) — a rich demo dataset "for judging the look, not for production." The tenant is flagged `companies.is_demo = true`, so `check_production_readiness()` reports it as a **blocking** item — intentional, so demo data can never be mistaken for real data. Its header states all cost figures are illustrative and must not be used as budget references. `db:purge:demo` (`seed-demo.mjs --purge`) deletes the demo tenant in FK order.

Demo login model (no passwords in dev): authentication is email-only — `at-verify.mjs`'s `login()` just POSTs an email to `/login`. Demo users use `@demo.invalid` addresses so they can never collide with a real IdP identity:

```
super_admin   admin@demo.invalid       Sari Admin
approver      approver@demo.invalid    Budi Approver
creator       creator@demo.invalid     Rizky Lapangan
viewer        direktur@demo.invalid    Dewi Direktur
```

The demo seed also loads 2 estates, 12 blocks (all with polygons), the 8 cost categories from `docs/00-refinement-concept.md:158` with sub-categories, suppliers, 3 project phases, budgets, cost transactions across approval statuses, plus survey/nursery/DBH/certification/carbon/compliance/suitability sample rows and a price list.

### Verification suites

Four independent suites. The DB suites run directly against Postgres; the acceptance suite drives the real HTTP app.

**1. HTTP acceptance (`at:verify` → `scripts/at-verify.mjs`, ~43 checks).** Requires the dev server running (`npm run dev`, default `BASE_URL=http://localhost:3000`) and the Docker DB up (it shells into the container via `docker compose exec -T db psql`).

```bash
npm run dev          # in one terminal
npm run at:verify    # in another
```

It exercises the real app end-to-end — Server Actions submitted as plain multipart POSTs (no JS, testing progressive enhancement), reading hidden `$ACTION_*` fields out of rendered HTML. It maps to the acceptance tests in `docs/00-refinement-concept.md`:
- **AT5** — protected pages redirect anon users to `/login` (307); `/api/blocks/geojson` returns 401 without a session.
- **AT2** — create a block via UI, PostGIS computes area (~99.64 ha), polygon renders on the MapLibre/Sentinel-2 map and via the GeoJSON API.
- **AT1** — super_admin adds a master item → it appears in other forms' dropdowns.
- **AT3/AT4** — three expenses → submit → approver approves 2, rejects 1 (with reason) → only approved money (Rp 7,000,000) flows into totals, cost/ha, budget-vs-actual, and the financial report. Approval outcomes are re-checked against the database (a rejecting Server Action still returns HTTP 200), and rejection-without-reason is asserted to fail on the `ct_rejection_needs_reason` CHECK constraint.
- **AT6** — greps four page files to assert **zero** data-like numeric literals (after stripping Tailwind class tokens and config attributes).

It self-isolates by deleting `UJI-%` / `TEST%` / `FASE-UJI%` fixtures scoped to the demo company id before each run.

**2. DB happy-path (`db:test` → `db/verify.mjs`, ~21 checks).** Connects as **both** roles: fixtures are inserted as superuser (`SUPER`), then behavior is asserted as `app_user` (`APP`). The header is explicit — "testing as postgres only proves DDL syntax, not security behavior." It sets RLS session context via `set_config('app.current_user_id' / 'current_role' / 'current_company_id')`, then covers: RLS returns 0 rows with no context, emission-factor append-only versioning (direct `UPDATE` → `permission denied`), evidence verification, per-estate/per-tenant visibility, nullable `geom` with generated `area_ha`, English enum labels, cost/ha and budget-vs-actual views, rejected rows excluded from totals, overhead-vs-block constraint, and one-assessment-per-block.

**3. Adversarial RLS (`db:test:adversarial` → `db/verify-adversarial.mjs`, ~36 checks).** The complement to `verify.mjs`, which the header warns gives false passes twice (running as superuser bypasses REVOKEs; testing only block-scope budgets misses the view fan-out bug). Every check here expects an operation to **fail** — via a `mustFail()` helper wrapping each attempt in a `SAVEPOINT`. The whole run executes inside one `BEGIN … ROLLBACK` transaction, so it leaves nothing behind. It uses five users spanning all roles plus a second tenant, and asserts, as the *lowest-privileged* role: no self-granting cross-tenant/estate access, tenant isolation, `publish_emission_factor` gating (role, backdating, negatives, empty name, session-derived `approved_by`), the `v_budget_vs_actual` fan-out fix on company- and estate-scope budgets, creators can't mutate approved money (RLS `USING` filters to `rowCount = 0` rather than erroring), viewer read-only, built-in reports/system masters protected, global-row rules, `base_view` whitelist FK, budget CASCADE on block delete, rejection-reason enforcement across approval tables, and that migration `0019`'s privilege revocations hold (`app.check_privilege_revocations()` and `app.check_rls_coverage()` return no rows). See [Security §10](#10-adversarial-rls-test-suite) for the security rationale.

```bash
npm run db:test
npm run db:test:adversarial
```

**4. Auth / ID token (`auth:verify` → `scripts/verify-idtoken.mjs`, 36 checks).** No database, no network, no `.env.local`: it generates its own signing certificate with `openssl`, mints deliberately-broken tokens, and asserts each is rejected — forged signature, tampered payload, `alg:none`, HS256 key confusion, unknown/absent `kid`, wrong `aud`, wrong `iss`, expired, future `iat`/`auth_time`, empty or oversized `sub`. It then walks the `AUTH_MODE` matrix, including the one that matters most: `AUTH_MODE=stub` under `NODE_ENV=production` must resolve to `misconfigured`, never to `stub`. Requires Node ≥ 22.18 (it imports the `.ts` module directly).

```bash
npm run auth:verify
```

**5. Suitability classifier (`db/verify-suitability.mjs`, ~4 checks).** Note: this one has **no npm script** — run it directly:

```bash
node --env-file=.env.local db/verify-suitability.mjs
# or: node db/verify-suitability.mjs   (it hardcodes the superuser URL)
```

It re-implements the land-suitability classification logic in JS and checks it against `app.land_suit_criteria` band definitions and the worked example in `docs/07 §4.2`: durian → **S2** with limiting factors `wa`/`nr`/`oa`, optimum coconut → **S1**, and extreme inputs → **N**.

### How RLS is tested (the pattern)

Both DB suites share one discipline, stated in `verify.mjs` line 1: **seed as superuser, assert as `app_rw`.** Superuser bypasses row-level security and privilege revocations, so a test that both writes and reads as `postgres` proves only that DDL parses. The suites therefore insert fixtures over `MIGRATION_DATABASE_URL`, then open a second connection as `app_user` and set the request context with `set_config('app.current_user_id', …)`, `app.current_role`, and `app.current_company_id` — the same three settings the running app injects per request — before every read/write they intend to judge.

### Typical local loop

```bash
docker compose up -d db
npm run db:migrate && npm run db:bootstrap
npm run db:seed:demo         # optional, for UI/demo work
npm run db:test && npm run db:test:adversarial
npm run auth:verify
node --env-file=.env.local db/verify-suitability.mjs
npm run dev                  # needs AUTH_MODE=stub in .env.local; then, separately:
npm run at:verify
npm run db:check             # confirm production-readiness (demo tenant will block)
```

Relevant files (absolute): `/Users/dimasugaperceka/Documents/non/KLI/agrovision/package.json`, `/Users/dimasugaperceka/Documents/non/KLI/agrovision/docker-compose.yml`, `/Users/dimasugaperceka/Documents/non/KLI/agrovision/.env.local`, and under `/Users/dimasugaperceka/Documents/non/KLI/agrovision/db/`: `migrate.mjs`, `bootstrap-role.mjs`, `seed-dev.mjs`, `seed-demo.mjs`, `verify.mjs`, `verify-adversarial.mjs`, `verify-suitability.mjs`, plus `/Users/dimasugaperceka/Documents/non/KLI/agrovision/scripts/at-verify.mjs`.