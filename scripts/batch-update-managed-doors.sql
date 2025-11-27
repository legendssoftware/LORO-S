-- =====================================================
-- BATCH UPDATE: User Managed Doors
-- =====================================================
-- Update multiple users at once
-- =====================================================

-- =====================================================
-- OPTION 1: Update Single User (Quick)
-- =====================================================
-- Just change the numbers and run:
UPDATE users 
SET managedDoors = JSON_ARRAY(5)  -- Change device ID here
WHERE uid = 10;                   -- Change user ID here

-- =====================================================
-- OPTION 2: Update Multiple Users with Different Devices
-- =====================================================
-- Update user 10 with device 5
UPDATE users SET managedDoors = JSON_ARRAY(5) WHERE uid = 10;

-- Update user 11 with device 6
UPDATE users SET managedDoors = JSON_ARRAY(6) WHERE uid = 11;

-- Update user 12 with device 7
UPDATE users SET managedDoors = JSON_ARRAY(7) WHERE uid = 12;

-- Add more lines as needed...

-- =====================================================
-- OPTION 3: Assign Multiple Devices to One User
-- =====================================================
-- Assign devices [1, 2, 3] to user 10
UPDATE users 
SET managedDoors = CAST('[1, 2, 3]' AS JSON)
WHERE uid = 10;

-- =====================================================
-- OPTION 4: View All Users and Their Current Managed Doors
-- =====================================================
SELECT 
    uid,
    name,
    surname,
    email,
    managedDoors,
    CASE 
        WHEN managedDoors IS NULL THEN 0
        ELSE JSON_LENGTH(managedDoors)
    END as door_count
FROM users 
WHERE isDeleted = 0
ORDER BY uid;

-- =====================================================
-- OPTION 5: View All Available Devices
-- =====================================================
SELECT 
    id,
    deviceID,
    devicLocation,
    deviceType,
    orgID,
    branchID
FROM devices 
WHERE isDeleted = 0
ORDER BY id;

-- =====================================================
-- OPTION 6: View Users with Their Managed Devices Details
-- =====================================================
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
LEFT JOIN devices d ON JSON_CONTAINS(u.managedDoors, CAST(d.id AS JSON))
WHERE u.isDeleted = 0
ORDER BY u.uid;

-- =====================================================
-- OPTION 7: Clear All Managed Doors (Use with Caution!)
-- =====================================================
-- Uncomment to clear all managed doors:
-- UPDATE users SET managedDoors = NULL WHERE isDeleted = 0;

