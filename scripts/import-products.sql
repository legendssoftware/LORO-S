-- Import products for Organisation ID 2 and Branch ID 2
-- Run this script on your MySQL database

INSERT INTO `product` (
    `name`,
    `description`,
    `price`,
    `category`,
    `status`,
    `sku`,
    `barcode`,
    `productRef`,
    `productReferenceCode`,
    `stockQuantity`,
    `reorderPoint`,
    `weight`,
    `packageQuantity`,
    `brand`,
    `packageUnit`,
    `itemsPerPack`,
    `packsPerPallet`,
    `imageUrl`,
    `organisationUid`,
    `branchUid`,
    `isDeleted`,
    `createdAt`,
    `updatedAt`
) VALUES
-- BIT BOARD products (category_main: 001)
('BIT BOARD 6.4X.0.9X2.7', 'BIT BOARD 6.4X.0.9X2.7', 185.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010002496011', 0, 10, 12.390, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),
('BIT BOARD 6.4X0.9X2.7', 'BIT BOARD 6.4X0.9X2.7', 185.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010002796011', 0, 10, 12.390, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),
('BIT BOARD 6.4X0.9X3.0', 'BIT BOARD 6.4X0.9X3.0', 205.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003096011', 0, 10, 13.770, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),
('BIT BOARD 6.4X0.9X3.3', 'BIT BOARD 6.4X0.9X3.3', 225.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003396011', 0, 10, 15.150, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),
('BIT BOARD 6.4X0.9X3.6', 'BIT BOARD 6.4X0.9X3.6', 245.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003696011', 0, 10, 16.520, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),
('BIT BOARD 6.4X0.9X4.2', 'BIT BOARD 6.4X0.9X4.2', 285.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010004296011', 0, 10, 19.280, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),
('BIT BOARD 6.4X1.2X2.4', 'BIT BOARD 6.4X1.2X2.4', 195.00, 'Hardware', 'new', CONCAT('HAR-BIT-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010024126011', 0, 10, 14.690, 1, 'BIT', 'EA', 1, 1, 'https://media.siniat.co.za/img_638674_za/preview/800309594/siniat-easyboard-6mm', 2, 2, 0, NOW(), NOW()),

-- SINIAT BOARD products (category_main: 002)
('SINIAT BOARD 6.4X.0.9X2.7', 'SINIAT BOARD 6.4X.0.9X2.7', 175.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010002496012', 0, 10, 11.020, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),
('SINIAT BOARD 6.4X0.9X2.7', 'SINIAT BOARD 6.4X0.9X2.7', 175.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010002796012', 0, 10, 12.390, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),
('SINIAT BOARD 6.4X0.9X3.0', 'SINIAT BOARD 6.4X0.9X3.0', 195.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003096012', 0, 10, 13.770, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),
('SINIAT BOARD 6.4X0.9X3.3', 'SINIAT BOARD 6.4X0.9X3.3', 215.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003396012', 0, 10, 15.150, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),
('SINIAT BOARD 6.4X0.9X3.6', 'SINIAT BOARD 6.4X0.9X3.6', 235.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003696012', 0, 10, 16.520, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),
('SINIAT BOARD 6.4X0.9X4.2', 'SINIAT BOARD 6.4X0.9X4.2', 275.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010004296012', 0, 10, 19.280, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),
('SINIAT BOARD 6.4X1.2X2.4', 'SINIAT BOARD 6.4X1.2X2.4', 185.00, 'Hardware', 'new', CONCAT('HAR-SIN-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010024126012', 0, 10, 14.690, 1, 'SINIAT', 'EA', 1, 1, 'https://media.siniat.co.za/img_265798_za/preview/800309594/base_board_p1', 2, 2, 0, NOW(), NOW()),

-- GYPROC-R/BOARD products (category_main: 003)
('GYPROC-R/BOARD 6.4X0.9X2.4', 'GYPROC-R/BOARD 6.4X0.9X2.4', 165.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '10111300', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010002496013', 0, 10, 10.370, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW()),
('GYPROC-R/BOARD 6.4X0.9X2.7', 'GYPROC-R/BOARD 6.4X0.9X2.7', 185.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010002796013', 0, 10, 11.660, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW()),
('GYPROC-R/BOARD 6.4X0.9X3.0', 'GYPROC-R/BOARD 6.4X0.9X3.0', 205.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003096013', 0, 10, 12.960, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW()),
('GYPROC-R/BOARD 6.4X0.9X3.3', 'GYPROC-R/BOARD 6.4X0.9X3.3', 225.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003396013', 0, 10, 14.260, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW()),
('GYPROC-R/BOARD 6.4X0.9X3.6', 'GYPROC-R/BOARD 6.4X0.9X3.6', 245.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010003696013', 0, 10, 15.550, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW()),
('GYPROC-R/BOARD 6.4X0.9X4.2', 'GYPROC-R/BOARD 6.4X0.9X4.2', 285.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010004296013', 0, 10, 18.140, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW()),
('GYPROC-R/BOARD 6.4X1.2X2.4', 'GYPROC-R/BOARD 6.4X1.2X2.4', 195.00, 'Hardware', 'new', CONCAT('HAR-GYP-000-', LPAD(FLOOR(RAND() * 999999), 6, '0')), '', CONCAT('PRD', FLOOR(100000 + RAND() * 900000)), '0010024126013', 0, 10, 13.820, 1, 'GYPROC', 'EA', 1, 1, 'https://media.siniat.co.za/img_265799_za/preview/800309594/moisture_board_p1', 2, 2, 0, NOW(), NOW());

