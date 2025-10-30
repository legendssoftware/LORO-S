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
	// South Africa
	'001': 'B001', // Sandton Branch
	'002': 'B002', // Rosebank Branch
	'003': 'B003', // Centurion Branch
	'004': 'B004', // Cape Town CBD Branch
	'005': 'B005', // Umhlanga Branch
	
	// Botswana
	'006': 'B006', // Gaborone Main Branch
	'007': 'B007', // Riverwalk Branch
	'008': 'B008', // Maun Branch
	'009': 'B009', // Francistown Branch
	
	// Namibia
	'010': 'B010', // Maerua Branch
	'011': 'B011', // Grove Mall Branch
	'012': 'B012', // Swakopmund Branch
	'013': 'B013', // Oshakati Branch
	
	// Zimbabwe
	'014': 'B014', // Avondale Branch
	'015': 'B015', // Borrowdale Branch
	'016': 'B016', // Bulawayo Branch
	'017': 'B017', // Mutare Branch
	
	// Zambia
	'018': 'B018', // Woodlands Branch
	'019': 'B019', // Kabulonga Branch
	'020': 'B020', // Kitwe Branch
	'021': 'B021', // Ndola Branch
	
	// Malawi
	'022': 'B022', // Chichiri Branch
	'023': 'B023', // Limbe Branch
	'024': 'B024', // Lilongwe Area 47 Branch
	'025': 'B025', // Lilongwe City Branch
	
	// Rwanda
	'026': 'B026', // Kimihurura Branch
	'027': 'B027', // Nyarutarama Branch
	'028': 'B028', // Rwamagana Branch
	'029': 'B029', // Huye Branch
	
	// Mozambique
	'030': 'B030', // Sommerschield Branch
	'031': 'B031', // Polana Branch
	'032': 'B032', // Beira Branch
	'033': 'B033', // Nampula Branch
	
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
 * Store Code to Branch Name Mapping
 * Maps ERP store codes to human-readable branch names
 */
export const STORE_NAME_MAPPING: Record<string, string> = {
	// South Africa
	'001': 'Sandton',
	'002': 'Rosebank',
	'003': 'Centurion',
	'004': 'Cape Town CBD',
	'005': 'Umhlanga',
	
	// Botswana
	'006': 'Gaborone Main',
	'007': 'Riverwalk',
	'008': 'Maun',
	'009': 'Francistown',
	
	// Namibia
	'010': 'Maerua',
	'011': 'Grove Mall',
	'012': 'Swakopmund',
	'013': 'Oshakati',
	
	// Zimbabwe
	'014': 'Avondale',
	'015': 'Borrowdale',
	'016': 'Bulawayo',
	'017': 'Mutare',
	
	// Zambia
	'018': 'Woodlands',
	'019': 'Kabulonga',
	'020': 'Kitwe',
	'021': 'Ndola',
	
	// Malawi
	'022': 'Chichiri',
	'023': 'Limbe',
	'024': 'Lilongwe Area 47',
	'025': 'Lilongwe City',
	
	// Rwanda
	'026': 'Kimihurura',
	'027': 'Nyarutarama',
	'028': 'Rwamagana',
	'029': 'Huye',
	
	// Mozambique
	'030': 'Sommerschield',
	'031': 'Polana',
	'032': 'Beira',
	'033': 'Nampula',
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

