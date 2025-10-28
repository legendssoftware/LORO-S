/**
 * ========================================================================
 * PERFORMANCE MOCK DATA GENERATOR
 * ========================================================================
 * 
 * Server-side mock data generation for Performance Tracker.
 * Phase 1: Generate realistic mock data matching frontend structure
 * Phase 2: This will be replaced by real database queries
 * 
 * Mock data includes:
 * - Locations (33 Southern African locations)
 * - Branches (33 branches across locations)
 * - Products (30 building materials products)
 * - Product Categories (5 categories)
 * - Sales People (66 salesperson across branches)
 * - Performance Data (365 days of performance metrics)
 * - Sales Transactions (90 days of detailed transactions)
 * ========================================================================
 */

// ===================================================================
// PRODUCT CATEGORIES
// ===================================================================

export const productCategories = [
	{ id: 'CAT001', name: 'Drywall & Partition', description: 'Drywall sheets, studs, and partition materials' },
	{ id: 'CAT002', name: 'Ceiling Materials', description: 'Ceiling tiles, grids, and related materials' },
	{ id: 'CAT003', name: 'Roof Sealers', description: 'Waterproofing and roof sealing products' },
	{ id: 'CAT004', name: 'Insulation', description: 'Thermal and acoustic insulation materials' },
	{ id: 'CAT005', name: 'Adhesives & Compounds', description: 'Adhesives, cement, and plaster' },
];

// ===================================================================
// LOCATIONS - Southern African Countries
// ===================================================================

export const locations = [
	// South Africa
	{ id: 'L001', county: 'South Africa', province: 'Gauteng', city: 'Johannesburg', suburb: 'Sandton' },
	{ id: 'L002', county: 'South Africa', province: 'Gauteng', city: 'Johannesburg', suburb: 'Rosebank' },
	{ id: 'L003', county: 'South Africa', province: 'Gauteng', city: 'Pretoria', suburb: 'Centurion' },
	{ id: 'L004', county: 'South Africa', province: 'Western Cape', city: 'Cape Town', suburb: 'CBD' },
	{ id: 'L005', county: 'South Africa', province: 'KwaZulu-Natal', city: 'Durban', suburb: 'Umhlanga' },

	// Botswana
	{ id: 'L006', county: 'Botswana', province: 'South-East', city: 'Gaborone', suburb: 'Main Mall' },
	{ id: 'L007', county: 'Botswana', province: 'South-East', city: 'Gaborone', suburb: 'Riverwalk' },
	{ id: 'L008', county: 'Botswana', province: 'North-West', city: 'Maun', suburb: 'Central' },
	{ id: 'L009', county: 'Botswana', province: 'Central', city: 'Francistown', suburb: 'Blue Jacket' },

	// Namibia
	{ id: 'L010', county: 'Namibia', province: 'Khomas', city: 'Windhoek', suburb: 'Maerua' },
	{ id: 'L011', county: 'Namibia', province: 'Khomas', city: 'Windhoek', suburb: 'Grove Mall' },
	{ id: 'L012', county: 'Namibia', province: 'Erongo', city: 'Swakopmund', suburb: 'Vineta' },
	{ id: 'L013', county: 'Namibia', province: 'Oshana', city: 'Oshakati', suburb: 'Etango' },

	// Zimbabwe
	{ id: 'L014', county: 'Zimbabwe', province: 'Harare', city: 'Harare', suburb: 'Avondale' },
	{ id: 'L015', county: 'Zimbabwe', province: 'Harare', city: 'Harare', suburb: 'Borrowdale' },
	{ id: 'L016', county: 'Zimbabwe', province: 'Bulawayo', city: 'Bulawayo', suburb: 'Hillside' },
	{ id: 'L017', county: 'Zimbabwe', province: 'Manicaland', city: 'Mutare', suburb: 'Greenside' },

	// Zambia
	{ id: 'L018', county: 'Zambia', province: 'Lusaka', city: 'Lusaka', suburb: 'Woodlands' },
	{ id: 'L019', county: 'Zambia', province: 'Lusaka', city: 'Lusaka', suburb: 'Kabulonga' },
	{ id: 'L020', county: 'Zambia', province: 'Copperbelt', city: 'Kitwe', suburb: 'Parklands' },
	{ id: 'L021', county: 'Zambia', province: 'Copperbelt', city: 'Ndola', suburb: 'Kansenshi' },

	// Malawi
	{ id: 'L022', county: 'Malawi', province: 'Southern', city: 'Blantyre', suburb: 'Chichiri' },
	{ id: 'L023', county: 'Malawi', province: 'Southern', city: 'Blantyre', suburb: 'Limbe' },
	{ id: 'L024', county: 'Malawi', province: 'Central', city: 'Lilongwe', suburb: 'Area 47' },
	{ id: 'L025', county: 'Malawi', province: 'Central', city: 'Lilongwe', suburb: 'City Centre' },

	// Rwanda
	{ id: 'L026', county: 'Rwanda', province: 'Kigali', city: 'Kigali', suburb: 'Kimihurura' },
	{ id: 'L027', county: 'Rwanda', province: 'Kigali', city: 'Kigali', suburb: 'Nyarutarama' },
	{ id: 'L028', county: 'Rwanda', province: 'Eastern', city: 'Rwamagana', suburb: 'Central' },
	{ id: 'L029', county: 'Rwanda', province: 'Southern', city: 'Huye', suburb: 'Butare' },

	// Mozambique
	{ id: 'L030', county: 'Mozambique', province: 'Maputo', city: 'Maputo', suburb: 'Sommerschield' },
	{ id: 'L031', county: 'Mozambique', province: 'Maputo', city: 'Maputo', suburb: 'Polana' },
	{ id: 'L032', county: 'Mozambique', province: 'Sofala', city: 'Beira', suburb: 'Ponta Gea' },
	{ id: 'L033', county: 'Mozambique', province: 'Nampula', city: 'Nampula', suburb: 'Baixa' },
];

// ===================================================================
// PRODUCTS - Building Materials
// ===================================================================

export const products = [
	// Drywall & Partition Materials
	{ id: 'P001', name: 'Standard Drywall Sheet 1200x2400mm', category: 'Drywall & Partition', categoryId: 'CAT001', price: 145, costPrice: 98 },
	{ id: 'P002', name: 'Moisture Resistant Drywall 1200x2400mm', category: 'Drywall & Partition', categoryId: 'CAT001', price: 189, costPrice: 128 },
	{ id: 'P003', name: 'Fire Rated Drywall Sheet 1200x2400mm', category: 'Drywall & Partition', categoryId: 'CAT001', price: 225, costPrice: 155 },
	{ id: 'P004', name: 'Metal Stud Track 50mm x 3m', category: 'Drywall & Partition', categoryId: 'CAT001', price: 45, costPrice: 30 },
	{ id: 'P005', name: 'Metal Stud Channel 50mm x 3m', category: 'Drywall & Partition', categoryId: 'CAT001', price: 38, costPrice: 26 },
	{ id: 'P006', name: 'Drywall Screws 3.5x25mm (1000pk)', category: 'Drywall & Partition', categoryId: 'CAT001', price: 89, costPrice: 60 },
	{ id: 'P007', name: 'Joint Compound 20kg', category: 'Drywall & Partition', categoryId: 'CAT001', price: 178, costPrice: 120 },
	{ id: 'P008', name: 'Drywall Tape 50m Roll', category: 'Drywall & Partition', categoryId: 'CAT001', price: 42, costPrice: 28 },

	// Ceiling Materials
	{ id: 'P009', name: 'Ceiling Tile 600x600mm White', category: 'Ceiling Materials', categoryId: 'CAT002', price: 28, costPrice: 19 },
	{ id: 'P010', name: 'Ceiling Grid System 3.6m', category: 'Ceiling Materials', categoryId: 'CAT002', price: 125, costPrice: 85 },
	{ id: 'P011', name: 'Suspended Ceiling Hanger Wire 100m', category: 'Ceiling Materials', categoryId: 'CAT002', price: 89, costPrice: 60 },
	{ id: 'P012', name: 'Acoustic Ceiling Tile 600x600mm', category: 'Ceiling Materials', categoryId: 'CAT002', price: 45, costPrice: 30 },
	{ id: 'P013', name: 'PVC Ceiling Panel 250mm x 6m', category: 'Ceiling Materials', categoryId: 'CAT002', price: 156, costPrice: 105 },
	{ id: 'P014', name: 'Ceiling Corner Trim 3m White', category: 'Ceiling Materials', categoryId: 'CAT002', price: 35, costPrice: 24 },
	{ id: 'P015', name: 'Gypsum Ceiling Board 9mm', category: 'Ceiling Materials', categoryId: 'CAT002', price: 168, costPrice: 113 },

	// Roof Sealers & Waterproofing
	{ id: 'P016', name: 'Rubber Roof Sealer 5L', category: 'Roof Sealers', categoryId: 'CAT003', price: 445, costPrice: 300 },
	{ id: 'P017', name: 'Acrylic Roof Paint 20L', category: 'Roof Sealers', categoryId: 'CAT003', price: 1250, costPrice: 850 },
	{ id: 'P018', name: 'Bitumen Waterproofing 20L', category: 'Roof Sealers', categoryId: 'CAT003', price: 890, costPrice: 600 },
	{ id: 'P019', name: 'Roof Membrane Sheet 1m x 10m', category: 'Roof Sealers', categoryId: 'CAT003', price: 675, costPrice: 455 },
	{ id: 'P020', name: 'Silicone Roof Sealant Tube', category: 'Roof Sealers', categoryId: 'CAT003', price: 89, costPrice: 60 },
	{ id: 'P021', name: 'Polyurethane Roof Coating 10L', category: 'Roof Sealers', categoryId: 'CAT003', price: 1580, costPrice: 1070 },
	{ id: 'P022', name: 'Roof Primer 5L', category: 'Roof Sealers', categoryId: 'CAT003', price: 385, costPrice: 260 },

	// Insulation Materials
	{ id: 'P023', name: 'Fiberglass Insulation Roll 100mm', category: 'Insulation', categoryId: 'CAT004', price: 420, costPrice: 285 },
	{ id: 'P024', name: 'Foam Board Insulation 50mm', category: 'Insulation', categoryId: 'CAT004', price: 245, costPrice: 165 },
	{ id: 'P025', name: 'Reflective Foil Insulation 1.2m x 30m', category: 'Insulation', categoryId: 'CAT004', price: 890, costPrice: 600 },
	{ id: 'P026', name: 'Acoustic Insulation Batts', category: 'Insulation', categoryId: 'CAT004', price: 315, costPrice: 213 },

	// Adhesives & Compounds
	{ id: 'P027', name: 'Tile Adhesive 20kg', category: 'Adhesives & Compounds', categoryId: 'CAT005', price: 165, costPrice: 111 },
	{ id: 'P028', name: 'Construction Adhesive 310ml', category: 'Adhesives & Compounds', categoryId: 'CAT005', price: 68, costPrice: 46 },
	{ id: 'P029', name: 'Cement 50kg Bag', category: 'Adhesives & Compounds', categoryId: 'CAT005', price: 95, costPrice: 64 },
	{ id: 'P030', name: 'Plaster 25kg Bag', category: 'Adhesives & Compounds', categoryId: 'CAT005', price: 125, costPrice: 84 },
];

// ===================================================================
// BRANCHES
// ===================================================================

export const branches = [
	// South Africa
	{ id: 'B001', name: 'Sandton Branch', locationId: 'L001' },
	{ id: 'B002', name: 'Rosebank Branch', locationId: 'L002' },
	{ id: 'B003', name: 'Centurion Branch', locationId: 'L003' },
	{ id: 'B004', name: 'Cape Town CBD Branch', locationId: 'L004' },
	{ id: 'B005', name: 'Umhlanga Branch', locationId: 'L005' },
	
	// Botswana
	{ id: 'B006', name: 'Gaborone Main Branch', locationId: 'L006' },
	{ id: 'B007', name: 'Riverwalk Branch', locationId: 'L007' },
	{ id: 'B008', name: 'Maun Branch', locationId: 'L008' },
	{ id: 'B009', name: 'Francistown Branch', locationId: 'L009' },
	
	// Namibia
	{ id: 'B010', name: 'Maerua Branch', locationId: 'L010' },
	{ id: 'B011', name: 'Grove Mall Branch', locationId: 'L011' },
	{ id: 'B012', name: 'Swakopmund Branch', locationId: 'L012' },
	{ id: 'B013', name: 'Oshakati Branch', locationId: 'L013' },
	
	// Zimbabwe
	{ id: 'B014', name: 'Avondale Branch', locationId: 'L014' },
	{ id: 'B015', name: 'Borrowdale Branch', locationId: 'L015' },
	{ id: 'B016', name: 'Bulawayo Branch', locationId: 'L016' },
	{ id: 'B017', name: 'Mutare Branch', locationId: 'L017' },
	
	// Zambia
	{ id: 'B018', name: 'Woodlands Branch', locationId: 'L018' },
	{ id: 'B019', name: 'Kabulonga Branch', locationId: 'L019' },
	{ id: 'B020', name: 'Kitwe Branch', locationId: 'L020' },
	{ id: 'B021', name: 'Ndola Branch', locationId: 'L021' },
	
	// Malawi
	{ id: 'B022', name: 'Chichiri Branch', locationId: 'L022' },
	{ id: 'B023', name: 'Limbe Branch', locationId: 'L023' },
	{ id: 'B024', name: 'Lilongwe Area 47 Branch', locationId: 'L024' },
	{ id: 'B025', name: 'Lilongwe City Branch', locationId: 'L025' },
	
	// Rwanda
	{ id: 'B026', name: 'Kimihurura Branch', locationId: 'L026' },
	{ id: 'B027', name: 'Nyarutarama Branch', locationId: 'L027' },
	{ id: 'B028', name: 'Rwamagana Branch', locationId: 'L028' },
	{ id: 'B029', name: 'Huye Branch', locationId: 'L029' },
	
	// Mozambique
	{ id: 'B030', name: 'Sommerschield Branch', locationId: 'L030' },
	{ id: 'B031', name: 'Polana Branch', locationId: 'L031' },
	{ id: 'B032', name: 'Beira Branch', locationId: 'L032' },
	{ id: 'B033', name: 'Nampula Branch', locationId: 'L033' },
];

// ===================================================================
// SALES PEOPLE
// ===================================================================

export const salesPeople = [
	// South Africa - 10 people
	{ id: 'SP001', name: 'Thabo Molefe', branchId: 'B001', role: 'Sales Manager', employeeNumber: 'EMP001' },
	{ id: 'SP002', name: 'Sarah van der Merwe', branchId: 'B001', role: 'Sales Rep', employeeNumber: 'EMP002' },
	{ id: 'SP003', name: 'John Smith', branchId: 'B002', role: 'Sales Rep', employeeNumber: 'EMP003' },
	{ id: 'SP004', name: 'Zanele Khumalo', branchId: 'B002', role: 'Sales Manager', employeeNumber: 'EMP004' },
	{ id: 'SP005', name: 'Michael Chen', branchId: 'B003', role: 'Sales Rep', employeeNumber: 'EMP005' },
	{ id: 'SP006', name: 'Ayanda Ndlovu', branchId: 'B003', role: 'Senior Sales Rep', employeeNumber: 'EMP006' },
	{ id: 'SP007', name: 'Emma Johnson', branchId: 'B004', role: 'Sales Manager', employeeNumber: 'EMP007' },
	{ id: 'SP008', name: 'Sipho Dlamini', branchId: 'B004', role: 'Sales Rep', employeeNumber: 'EMP008' },
	{ id: 'SP009', name: 'Lisa Patel', branchId: 'B005', role: 'Senior Sales Rep', employeeNumber: 'EMP009' },
	{ id: 'SP010', name: 'David Naidoo', branchId: 'B005', role: 'Sales Rep', employeeNumber: 'EMP010' },
	
	// Botswana - 8 people
	{ id: 'SP011', name: 'Keabetswe Modise', branchId: 'B006', role: 'Sales Manager', employeeNumber: 'EMP011' },
	{ id: 'SP012', name: 'Bongani Mthembu', branchId: 'B006', role: 'Sales Rep', employeeNumber: 'EMP012' },
	{ id: 'SP013', name: 'Oratile Kgosi', branchId: 'B007', role: 'Sales Rep', employeeNumber: 'EMP013' },
	{ id: 'SP014', name: 'Lerato Mokoena', branchId: 'B007', role: 'Senior Sales Rep', employeeNumber: 'EMP014' },
	{ id: 'SP015', name: 'Tshepo Seretse', branchId: 'B008', role: 'Sales Manager', employeeNumber: 'EMP015' },
	{ id: 'SP016', name: 'Precious Sibiya', branchId: 'B008', role: 'Sales Rep', employeeNumber: 'EMP016' },
	{ id: 'SP017', name: 'Gorata Mmolai', branchId: 'B009', role: 'Sales Rep', employeeNumber: 'EMP017' },
	{ id: 'SP018', name: 'Nomsa Zulu', branchId: 'B009', role: 'Sales Manager', employeeNumber: 'EMP018' },
	
	// Namibia - 8 people
	{ id: 'SP019', name: 'Hans Schneider', branchId: 'B010', role: 'Sales Manager', employeeNumber: 'EMP019' },
	{ id: 'SP020', name: 'Thandiwe Sithole', branchId: 'B010', role: 'Sales Rep', employeeNumber: 'EMP020' },
	{ id: 'SP021', name: 'Petrus Haimbodi', branchId: 'B011', role: 'Senior Sales Rep', employeeNumber: 'EMP021' },
	{ id: 'SP022', name: 'Mpho Makgatho', branchId: 'B011', role: 'Sales Rep', employeeNumber: 'EMP022' },
	{ id: 'SP023', name: 'Anna Fischer', branchId: 'B012', role: 'Sales Manager', employeeNumber: 'EMP023' },
	{ id: 'SP024', name: 'Lungi Ntuli', branchId: 'B012', role: 'Sales Rep', employeeNumber: 'EMP024' },
	{ id: 'SP025', name: 'Samuel Nujoma', branchId: 'B013', role: 'Sales Rep', employeeNumber: 'EMP025' },
	{ id: 'SP026', name: 'Palesa Tladi', branchId: 'B013', role: 'Sales Manager', employeeNumber: 'EMP026' },
	
	// Zimbabwe - 8 people
	{ id: 'SP027', name: 'Tendai Moyo', branchId: 'B014', role: 'Sales Manager', employeeNumber: 'EMP027' },
	{ id: 'SP028', name: 'Busisiwe Ngcobo', branchId: 'B014', role: 'Sales Rep', employeeNumber: 'EMP028' },
	{ id: 'SP029', name: 'Tapiwa Chikwanha', branchId: 'B015', role: 'Senior Sales Rep', employeeNumber: 'EMP029' },
	{ id: 'SP030', name: 'Nandi Mhlongo', branchId: 'B015', role: 'Sales Rep', employeeNumber: 'EMP030' },
	{ id: 'SP031', name: 'Rufaro Mpofu', branchId: 'B016', role: 'Sales Manager', employeeNumber: 'EMP031' },
	{ id: 'SP032', name: 'Thuli Radebe', branchId: 'B016', role: 'Sales Rep', employeeNumber: 'EMP032' },
	{ id: 'SP033', name: 'Chipo Nyathi', branchId: 'B017', role: 'Sales Rep', employeeNumber: 'EMP033' },
	{ id: 'SP034', name: 'Zinhle Khoza', branchId: 'B017', role: 'Sales Manager', employeeNumber: 'EMP034' },
	
	// Zambia - 8 people
	{ id: 'SP035', name: 'Mulenga Banda', branchId: 'B018', role: 'Sales Manager', employeeNumber: 'EMP035' },
	{ id: 'SP036', name: 'Ntombi Zwane', branchId: 'B018', role: 'Sales Rep', employeeNumber: 'EMP036' },
	{ id: 'SP037', name: 'Chileshe Mwansa', branchId: 'B019', role: 'Senior Sales Rep', employeeNumber: 'EMP037' },
	{ id: 'SP038', name: 'Kagiso Mashaba', branchId: 'B019', role: 'Sales Rep', employeeNumber: 'EMP038' },
	{ id: 'SP039', name: 'Bwalya Chilufya', branchId: 'B020', role: 'Sales Manager', employeeNumber: 'EMP039' },
	{ id: 'SP040', name: 'Bontle Maloka', branchId: 'B020', role: 'Sales Rep', employeeNumber: 'EMP040' },
	{ id: 'SP041', name: 'Mutale Tembo', branchId: 'B021', role: 'Sales Rep', employeeNumber: 'EMP041' },
	{ id: 'SP042', name: 'Chanda Phiri', branchId: 'B021', role: 'Sales Manager', employeeNumber: 'EMP042' },
	
	// Malawi - 8 people
	{ id: 'SP043', name: 'Chimwemwe Banda', branchId: 'B022', role: 'Sales Manager', employeeNumber: 'EMP043' },
	{ id: 'SP044', name: 'Mphatso Phiri', branchId: 'B022', role: 'Sales Rep', employeeNumber: 'EMP044' },
	{ id: 'SP045', name: 'Kondwani Mwale', branchId: 'B023', role: 'Senior Sales Rep', employeeNumber: 'EMP045' },
	{ id: 'SP046', name: 'Tamanda Nyirenda', branchId: 'B023', role: 'Sales Rep', employeeNumber: 'EMP046' },
	{ id: 'SP047', name: 'Chisomo Tembo', branchId: 'B024', role: 'Sales Manager', employeeNumber: 'EMP047' },
	{ id: 'SP048', name: 'Pemphero Kasambara', branchId: 'B024', role: 'Sales Rep', employeeNumber: 'EMP048' },
	{ id: 'SP049', name: 'Thokozani Banda', branchId: 'B025', role: 'Sales Rep', employeeNumber: 'EMP049' },
	{ id: 'SP050', name: 'Yamikani Chirwa', branchId: 'B025', role: 'Sales Manager', employeeNumber: 'EMP050' },
	
	// Rwanda - 8 people
	{ id: 'SP051', name: 'Jean Claude Mugabo', branchId: 'B026', role: 'Sales Manager', employeeNumber: 'EMP051' },
	{ id: 'SP052', name: 'Aline Uwase', branchId: 'B026', role: 'Sales Rep', employeeNumber: 'EMP052' },
	{ id: 'SP053', name: 'Eric Niyonshuti', branchId: 'B027', role: 'Senior Sales Rep', employeeNumber: 'EMP053' },
	{ id: 'SP054', name: 'Grace Mutesi', branchId: 'B027', role: 'Sales Rep', employeeNumber: 'EMP054' },
	{ id: 'SP055', name: 'Patrick Habimana', branchId: 'B028', role: 'Sales Manager', employeeNumber: 'EMP055' },
	{ id: 'SP056', name: 'Divine Uwera', branchId: 'B028', role: 'Sales Rep', employeeNumber: 'EMP056' },
	{ id: 'SP057', name: 'Samuel Kayitare', branchId: 'B029', role: 'Sales Rep', employeeNumber: 'EMP057' },
	{ id: 'SP058', name: 'Claudine Umutoniwase', branchId: 'B029', role: 'Sales Manager', employeeNumber: 'EMP058' },
	
	// Mozambique - 8 people
	{ id: 'SP059', name: 'Carlos Alberto', branchId: 'B030', role: 'Sales Manager', employeeNumber: 'EMP059' },
	{ id: 'SP060', name: 'Maria Santos', branchId: 'B030', role: 'Sales Rep', employeeNumber: 'EMP060' },
	{ id: 'SP061', name: 'João Fernandes', branchId: 'B031', role: 'Senior Sales Rep', employeeNumber: 'EMP061' },
	{ id: 'SP062', name: 'Ana Costa', branchId: 'B031', role: 'Sales Rep', employeeNumber: 'EMP062' },
	{ id: 'SP063', name: 'Pedro Machado', branchId: 'B032', role: 'Sales Manager', employeeNumber: 'EMP063' },
	{ id: 'SP064', name: 'Filipa Silva', branchId: 'B032', role: 'Sales Rep', employeeNumber: 'EMP064' },
	{ id: 'SP065', name: 'Miguel Rodrigues', branchId: 'B033', role: 'Sales Rep', employeeNumber: 'EMP065' },
	{ id: 'SP066', name: 'Sofia Almeida', branchId: 'B033', role: 'Sales Manager', employeeNumber: 'EMP066' },
];

// ===================================================================
// MOCK DATA GENERATOR FUNCTIONS
// ===================================================================

/**
 * Generate performance data for a date range
 * Includes realistic patterns:
 * - Q1 (Jan-Mar): 95-115% of target (GREEN)
 * - Q2 (Apr-Jun): 100-125% of target (GREEN)
 * - Q3 (Jul-Sep): 70-90% of target (RED)
 * - Q4 (Oct-Dec): 90-110% of target (YELLOW/GREEN)
 */
export function generatePerformanceData(daysBack: number = 365) {
	const data = [];
	const today = new Date();
	let id = 1;

	for (let dayOffset = daysBack; dayOffset >= 0; dayOffset--) {
		const date = new Date(today);
		date.setDate(date.getDate() - dayOffset);
		const dateString = date.toISOString().split('T')[0];
		const month = date.getMonth(); // 0-11
		const dayOfWeek = date.getDay(); // 0-6

		// Performance multipliers by quarter
		let basePerformanceMultiplier = 1.0;
		
		if (month >= 0 && month <= 2) {
			basePerformanceMultiplier = 0.95 + Math.random() * 0.2;
		} else if (month >= 3 && month <= 5) {
			basePerformanceMultiplier = 1.0 + Math.random() * 0.25;
		} else if (month >= 6 && month <= 8) {
			basePerformanceMultiplier = 0.7 + Math.random() * 0.2;
		} else {
			basePerformanceMultiplier = 0.9 + Math.random() * 0.2;
		}

		// Weekends have lower performance
		if (dayOfWeek === 0 || dayOfWeek === 6) {
			basePerformanceMultiplier *= 0.85;
		}

		// Transactions per day
		const transactionsPerDay = dayOfWeek === 0 || dayOfWeek === 6 
			? Math.floor(Math.random() * 50) + 40
			: Math.floor(Math.random() * 80) + 60;

		// Ensure each branch gets transactions
		const branchesUsed = new Set<string>();
		const transactions = [];
		
		branches.forEach(branch => {
			const branchSalesPeople = salesPeople.filter(sp => sp.branchId === branch.id);
			if (branchSalesPeople.length > 0) {
				const salesPerson = branchSalesPeople[Math.floor(Math.random() * branchSalesPeople.length)];
				const product = products[Math.floor(Math.random() * products.length)];
				const quantity = Math.floor(Math.random() * 5) + 1;
				transactions.push({ product, salesPerson, quantity });
				branchesUsed.add(branch.id);
			}
		});
		
		const remainingTransactions = transactionsPerDay - transactions.length;
		for (let i = 0; i < remainingTransactions; i++) {
			const product = products[Math.floor(Math.random() * products.length)];
			const salesPerson = salesPeople[Math.floor(Math.random() * salesPeople.length)];
			const quantity = Math.floor(Math.random() * 5) + 1;
			transactions.push({ product, salesPerson, quantity });
		}
		
		for (const transaction of transactions) {
			const { product, salesPerson, quantity } = transaction;
			const revenue = product.price * quantity;
			
			let target = 0;
			switch (product.category) {
				case 'Drywall & Partition':
					target = 5000 + Math.random() * 3000;
					break;
				case 'Ceiling Materials':
					target = 4000 + Math.random() * 2000;
					break;
				case 'Roof Sealers':
					target = 8000 + Math.random() * 4000;
					break;
				case 'Insulation':
					target = 6000 + Math.random() * 3000;
					break;
				case 'Adhesives & Compounds':
					target = 3000 + Math.random() * 1500;
					break;
				default:
					target = 5000;
			}

			const randomVariance = 0.95 + Math.random() * 0.1;
			const performanceMultiplier = basePerformanceMultiplier * randomVariance;
			const actualSales = target * performanceMultiplier;

			data.push({
				id: `PD${id.toString().padStart(6, '0')}`,
				date: dateString,
				productId: product.id,
				branchId: salesPerson.branchId,
				salesPersonId: salesPerson.id,
				quantity,
				revenue,
				target,
				actualSales,
			});

			id++;
		}
	}

	return data;
}

/**
 * Generate sales transactions with GP calculations
 */
export function generateSalesTransactions(daysBack: number = 90) {
	const transactions = [];
	const today = new Date();
	let transactionId = 1;
	
	for (let dayOffset = daysBack; dayOffset >= 0; dayOffset--) {
		const date = new Date(today);
		date.setDate(date.getDate() - dayOffset);
		const dateString = date.toISOString().split('T')[0];
		const dayOfWeek = date.getDay();
		const month = date.getMonth();
		
		let seasonalMultiplier = 1.0;
		if (month >= 9 && month <= 11) {
			seasonalMultiplier = 1.3;
		} else if (month >= 6 && month <= 8) {
			seasonalMultiplier = 0.85;
		}
		
		const baseTransactionsPerDay = dayOfWeek === 0 || dayOfWeek === 6
			? Math.floor(Math.random() * 15) + 15
			: Math.floor(Math.random() * 30) + 30;
		
		const transactionsPerDay = Math.floor(baseTransactionsPerDay * seasonalMultiplier);
		
		const dailyClients = new Set<string>();
		const branchesUsedToday = new Set<string>();
		
		for (let i = 0; i < transactionsPerDay; i++) {
			// Select branch
			let branch;
			if (branchesUsedToday.size < Math.min(branches.length, 20)) {
				const unusedBranches = branches.filter(b => !branchesUsedToday.has(b.id));
				branch = unusedBranches[Math.floor(Math.random() * unusedBranches.length)];
			} else {
				const branchIndex = Math.floor(Math.pow(Math.random(), 0.7) * branches.length);
				branch = branches[branchIndex];
			}
			branchesUsedToday.add(branch.id);
			
			// Select product by category popularity
			let product;
			const categoryRandom = Math.random();
			if (categoryRandom < 0.35) {
				const drywallProducts = products.filter(p => p.categoryId === 'CAT001');
				product = drywallProducts[Math.floor(Math.random() * drywallProducts.length)];
			} else if (categoryRandom < 0.60) {
				const ceilingProducts = products.filter(p => p.categoryId === 'CAT002');
				product = ceilingProducts[Math.floor(Math.random() * ceilingProducts.length)];
			} else if (categoryRandom < 0.80) {
				const adhesiveProducts = products.filter(p => p.categoryId === 'CAT005');
				product = adhesiveProducts[Math.floor(Math.random() * adhesiveProducts.length)];
			} else if (categoryRandom < 0.93) {
				const roofProducts = products.filter(p => p.categoryId === 'CAT003');
				product = roofProducts[Math.floor(Math.random() * roofProducts.length)];
			} else {
				const insulationProducts = products.filter(p => p.categoryId === 'CAT004');
				product = insulationProducts[Math.floor(Math.random() * insulationProducts.length)];
			}
			
			// Quantity based on product type
			let quantity;
			if (product.categoryId === 'CAT001' || product.categoryId === 'CAT002') {
				quantity = Math.floor(Math.random() * 15) + 5;
			} else if (product.categoryId === 'CAT003' || product.categoryId === 'CAT004') {
				quantity = Math.floor(Math.random() * 8) + 2;
			} else {
				quantity = Math.floor(Math.random() * 5) + 1;
			}
			
			// Client ID
			const clientId = `CLIENT${Math.floor(Math.random() * 600) + 200}`;
			dailyClients.add(clientId);
			
			// Calculate values with variance
			const priceVariance = 0.95 + Math.random() * 0.15;
			const actualSalesPrice = product.price * priceVariance;
			const actualCostPrice = product.costPrice * priceVariance;
			
			const revenue = actualSalesPrice * quantity;
			const cost = actualCostPrice * quantity;
			const grossProfit = revenue - cost;
			const grossProfitPercentage = (grossProfit / revenue) * 100;
			
			transactions.push({
				id: `TXN${transactionId.toString().padStart(6, '0')}`,
				date: dateString,
				branchId: branch.id,
				categoryId: product.categoryId,
				productId: product.id,
				quantity,
				salesPrice: actualSalesPrice,
				costPrice: actualCostPrice,
				revenue,
				cost,
				grossProfit,
				grossProfitPercentage,
				clientId,
			});
			
			transactionId++;
		}
	}
	
	return transactions;
}

