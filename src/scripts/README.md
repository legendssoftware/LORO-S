# Seed Scripts

## populate-clerk-org

Seeds the database with two Clerk-linked organisations (Bit Drywall, Legend Systems), including org-level config, one branch per org, one enterprise license per org, 5 clients per org, and 10 varied products per org.

### What gets created (per organisation)

| Entity | Count | Notes |
|--------|--------|--------|
| Organisation | 1 | From Clerk JSON (Bit Drywall, Legend Systems) |
| **Organisation settings** | 1 | Contact, regional (ZAR, Africa/Johannesburg), branding, business, notifications, preferences |
| **Organisation hours** | 1 | Weekly schedule (Mon–Fri 08:00–17:00), timezone Africa/Johannesburg |
| **Organisation appearance** | 1 | Primary/secondary/accent/error/success colors, logo URL |
| Branch | 1 | BitDenver (Bit Drywall), Denver (Legend Systems) |
| License | 1 | Enterprise, annual, all features |
| Clients | 5 | Varied type, price tier, acquisition channel, contact preference, risk level, payment method |
| Products | 10 | Varied category, status (active, bestseller, hotdeals, new, special, outofstock), brand, package unit |

### Truncation order (on re-run)

For each org (by `clerkOrgId`): clients → products → check-ins → licenses → branches → organisation settings → organisation hours → organisation appearance → organisation.

### Client–organisation link

Clients are linked to the organisation by **Clerk org ID string** (`organisationUid`), not by numeric `organisation.uid`. If you have an existing DB with numeric `client.organisationUid`, run a one-off migration: add a varchar column, backfill from `organisation.clerkOrgId` (JOIN on organisation), then drop the old column and rename.

### Run

From `server/`:

```bash
npm run populate:clerk-org
```

Or:

```bash
ts-node -r tsconfig-paths/register src/scripts/populate-clerk-org.ts
```

Requires DB connection and NestJS app context (AppModule).

## populate-clerk-users

Syncs all Clerk users into the database. Uses the same behaviour as the APK session sync: for each Clerk user, the script creates or updates the `User` entity, syncs organisation membership, and ensures `UserProfile` and `UserEmployeementProfile` exist.

### Optional flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Only list Clerk user IDs and count; do not call sync. |
| `--limit=N` | Process at most N Clerk users (useful for testing). |

### Run

From `server/`:

```bash
npm run populate:clerk-users
```

With options:

```bash
npm run populate:clerk-users -- --dry-run
npm run populate:clerk-users -- --limit=10
```

Or:

```bash
ts-node -r tsconfig-paths/register src/scripts/populate-clerk-users.ts
```

Requires DB connection, NestJS app context (AppModule), and `CLERK_SECRET_KEY` (and `CLERK_PUBLISHABLE_KEY` if used by the Clerk client).

## sync-csv-to-clerk

Reads users from a CSV file (e.g. `readnew.csv` at repo root) and creates them in Clerk. Used to migrate users from uid 243 onward: each row is created in Clerk with generic password `securePass@2026`, username/email/name from the file, then added to the **Bit Drywall** Clerk organisation (so `populate:clerk-users` can later sync them to the DB).

### CSV format

Expected columns: `uid`, `username`, `name`, `surname`, `email`, `phone`, `role`, `accessLevel`, `organisationRef`. Rows with `uid >= 243` (or `--from-uid`) and non-empty `email` are processed.

### Optional flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Only list which users would be created; do not call Clerk. |
| `--from-uid=N` | Process rows with `uid >= N` (default: 243). |
| `--path=PATH` | Path to CSV file (default: `../readnew.csv` from `server/`). |

### Run

From `server/` (with `readnew.csv` at repo root):

```bash
npm run sync:csv-to-clerk
```

With options:

```bash
npm run sync:csv-to-clerk -- --dry-run
npm run sync:csv-to-clerk -- --from-uid=243 --path=../readnew.csv
```

Then sync from Clerk to DB:

```bash
npm run populate:clerk-users
```

Requires NestJS app context (AppModule) and `CLERK_SECRET_KEY`.
