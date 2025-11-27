-- =====================================================
-- QUICK UPDATE: User Managed Doors
-- =====================================================
-- Simple script - just change the numbers below and run
-- =====================================================

-- CHANGE THESE VALUES:
SET @user_id = 1;        -- User's uid
SET @device_id = 1;      -- Device ID to assign

-- Run this to assign the device to the user:
UPDATE users 
SET managedDoors = JSON_ARRAY(@device_id)
WHERE uid = @user_id;

-- Verify the update:
SELECT uid, name, surname, email, managedDoors 
FROM users 
WHERE uid = @user_id;

