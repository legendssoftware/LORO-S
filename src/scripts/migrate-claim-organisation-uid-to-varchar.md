# Migration: claim.organisationUid to varchar (Clerk org ID)

Claims now use **organisationUid** as a **string** (Clerk org ID or organisation ref), not a numeric uid.

## If you use TypeORM `synchronize: true`

- On next app start, TypeORM may try to alter the `claim` table. If the column was previously integer, you may need to run the SQL below first (e.g. in a one-off script or DB client) to avoid type conflicts.

## If you manage schema manually or have existing data

Run the following **after** backing up the `claim` table.

### PostgreSQL

```sql
-- 1. Add a temporary new column for the string value
ALTER TABLE claim ADD COLUMN IF NOT EXISTS organisation_uid_varchar VARCHAR(255);

-- 2. Backfill from organisation table (organisationUid previously stored numeric uid)
UPDATE claim c
SET organisation_uid_varchar = o."clerkOrgId"
FROM organisation o
WHERE c."organisationUid"::text = o.uid::text
  AND o."clerkOrgId" IS NOT NULL;

-- 3. Drop old column and rename new one (if your FK was on organisation.uid, drop it first)
-- ALTER TABLE claim DROP CONSTRAINT IF EXISTS fk_claim_organisation_uid;
ALTER TABLE claim DROP COLUMN IF EXISTS "organisationUid";
ALTER TABLE claim RENAME COLUMN organisation_uid_varchar TO "organisationUid";
```

### New deployments

- No migration needed; the entity defines `organisationUid` as `type: 'varchar'` and JoinColumn `referencedColumnName: 'clerkOrgId'`.
