-- =====================================================
-- Script to Update User's Managed Doors
-- =====================================================
-- This script updates the managedDoors JSON column for a user
-- 
-- Usage:
-- 1. Set @user_id to the user's uid you want to update
-- 2. Set @device_id to the device ID you want to add/update
-- 3. Choose one of the update methods below
-- =====================================================

-- Set these variables (change these values as needed)
SET @user_id = 1;        -- Change this to the user's uid
SET @device_id = 1;      -- Change this to the device ID

-- =====================================================
-- METHOD 1: Replace entire managedDoors array with single device
-- =====================================================
-- Use this if you want to replace all existing doors with just this one device
UPDATE users 
SET managedDoors = JSON_ARRAY(@device_id)
WHERE uid = @user_id;

-- =====================================================
-- METHOD 2: Add device to existing array (if not already present)
-- =====================================================
-- Use this if you want to add a device to existing managed doors
-- This will add the device only if it's not already in the array
UPDATE users 
SET managedDoors = CASE
    WHEN managedDoors IS NULL THEN JSON_ARRAY(@device_id)
    WHEN JSON_CONTAINS(managedDoors, CAST(@device_id AS JSON)) THEN managedDoors
    ELSE JSON_ARRAY_APPEND(managedDoors, '$', @device_id)
END
WHERE uid = @user_id;

-- =====================================================
-- METHOD 3: Set multiple devices at once
-- =====================================================
-- Use this if you want to set multiple device IDs for a user
SET @device_ids = '[1, 2, 3]';  -- Change this to your device IDs array

UPDATE users 
SET managedDoors = CAST(@device_ids AS JSON)
WHERE uid = @user_id;

-- =====================================================
-- METHOD 4: Remove a specific device from array
-- =====================================================
-- Use this if you want to remove a device from managed doors
SET @device_to_remove = 1;  -- Change this to the device ID to remove

UPDATE users 
SET managedDoors = JSON_REMOVE(
    managedDoors,
    JSON_UNQUOTE(JSON_SEARCH(managedDoors, 'one', CAST(@device_to_remove AS CHAR)))
)
WHERE uid = @user_id
  AND JSON_CONTAINS(managedDoors, CAST(@device_to_remove AS JSON));

-- =====================================================
-- METHOD 5: Clear all managed doors (set to NULL)
-- =====================================================
-- Use this if you want to remove all managed doors for a user
UPDATE users 
SET managedDoors = NULL
WHERE uid = @user_id;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these after updating to verify the changes:

-- Check a specific user's managed doors
SELECT 
    uid,
    name,
    surname,
    email,
    managedDoors,
    JSON_LENGTH(managedDoors) as door_count
FROM users 
WHERE uid = @user_id;

-- List all users with their managed doors
SELECT 
    uid,
    name,
    surname,
    email,
    managedDoors,
    JSON_LENGTH(managedDoors) as door_count
FROM users 
WHERE managedDoors IS NOT NULL
ORDER BY uid;

-- Find users managing a specific device
SELECT 
    u.uid,
    u.name,
    u.surname,
    u.email,
    u.managedDoors,
    d.id as device_id,
    d.deviceID,
    d.devicLocation
FROM users u
CROSS JOIN devices d
WHERE JSON_CONTAINS(u.managedDoors, CAST(d.id AS JSON))
  AND d.id = @device_id
  AND u.isDeleted = 0
  AND d.isDeleted = 0;

-- =====================================================
-- EXAMPLE USAGE SCENARIOS
-- =====================================================

-- Example 1: Assign device ID 5 to user ID 10
-- SET @user_id = 10;
-- SET @device_id = 5;
-- UPDATE users SET managedDoors = JSON_ARRAY(5) WHERE uid = 10;

-- Example 2: Add device ID 3 to user ID 7's existing doors
-- SET @user_id = 7;
-- SET @device_id = 3;
-- UPDATE users SET managedDoors = JSON_ARRAY_APPEND(managedDoors, '$', 3) WHERE uid = 7;

-- Example 3: Assign multiple devices [1, 2, 3] to user ID 5
-- UPDATE users SET managedDoors = CAST('[1, 2, 3]' AS JSON) WHERE uid = 5;

