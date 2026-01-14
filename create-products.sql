-- SQL Script to create 20 drywall, partition, and roof sealant products for Organization 2
-- This script creates products covering essential Product entity columns for testing client self-ordering

-- Product 1: Standard Gypsum Board 12mm (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", 
    "packageUnit", "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", 
    "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", 
    "palletAvailable", "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Standard Gypsum Board 12mm', 
    'Fire-resistant gypsum board for interior walls and ceilings. Standard 12mm thickness, easy to install.', 
    189.99, 'boards', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'GYB-STD-000-000001', 'Warehouse A, Section 1', 200, 'PRD123456', 
    30, 169.99, 11.0, '1234567890123', 'BuildPro', 1, 12.0, false, 
    'sheet', 1, 4, 169.99, 650.00, 599.99, true, 
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days', 12.0, 48.0, true, 
    15, 2, 'GYB-STD-000-000001-PLT', '240x120x1.2 cm', 'BuildPro Materials', 
    'GYB-12-240', 'White', 'Gypsum', 0, 'months', 
    '240x120cm, 12mm thick, Fire-resistant', 'Fire-resistant, Moisture resistant, Easy to cut', 
    4.5, 156, 'South Africa', true, true, 
    'Store flat and dry. Handle with care to avoid breakage.', 1, 10.0, 2, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 2: Moisture Resistant Gypsum Board 15mm (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", 
    "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Moisture Resistant Gypsum Board 15mm', 
    'Premium moisture-resistant gypsum board for bathrooms and high-humidity areas. 15mm thickness for added durability.', 
    249.99, 'boards', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'GYB-MR-000-000002', 'Warehouse A, Section 1', 150, 'PRD234567', 
    20, 224.99, 10.0, '2345678901234', 'BuildPro', 1, 15.5, false, 'sheet', 
    1, 3, 224.99, 650.00, 599.99, false, NULL, NULL, 15.5, 46.5, true, 
    10, 1, 'GYB-MR-000-000002-PLT', '240x120x1.5 cm', 'BuildPro Materials', 
    'GYB-15-MR-240', 'Green', 'Moisture Resistant Gypsum', 0, 'months', 
    '240x120cm, 15mm thick, MR grade', 'Moisture resistant, Mold resistant, High humidity areas', 
    4.7, 203, 'South Africa', true, true, 
    'Store flat and dry. Keep away from moisture until installation.', 1, 12.0, 2, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 3: Fire-Rated Gypsum Board 13mm (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Fire-Rated Gypsum Board 13mm', 
    'High-performance fire-rated gypsum board with enhanced fire resistance. Perfect for commercial buildings.', 
    289.99, 'boards', 'bestseller', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'GYB-FR-000-000003', 'Warehouse A, Section 1', 120, 'PRD345678', 
    15, 259.99, 10.0, '3456789012345', 'BuildPro', 1, 13.5, true, 'sheet', 
    1, 3, 259.99, 750.00, 690.00, false, NULL, NULL, 13.5, 40.5, true, 
    8, 1, 'GYB-FR-000-000003-PLT', '240x120x1.3 cm', 'BuildPro Materials', 
    'GYB-13-FR-240', 'Pink', 'Fire-Rated Gypsum', 0, 'months', 
    '240x120cm, 13mm thick, Fire-rated', '2-hour fire rating, Commercial grade, Code compliant', 
    4.8, 267, 'South Africa', true, true, 
    'Store flat and dry. Handle with care.', 1, 10.0, 2, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 4: Acoustic Gypsum Board 15mm (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Acoustic Gypsum Board 15mm', 
    'Sound-absorbing gypsum board with enhanced acoustic properties. Ideal for studios and noise-sensitive areas.', 
    319.99, 'boards', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'GYB-AC-000-000004', 'Warehouse A, Section 1', 100, 'PRD456789', 
    12, 289.99, 9.0, '4567890123456', 'BuildPro', 1, 16.0, false, 'sheet', 
    1, 3, 289.99, 850.00, 782.00, false, NULL, NULL, 16.0, 48.0, true, 
    6, 1, 'GYB-AC-000-000004-PLT', '240x120x1.5 cm', 'BuildPro Materials', 
    'GYB-15-AC-240', 'White', 'Acoustic Gypsum', 0, 'months', 
    '240x120cm, 15mm thick, Acoustic grade', 'Sound absorption 0.8, Noise reduction, Studio quality', 
    4.6, 189, 'South Africa', true, true, 
    'Store flat and dry. Handle carefully.', 1, 12.0, 2, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 5: Metal Stud Partition System (Partition)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Metal Stud Partition System', 
    'Complete metal stud partition system with tracks and studs. Galvanized steel, lightweight and durable.', 
    89.99, 'steel', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'PAR-STU-000-000005', 'Warehouse B, Section 1', 300, 'PRD567890', 
    50, 79.99, 11.0, '5678901234567', 'PartitionPro', 1, 2.5, false, 'meter', 
    1, 20, 79.99, 1500.00, 1380.00, false, NULL, NULL, 2.5, 50.0, true, 
    25, 2, 'PAR-STU-000-000005-PLT', '600x50x25 mm', 'PartitionPro Systems', 
    'STU-50-600', 'Silver', 'Galvanized Steel', 0, 'months', 
    '50mm width, 600mm length, Galvanized', 'Lightweight, Easy installation, Corrosion resistant', 
    4.5, 234, 'South Africa', false, false, 
    'Store in dry place. Keep bundled.', 5, 10.0, 10, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 6: Partition Track System (Partition)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Partition Track System', 
    'Top and bottom tracks for metal stud partition systems. Precision-cut for easy installation.', 
    69.99, 'steel', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'PAR-TRA-000-000006', 'Warehouse B, Section 1', 250, 'PRD678901', 
    40, 62.99, 10.0, '6789012345678', 'PartitionPro', 1, 1.8, false, 'meter', 
    1, 25, 62.99, 1500.00, 1380.00, false, NULL, NULL, 1.8, 45.0, true, 
    20, 2, 'PAR-TRA-000-000006-PLT', '600x50x20 mm', 'PartitionPro Systems', 
    'TRA-50-600', 'Silver', 'Galvanized Steel', 0, 'months', 
    '50mm width, 600mm length, Track system', 'Precision cut, Easy alignment, Durable', 
    4.4, 178, 'South Africa', false, false, 
    'Store in dry place. Keep bundled.', 5, 10.0, 10, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 7: Partition Screws & Fasteners (Partition)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Partition Screws & Fasteners', 
    'High-quality self-drilling screws for metal stud partitions. Zinc-plated for corrosion resistance.', 
    149.99, 'accessories', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'ACC-SCR-000-000007', 'Warehouse B, Section 2', 500, 'PRD789012', 
    100, 134.99, 10.0, '7890123456789', 'FastenPro', 100, 2.0, false, 'pack', 
    100, 10, 134.99, 1250.00, 1150.00, false, NULL, NULL, 2.0, 20.0, true, 
    50, 2, 'ACC-SCR-000-000007-PLT', '25mm length, 4.2mm diameter', 'FastenPro Hardware', 
    'SCR-25-ZN', 'Silver', 'Zinc-Plated Steel', 0, 'months', 
    '100 pieces per pack, Self-drilling', 'Zinc-plated, Corrosion resistant, Easy installation', 
    4.6, 312, 'South Africa', false, false, 
    'Store in dry place. Keep sealed.', 1, 12.0, 5, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 8: Joint Compound Ready-Mix (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Joint Compound Ready-Mix', 
    'Professional ready-mix joint compound for seamless drywall finishing. Smooth application, quick drying.', 
    129.99, 'plaster', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'PLA-JOI-000-000008', 'Warehouse A, Section 2', 180, 'PRD890123', 
    25, 114.99, 12.0, '8901234567890', 'FinishPro', 1, 20.0, false, 'kg', 
    1, 4, 114.99, 440.00, 404.80, false, NULL, NULL, 20.0, 80.0, true, 
    15, 2, 'PLA-JOI-000-000008-PLT', '30x30x25 cm', 'FinishPro Materials', 
    'JC-RM-20', 'White', 'Gypsum, Polymers', 12, 'months', 
    '20kg bucket, Ready-mix', 'Smooth finish, Quick drying, Easy sanding', 
    4.5, 267, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed until use.', 1, 10.0, 4, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 9: Drywall Tape (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Drywall Joint Tape', 
    'Self-adhesive fiberglass mesh tape for drywall joints. Prevents cracking and ensures smooth finishes.', 
    89.99, 'accessories', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'ACC-TAP-000-000009', 'Warehouse B, Section 2', 400, 'PRD901234', 
    50, 79.99, 11.0, '9012345678901', 'FinishPro', 1, 0.5, false, 'roll', 
    1, 20, 79.99, 1500.00, 1380.00, false, NULL, NULL, 0.5, 10.0, true, 
    25, 2, 'ACC-TAP-000-000009-PLT', '50mm x 50m roll', 'FinishPro Materials', 
    'TAP-50-50', 'White', 'Fiberglass Mesh', 0, 'months', 
    '50mm width, 50m length', 'Self-adhesive, Prevents cracking, Easy to apply', 
    4.4, 189, 'South Africa', false, false, 
    'Store in dry place. Keep sealed.', 1, 10.0, 10, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 10: Corner Bead (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Corner Bead for Drywall', 
    'Galvanized steel corner bead for protecting and finishing external corners. Easy to install.', 
    49.99, 'accessories', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'ACC-COR-000-000010', 'Warehouse B, Section 2', 350, 'PRD012345', 
    40, 44.99, 10.0, '0123456789012', 'FinishPro', 1, 0.8, false, 'length', 
    1, 30, 44.99, 1300.00, 1196.00, false, NULL, NULL, 0.8, 24.0, true, 
    20, 2, 'ACC-COR-000-000010-PLT', '2500mm length, 25mm width', 'FinishPro Materials', 
    'COR-25-250', 'Silver', 'Galvanized Steel', 0, 'months', 
    '2.5m length, 25mm width', 'Protects corners, Easy installation, Durable', 
    4.5, 223, 'South Africa', false, false, 
    'Store in dry place. Keep straight.', 5, 10.0, 10, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 11: Silicone Roof Sealant (Roof Sealant)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Silicone Roof Sealant', 
    'High-performance silicone sealant for roof repairs and waterproofing. UV resistant and weatherproof.', 
    189.99, 'chemicals', 'bestseller', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'CHE-SIL-000-000011', 'Warehouse C, Section 1', 120, 'PRD123450', 
    20, 169.99, 11.0, '1234506789013', 'SealPro', 1, 0.31, false, 'cartridge', 
    1, 12, 169.99, 1950.00, 1794.00, false, NULL, NULL, 0.31, 3.72, true, 
    10, 1, 'CHE-SIL-000-000011-PLT', '310ml cartridge', 'SealPro Chemicals', 
    'SIL-310-ROOF', 'Clear', 'Silicone', 12, 'months', 
    '310ml cartridge, Neutral cure', 'UV resistant, Weatherproof, Flexible', 
    4.7, 298, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 10.0, 6, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 12: Polyurethane Roof Sealant (Roof Sealant)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Polyurethane Roof Sealant', 
    'Professional-grade polyurethane sealant for roof joints and seams. Excellent adhesion and durability.', 
    249.99, 'chemicals', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'CHE-PUR-000-000012', 'Warehouse C, Section 1', 100, 'PRD234501', 
    15, 224.99, 10.0, '2345016789014', 'SealPro', 1, 0.6, false, 'cartridge', 
    1, 10, 224.99, 2150.00, 1978.00, false, NULL, NULL, 0.6, 6.0, true, 
    8, 1, 'CHE-PUR-000-000012-PLT', '600ml cartridge', 'SealPro Chemicals', 
    'PUR-600-ROOF', 'Black', 'Polyurethane', 12, 'months', 
    '600ml cartridge, Single component', 'High adhesion, Durable, Flexible', 
    4.6, 234, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 12.0, 5, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 13: Bituminous Roof Sealant (Roof Sealant)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Bituminous Roof Sealant', 
    'Heavy-duty bituminous sealant for flat roofs and waterproofing. Excellent for large area applications.', 
    349.99, 'chemicals', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'CHE-BIT-000-000013', 'Warehouse C, Section 1', 80, 'PRD345012', 
    12, 314.99, 10.0, '3450126789015', 'SealPro', 1, 20.0, false, 'kg', 
    1, 4, 314.99, 1200.00, 1104.00, false, NULL, NULL, 20.0, 80.0, true, 
    6, 1, 'CHE-BIT-000-000013-PLT', '20kg bucket', 'SealPro Chemicals', 
    'BIT-20-ROOF', 'Black', 'Bitumen', 12, 'months', 
    '20kg bucket, Cold applied', 'Heavy-duty, Waterproof, Large area coverage', 
    4.5, 167, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 10.0, 4, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 14: Acrylic Roof Sealant (Roof Sealant)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Acrylic Roof Sealant', 
    'Water-based acrylic sealant for roof repairs. Easy to apply, paintable, and environmentally friendly.', 
    159.99, 'chemicals', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'CHE-ACR-000-000014', 'Warehouse C, Section 1', 150, 'PRD450123', 
    25, 143.99, 10.0, '4501236789016', 'SealPro', 1, 5.0, false, 'liter', 
    1, 8, 143.99, 1100.00, 1012.00, false, NULL, NULL, 5.0, 40.0, true, 
    12, 1, 'CHE-ACR-000-000014-PLT', '5L container', 'SealPro Chemicals', 
    'ACR-5-ROOF', 'White', 'Acrylic', 12, 'months', 
    '5L container, Water-based', 'Paintable, Easy application, Eco-friendly', 
    4.4, 198, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 10.0, 5, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 15: Roof Flashing Sealant (Roof Sealant)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Roof Flashing Sealant', 
    'Specialized sealant for roof flashing, vents, and penetrations. High-temperature resistant.', 
    219.99, 'chemicals', 'special', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'CHE-FLA-000-000015', 'Warehouse C, Section 1', 90, 'PRD501234', 
    15, 197.99, 10.0, '5012346789017', 'SealPro', 1, 0.4, true, 'cartridge', 
    1, 12, 197.99, 2300.00, 2116.00, false, NULL, NULL, 0.4, 4.8, true, 
    8, 1, 'CHE-FLA-000-000015-PLT', '400ml cartridge', 'SealPro Chemicals', 
    'FLA-400-ROOF', 'Black', 'Elastomeric', 12, 'months', 
    '400ml cartridge, High-temp resistant', 'High temperature resistance, Flexible, Durable', 
    4.7, 256, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 12.0, 5, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 16: Partition Insulation (Partition)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Partition Insulation Batts', 
    'Thermal and acoustic insulation batts for partition walls. Easy to install between studs.', 
    199.99, 'insulation', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'INS-BAT-000-000016', 'Warehouse C, Section 2', 180, 'PRD612345', 
    25, 179.99, 10.0, '6123456789018', 'ThermoGuard', 1, 2.5, false, 'pack', 
    1, 8, 179.99, 1400.00, 1288.00, false, NULL, NULL, 2.5, 20.0, true, 
    12, 1, 'INS-BAT-000-000016-PLT', '1200x600x50mm', 'ThermoGuard Systems', 
    'INS-50-120', 'Pink', 'Fiberglass', 0, 'months', 
    '1200x600mm, 50mm thick', 'Thermal insulation, Acoustic properties, Easy installation', 
    4.6, 223, 'South Africa', false, false, 
    'Store in dry place. Keep compressed until use.', 1, 10.0, 4, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 17: Drywall Primer (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Drywall Primer Sealer', 
    'High-quality primer sealer for drywall surfaces. Ensures even paint coverage and prevents stains.', 
    179.99, 'plaster', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'PLA-PRI-000-000017', 'Warehouse A, Section 2', 140, 'PRD723456', 
    20, 161.99, 10.0, '7234566789019', 'FinishPro', 1, 10.0, false, 'liter', 
    1, 6, 161.99, 950.00, 874.00, false, NULL, NULL, 10.0, 60.0, true, 
    10, 1, 'PLA-PRI-000-000017-PLT', '10L container', 'FinishPro Materials', 
    'PRI-10-DW', 'White', 'Acrylic Primer', 12, 'months', 
    '10L container, Water-based', 'Stain blocking, Even coverage, Quick drying', 
    4.5, 189, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 10.0, 5, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 18: Partition Door Frame (Partition)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Metal Partition Door Frame', 
    'Complete metal door frame system for partition walls. Galvanized steel, adjustable for various door sizes.', 
    349.99, 'steel', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'PAR-FRA-000-000018', 'Warehouse B, Section 1', 60, 'PRD834567', 
    10, 314.99, 10.0, '8345676789020', 'PartitionPro', 1, 8.5, false, 'frame', 
    1, 2, 314.99, 600.00, 552.00, false, NULL, NULL, 8.5, 17.0, true, 
    4, 1, 'PAR-FRA-000-000018-PLT', '820x2040mm frame', 'PartitionPro Systems', 
    'FRA-820-204', 'Silver', 'Galvanized Steel', 0, 'months', 
    '820mm width, 2040mm height', 'Adjustable, Easy installation, Durable', 
    4.6, 145, 'South Africa', false, false, 
    'Store in dry place. Keep bundled.', 1, 10.0, 2, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 19: Roof Membrane Sealant (Roof Sealant)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'EPDM Roof Membrane Sealant', 
    'Professional EPDM membrane sealant for flat roof systems. Long-lasting waterproof protection.', 
    429.99, 'chemicals', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'CHE-EPD-000-000019', 'Warehouse C, Section 1', 50, 'PRD945678', 
    8, 389.99, 9.0, '9456786789021', 'SealPro', 1, 1.0, false, 'liter', 
    1, 5, 389.99, 1900.00, 1748.00, false, NULL, NULL, 1.0, 5.0, true, 
    4, 1, 'CHE-EPD-000-000019-PLT', '1L container', 'SealPro Chemicals', 
    'EPD-1-MEM', 'Black', 'EPDM', 24, 'months', 
    '1L container, EPDM compatible', 'EPDM compatible, Long-lasting, Weatherproof', 
    4.8, 178, 'South Africa', false, false, 
    'Store in cool, dry place. Keep sealed.', 1, 12.0, 3, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Product 20: Drywall Sanding Paper (Drywall)
INSERT INTO product (
    name, description, price, category, status, "imageUrl", sku, "warehouseLocation", "stockQuantity", "productRef", 
    "reorderPoint", "salePrice", discount, barcode, brand, "packageQuantity", weight, "isOnPromotion", "packageUnit", 
    "itemsPerPack", "packsPerPallet", "packPrice", "palletPrice", "palletSalePrice", "palletOnPromotion", "palletPromotionStartDate", "palletPromotionEndDate", "packWeight", "palletWeight", "palletAvailable", 
    "palletStockQuantity", "palletReorderPoint", "palletSku", dimensions, manufacturer, 
    model, color, material, "warrantyPeriod", "warrantyUnit", specifications, features, rating, "reviewCount", 
    origin, "isFragile", "requiresSpecialHandling", "storageConditions", "minimumOrderQuantity", 
    "bulkDiscountPercentage", "bulkDiscountMinQty", "organisationUid", "isDeleted", "createdAt", "updatedAt"
) VALUES (
    'Drywall Sanding Paper', 
    'Premium sanding paper for smooth drywall finishing. Various grits available for different stages.', 
    79.99, 'accessories', 'active', 
    'https://cdn-icons-png.flaticon.com/128/10951/10951869.png', 
    'ACC-SAN-000-000020', 'Warehouse B, Section 2', 300, 'PRD056789', 
    40, 71.99, 10.0, '0567896789022', 'FinishPro', 5, 0.3, false, 'pack', 
    5, 15, 359.95, 1050.00, 966.00, false, NULL, NULL, 1.5, 22.5, true, 
    20, 2, 'ACC-SAN-000-000020-PLT', '230x280mm sheets, 5 per pack', 'FinishPro Materials', 
    'SAN-120-5', 'Beige', 'Aluminum Oxide', 0, 'months', 
    '5 sheets per pack, 120 grit', 'Long-lasting, Smooth finish, Various grits', 
    4.4, 267, 'South Africa', false, false, 
    'Store in dry place. Keep sealed.', 1, 10.0, 10, 
    2, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Verify the products were created
SELECT 
    "uid",
    name,
    category,
    status,
    price,
    "stockQuantity",
    "organisationUid",
    "productRef",
    sku,
    "createdAt"
FROM product
WHERE "organisationUid" = 2
ORDER BY "createdAt";
