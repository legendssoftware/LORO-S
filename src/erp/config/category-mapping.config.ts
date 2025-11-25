/**
 * ERP Category to ProductCategory Mapping Configuration
 * 
 * This is a cache-only mapping that connects ERP category codes/names
 * to the ProductCategory IDs used in the performance dashboard.
 * 
 * Based on the product categories defined in performance-mock-data.ts:
 * - CAT001: Drywall & Partition
 * - CAT002: Ceiling Materials
 * - CAT003: Roof Sealers
 * - CAT004: Insulation
 * - CAT005: Adhesives & Compounds
 */

export interface CategoryMapping {
	erpCategory: string;
	productCategoryId: string;
	productCategoryName: string;
}

export const CATEGORY_MAPPING: Record<string, string> = {
	// Drywall & Partition Materials
	'Drywall': 'CAT001',
	'DryWall': 'CAT001',
	'Partition': 'CAT001',
	'Gypsum': 'CAT001',
	'Plasterboard': 'CAT001',
	'Studs': 'CAT001',
	'Metal Track': 'CAT001',
	
	// Ceiling Materials
	'Ceiling': 'CAT002',
	'Ceiling Tiles': 'CAT002',
	'Ceiling Grid': 'CAT002',
	'Suspended Ceiling': 'CAT002',
	'PVC Ceiling': 'CAT002',
	
	// Roof Sealers & Waterproofing
	'Roof': 'CAT003',
	'Roof Sealer': 'CAT003',
	'Waterproofing': 'CAT003',
	'Bitumen': 'CAT003',
	'Roof Paint': 'CAT003',
	'Roof Coating': 'CAT003',
	'Silicone Sealant': 'CAT003',
	
	// Insulation Materials
	'Insulation': 'CAT004',
	'Fiberglass': 'CAT004',
	'Foam Board': 'CAT004',
	'Reflective Foil': 'CAT004',
	'Acoustic': 'CAT004',
	
	// Adhesives & Compounds
	'Adhesive': 'CAT005',
	'Cement': 'CAT005',
	'Tile Adhesive': 'CAT005',
	'Construction Adhesive': 'CAT005',
	'Plaster': 'CAT005',
	'Joint Compound': 'CAT005',
	
	// Default fallback
	'Other': 'CAT001',
	'Miscellaneous': 'CAT001',
	'General': 'CAT001',
};

/**
 * Store Code to Branch ID Mapping Configuration
 * 
 * Maps ERP store codes (e.g., '001', '002') to Branch IDs
 * defined in the performance dashboard mock data.
 * 
 * This is cache-only and should be configured based on actual
 * store locations in the ERP system.
 */
export const STORE_BRANCH_MAPPING: Record<string, string> = {
	// South Africa - Only these branches are active
	'001': 'B001',
	'002': 'B002',
	'003': 'B003',
	'004': 'B004',
	'005': 'B005',
	'006': 'B006',
	'007': 'B007',
	'008': 'B008',
	'009': 'B009',
	'010': 'B010',
	'011': 'B011',
	'012': 'B012',
	'013': 'B013',
	'014': 'B014',
	'015': 'B015',
	'016': 'B016',
	'017': 'B017',
	'018': 'B018',
	'019': 'B019',
	'020': 'B020',
	'021': 'B021',
	'022': 'B022',
	'023': 'B023',
	
	// Default fallback for unknown stores
	'000': 'B001', // Default to first branch
};

/**
 * Helper function to get category ID from ERP category string
 */
export function getCategoryId(erpCategory: string | null | undefined): string {
	if (!erpCategory) return 'CAT001'; // Default category
	
	// Try exact match first
	if (CATEGORY_MAPPING[erpCategory]) {
		return CATEGORY_MAPPING[erpCategory];
	}
	
	// Try case-insensitive partial match
	const normalizedCategory = erpCategory.toLowerCase().trim();
	for (const [key, value] of Object.entries(CATEGORY_MAPPING)) {
		if (normalizedCategory.includes(key.toLowerCase())) {
			return value;
		}
	}
	
	// Default fallback
	return 'CAT001';
}

/**
 * Helper function to get branch ID from ERP store code
 */
export function getBranchId(storeCode: string | null | undefined): string {
	if (!storeCode) return 'B001'; // Default branch
	
	// Normalize store code (remove leading zeros, pad to 3 digits)
	const normalizedStore = storeCode.trim().padStart(3, '0');
	
	return STORE_BRANCH_MAPPING[normalizedStore] || 'B001';
}

/**
 * Get category name from category ID
 */
export function getCategoryName(categoryId: string): string {
	const categoryNames: Record<string, string> = {
		'CAT001': 'Drywall & Partition',
		'CAT002': 'Ceiling Materials',
		'CAT003': 'Roof Sealers',
		'CAT004': 'Insulation',
		'CAT005': 'Adhesives & Compounds',
	};
	
	return categoryNames[categoryId] || 'Other';
}

/**
 * Store Code to Branch Alias Mapping
 * Maps ERP store codes to branch aliases from database
 * Only South Africa branches are included
 */
export const STORE_NAME_MAPPING: Record<string, string> = {
	// South Africa - Only these branches are active (using aliases from database)
	'001': 'BitDenver',
	'002': 'BitBoksburg',
	'003': 'BitLanseria',
	'004': 'BitMidrand',
	'005': 'BitRobertsville',
	'006': 'BitBurgersfort',
	'007': 'BitWitbank', // EMALAHLENI
	'008': 'BitPolokwane',
	'009': 'BitNelspruit',
	'010': 'BitTzaneen',
	'011': 'BitSouthgate',
	'012': 'BitRichardsBay',
	'013': 'BitRandfontein',
	'014': 'BitMokopane',
	'015': 'BitBethlehem',
	'016': 'BitRustenburg',
	'017': 'BitThohoyandou',
	'018': 'BitGiyani',
	'019': 'BitLouis Trichardt',
	'020': 'BitMafikeng',
	'021': 'BitBronkhorstspruit',
	'022': 'BitPE', // Port Elizabeth
	'023': 'BitGeorge',
};

/**
 * Country to Store Code Mapping
 * Active countries: SA, Zambia (ZAM), Mozambique (MOZ)
 * Store codes are dynamically fetched from each country's database
 * This mapping is used for validation and filtering
 */
export const COUNTRY_STORE_MAPPING: Record<string, string[]> = {
	'SA': ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018', '019', '020', '021', '022', '023'],
	'ZAM': [], // Zambia store codes - dynamically loaded from bit_zambia database
	'MOZ': [], // Mozambique store codes - dynamically loaded from bit_mozambique database
};

/**
 * Store Code to Country Mapping
 * Maps store codes to their country
 * Note: Zambia and Mozambique store codes are determined dynamically from their respective databases
 */
export const STORE_COUNTRY_MAPPING: Record<string, string> = {
	// South Africa - All active stores
	'001': 'SA', '002': 'SA', '003': 'SA', '004': 'SA', '005': 'SA',
	'006': 'SA', '007': 'SA', '008': 'SA', '009': 'SA', '010': 'SA',
	'011': 'SA', '012': 'SA', '013': 'SA', '014': 'SA', '015': 'SA',
	'016': 'SA', '017': 'SA', '018': 'SA', '019': 'SA', '020': 'SA',
	'021': 'SA', '022': 'SA', '023': 'SA',
	// Zambia and Mozambique stores are determined dynamically from their respective databases
};

/**
 * Helper function to get branch name from ERP store code
 */
export function getBranchName(storeCode: string | null | undefined): string {
	if (!storeCode) return 'Unknown Branch';
	
	// Normalize store code (remove leading zeros, pad to 3 digits)
	const normalizedStore = storeCode.trim().padStart(3, '0');
	
	// Return the friendly name or the store code itself as fallback
	return STORE_NAME_MAPPING[normalizedStore] || storeCode;
}

/**
 * Helper function to get country from ERP store code
 */
export function getCountryFromStoreCode(storeCode: string | null | undefined): string {
	if (!storeCode) return 'SA'; // Default to SA
	
	// Normalize store code (remove leading zeros, pad to 3 digits)
	const normalizedStore = storeCode.trim().padStart(3, '0');
	
	// Return the country or default to SA
	return STORE_COUNTRY_MAPPING[normalizedStore] || 'SA';
}

/**
 * Helper function to get store codes for a country
 */
export function getStoreCodesForCountry(country: string): string[] {
	return COUNTRY_STORE_MAPPING[country] || [];
}

