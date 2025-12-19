-- Fix NULL checkIn values in attendance table
-- This script updates NULL checkIn values to use createdAt as a fallback
-- Run this script after the app starts successfully

-- Option 1: Set NULL checkIn values to createdAt (recommended)
UPDATE attendance
SET "checkIn" = "createdAt"
WHERE "checkIn" IS NULL;

-- Option 2: Delete records with NULL checkIn (use with caution - only if these are invalid records)
-- DELETE FROM attendance WHERE "checkIn" IS NULL;

-- After running the update, you can verify the fix:
-- SELECT COUNT(*) FROM attendance WHERE "checkIn" IS NULL;
-- Should return 0

-- After cleanup, update the entity to make checkIn NOT NULL again:
-- Change: @Column({ type: 'timestamptz', nullable: true })
-- To:     @Column({ type: 'timestamptz' })

