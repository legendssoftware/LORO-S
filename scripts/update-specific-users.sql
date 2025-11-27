-- =====================================================
-- UPDATE SPECIFIC USERS - Copy and Modify as Needed
-- =====================================================
-- Copy the UPDATE statement below and change the values
-- =====================================================

-- Template: Update user with device
-- UPDATE users SET managedDoors = JSON_ARRAY(DEVICE_ID) WHERE uid = USER_ID;

-- Example updates (modify these):
UPDATE users SET managedDoors = JSON_ARRAY(1) WHERE uid = 1;
UPDATE users SET managedDoors = JSON_ARRAY(2) WHERE uid = 2;
UPDATE users SET managedDoors = JSON_ARRAY(3) WHERE uid = 3;

-- To add multiple devices to one user:
-- UPDATE users SET managedDoors = CAST('[1, 2, 3]' AS JSON) WHERE uid = 10;

-- =====================================================
-- VERIFY YOUR CHANGES
-- =====================================================
SELECT uid, name, surname, email, managedDoors 
FROM users 
WHERE uid IN (1, 2, 3)  -- Change to your user IDs
ORDER BY uid;

