# Migration: attendance.organisationUid to varchar (Clerk org ID)

Attendance now uses **organisationUid** as a **string** (Clerk org ID or organisation ref), not a numeric uid.

## If you use TypeORM `synchronize: true`

- On next app start, TypeORM may try to alter the `attendance` table. If the column was previously integer, you may need to run the SQL below first (e.g. in a one-off script or DB client) to avoid type conflicts.

## If you manage schema manually or have existing data

Run the following **after** backing up the `attendance` table.

### PostgreSQL

```sql
-- 1. Drop FK if it references organisation(uid) by name (check your DB for exact constraint name)
-- e.g. ALTER TABLE attendance DROP CONSTRAINT IF EXISTS "FK_attendance_organisation_uid";

-- 2. Add a temporary new column for the string value
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS organisation_uid_varchar VARCHAR(255);

-- 3. Backfill from organisation table (organisationUid previously stored numeric uid)
UPDATE attendance a
SET organisation_uid_varchar = COALESCE(o."clerkOrgId", o.ref)
FROM organisation o
WHERE a."organisationUid"::text = o.uid::text;

-- 4. Drop old column and rename new one
ALTER TABLE attendance DROP COLUMN IF EXISTS "organisationUid";
ALTER TABLE attendance RENAME COLUMN organisation_uid_varchar TO "organisationUid";

-- 5. Optional: add FK to organisation(clerkOrgId) if your DB supports it
-- ALTER TABLE attendance ADD CONSTRAINT "FK_attendance_organisation_clerkOrgId"
--   FOREIGN KEY ("organisationUid") REFERENCES organisation("clerkOrgId");
```

### New deployments

- No migration needed; the entity defines `organisationUid` as `type: 'varchar'` and JoinColumn `referencedColumnName: 'clerkOrgId'`.
