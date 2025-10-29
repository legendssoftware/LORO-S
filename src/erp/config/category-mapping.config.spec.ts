import { getCategoryId, getBranchId, getCategoryName } from './category-mapping.config';

describe('Category Mapping Configuration', () => {
	describe('getCategoryId', () => {
		it('should return correct category ID for exact match', () => {
			expect(getCategoryId('Drywall')).toBe('CAT001');
			expect(getCategoryId('Ceiling')).toBe('CAT002');
			expect(getCategoryId('Roof')).toBe('CAT003');
			expect(getCategoryId('Insulation')).toBe('CAT004');
			expect(getCategoryId('Adhesive')).toBe('CAT005');
		});

		it('should return category ID for case-insensitive partial match', () => {
			expect(getCategoryId('drywall')).toBe('CAT001');
			expect(getCategoryId('CEILING TILES')).toBe('CAT002');
			expect(getCategoryId('roof sealer')).toBe('CAT003');
			expect(getCategoryId('fiberglass insulation')).toBe('CAT004');
			expect(getCategoryId('tile adhesive')).toBe('CAT005');
		});

		it('should return default category for unknown category', () => {
			expect(getCategoryId('Unknown Category')).toBe('CAT001');
			expect(getCategoryId('Random')).toBe('CAT001');
		});

		it('should handle null/undefined values', () => {
			expect(getCategoryId(null)).toBe('CAT001');
			expect(getCategoryId(undefined)).toBe('CAT001');
			expect(getCategoryId('')).toBe('CAT001');
		});
	});

	describe('getBranchId', () => {
		it('should return correct branch ID for store code', () => {
			expect(getBranchId('001')).toBe('B001');
			expect(getBranchId('002')).toBe('B002');
			expect(getBranchId('010')).toBe('B010');
			expect(getBranchId('033')).toBe('B033');
		});

		it('should normalize store codes with leading zeros', () => {
			expect(getBranchId('1')).toBe('B001');
			expect(getBranchId('02')).toBe('B002');
			expect(getBranchId('001')).toBe('B001');
		});

		it('should return default branch for unknown store', () => {
			expect(getBranchId('999')).toBe('B001');
			expect(getBranchId('ABC')).toBe('B001');
		});

		it('should handle null/undefined values', () => {
			expect(getBranchId(null)).toBe('B001');
			expect(getBranchId(undefined)).toBe('B001');
			expect(getBranchId('')).toBe('B001');
		});
	});

	describe('getCategoryName', () => {
		it('should return correct category name for category ID', () => {
			expect(getCategoryName('CAT001')).toBe('Drywall & Partition');
			expect(getCategoryName('CAT002')).toBe('Ceiling Materials');
			expect(getCategoryName('CAT003')).toBe('Roof Sealers');
			expect(getCategoryName('CAT004')).toBe('Insulation');
			expect(getCategoryName('CAT005')).toBe('Adhesives & Compounds');
		});

		it('should return "Other" for unknown category ID', () => {
			expect(getCategoryName('CAT999')).toBe('Other');
			expect(getCategoryName('UNKNOWN')).toBe('Other');
		});
	});
});

