import { Test, TestingModule } from '@nestjs/testing';
import { ErpTransformerService } from './erp-transformer.service';
import { TblSalesLines } from '../entities/tblsaleslines.entity';
import { TblSalesHeader } from '../entities/tblsalesheader.entity';

describe('ErpTransformerService', () => {
	let service: ErpTransformerService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [ErpTransformerService],
		}).compile();

		service = module.get<ErpTransformerService>(ErpTransformerService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('transformToSalesTransaction', () => {
		it('should transform a sales line to sales transaction format', () => {
			const salesLine: Partial<TblSalesLines> = {
				ID: 1,
				sale_date: new Date('2024-01-15'),
				store: '001',
				category: 'Drywall',
				item_code: 'P001',
				quantity: 10,
				incl_price: 145.50,
				cost_price: 98.00,
				incl_line_total: 1455.00,
				discount: 50.00,
				customer: 'CLIENT123',
			};

			const result = service.transformToSalesTransaction(salesLine as TblSalesLines);

			expect(result).toBeDefined();
			expect(result.id).toContain('TXN');
			expect(result.date).toBe('2024-01-15');
			expect(result.branchId).toBe('B001');
			expect(result.categoryId).toBe('CAT001');
			expect(result.productId).toBe('P001');
			expect(result.quantity).toBe(10);
			expect(result.salesPrice).toBe(145.50);
			expect(result.costPrice).toBe(98.00);
			expect(result.clientId).toBe('CLIENT123');
		});

		it('should calculate gross profit correctly', () => {
			const salesLine: Partial<TblSalesLines> = {
				ID: 2,
				sale_date: new Date('2024-01-15'),
				store: '002',
				category: 'Ceiling',
				item_code: 'P009',
				quantity: 20,
				incl_price: 28.00,
				cost_price: 19.00,
				incl_line_total: 560.00,
				discount: 10.00,
				customer: 'CLIENT456',
			};

			const result = service.transformToSalesTransaction(salesLine as TblSalesLines);

			// revenue = incl_line_total - discount = 560 - 10 = 550
			// cost = cost_price * quantity = 19 * 20 = 380
			// grossProfit = revenue - cost = 550 - 380 = 170
			// gpPercentage = (170 / 550) * 100 = 30.91%

			expect(result.revenue).toBe(550);
			expect(result.cost).toBe(380);
			expect(result.grossProfit).toBe(170);
			expect(result.grossProfitPercentage).toBeCloseTo(30.91, 2);
		});

		it('should handle zero discount', () => {
			const salesLine: Partial<TblSalesLines> = {
				ID: 3,
				sale_date: new Date('2024-01-15'),
				store: '001',
				category: 'Drywall',
				item_code: 'P001',
				quantity: 5,
				incl_price: 145.00,
				cost_price: 98.00,
				incl_line_total: 725.00,
				discount: 0,
				customer: 'CLIENT789',
			};

			const result = service.transformToSalesTransaction(salesLine as TblSalesLines);

			expect(result.revenue).toBe(725);
			expect(result.cost).toBe(490);
			expect(result.grossProfit).toBe(235);
		});

		it('should handle null/undefined values gracefully', () => {
			const salesLine: Partial<TblSalesLines> = {
				ID: 4,
				sale_date: new Date('2024-01-15'),
				store: '001',
				category: null,
				item_code: null,
				quantity: null,
				incl_price: null,
				cost_price: null,
				incl_line_total: null,
				discount: null,
				customer: null,
			};

			const result = service.transformToSalesTransaction(salesLine as TblSalesLines);

			expect(result).toBeDefined();
			expect(result.revenue).toBe(0);
			expect(result.cost).toBe(0);
			expect(result.grossProfit).toBe(0);
			expect(result.grossProfitPercentage).toBe(0);
			expect(result.productId).toBe('UNKNOWN');
			expect(result.clientId).toBe('UNKNOWN');
		});
	});

	describe('transformToPerformanceData', () => {
		it('should transform a sales line to performance data format', () => {
			const salesLine: Partial<TblSalesLines> = {
				ID: 5,
				sale_date: new Date('2024-01-15'),
				store: '001',
				item_code: 'P001',
				rep_code: 'SP001',
				quantity: 10,
				incl_line_total: 1455.00,
				discount: 50.00,
				cost_price: 98.00,
			};

			const result = service.transformToPerformanceData(salesLine as TblSalesLines);

			expect(result).toBeDefined();
			expect(result.id).toContain('PD');
			expect(result.date).toBe('2024-01-15');
			expect(result.productId).toBe('P001');
			expect(result.branchId).toBe('B001');
			expect(result.salesPersonId).toBe('SP001');
			expect(result.quantity).toBe(10);
			expect(result.revenue).toBe(1405); // 1455 - 50
			expect(result.actualSales).toBe(1405);
			expect(result.target).toBeGreaterThan(result.revenue); // Target is 20% above revenue
		});
	});

	describe('calculateSummaryStats', () => {
		it('should calculate summary statistics correctly', () => {
			const transactions = [
				{
					id: 'TXN1',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT001',
					productId: 'P001',
					quantity: 10,
					salesPrice: 145,
					costPrice: 98,
					revenue: 1450,
					cost: 980,
					grossProfit: 470,
					grossProfitPercentage: 32.41,
					clientId: 'CLIENT1',
				},
				{
					id: 'TXN2',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT001',
					productId: 'P002',
					quantity: 5,
					salesPrice: 189,
					costPrice: 128,
					revenue: 945,
					cost: 640,
					grossProfit: 305,
					grossProfitPercentage: 32.28,
					clientId: 'CLIENT2',
				},
				{
					id: 'TXN3',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT002',
					productId: 'P009',
					quantity: 20,
					salesPrice: 28,
					costPrice: 19,
					revenue: 560,
					cost: 380,
					grossProfit: 180,
					grossProfitPercentage: 32.14,
					clientId: 'CLIENT1',
				},
			];

			const result = service.calculateSummaryStats(transactions);

			expect(result.totalRevenue).toBe(2955);
			expect(result.totalCost).toBe(2000);
			expect(result.totalGrossProfit).toBe(955);
			expect(result.totalQuantity).toBe(35);
			expect(result.transactionCount).toBe(3);
			expect(result.uniqueClients).toBe(2); // CLIENT1 and CLIENT2
			expect(result.averageBasketValue).toBeCloseTo(985, 0);
			expect(result.gpPercentage).toBeCloseTo(32.32, 2);
		});

		it('should handle empty transactions array', () => {
			const result = service.calculateSummaryStats([]);

			expect(result.totalRevenue).toBe(0);
			expect(result.totalCost).toBe(0);
			expect(result.totalGrossProfit).toBe(0);
			expect(result.totalQuantity).toBe(0);
			expect(result.transactionCount).toBe(0);
			expect(result.uniqueClients).toBe(0);
			expect(result.averageBasketValue).toBe(0);
			expect(result.gpPercentage).toBe(0);
		});
	});

	describe('calculateGrossProfitMetrics', () => {
		it('should calculate gross profit metrics from sales lines', () => {
			const salesLines: Partial<TblSalesLines>[] = [
				{
					ID: 1,
					incl_line_total: 1455,
					discount: 50,
					cost_price: 98,
					quantity: 10,
					category: 'Drywall',
				},
				{
					ID: 2,
					incl_line_total: 945,
					discount: 0,
					cost_price: 128,
					quantity: 5,
					category: 'Drywall',
				},
				{
					ID: 3,
					incl_line_total: 560,
					discount: 10,
					cost_price: 19,
					quantity: 20,
					category: 'Ceiling',
				},
			];

			const result = service.calculateGrossProfitMetrics(salesLines as TblSalesLines[]);

			// Total revenue = (1455-50) + (945-0) + (560-10) = 1405 + 945 + 550 = 2900
			// Total cost = (98*10) + (128*5) + (19*20) = 980 + 640 + 380 = 2000
			// Total GP = 2900 - 2000 = 900

			expect(result.totalRevenue).toBe(2900);
			expect(result.totalCost).toBe(2000);
			expect(result.totalGrossProfit).toBe(900);
			expect(result.averageGPPercentage).toBeCloseTo(31.03, 2);
			expect(result.bestPerformingCategory).toBe('Drywall');
			expect(result.worstPerformingCategory).toBe('Ceiling');
		});

		it('should handle empty sales lines array', () => {
			const result = service.calculateGrossProfitMetrics([]);

			expect(result.totalRevenue).toBe(0);
			expect(result.totalCost).toBe(0);
			expect(result.totalGrossProfit).toBe(0);
			expect(result.averageGPPercentage).toBe(0);
			expect(result.bestPerformingCategory).toBeNull();
			expect(result.worstPerformingCategory).toBeNull();
		});
	});

	describe('aggregateByDate', () => {
		it('should aggregate transactions by date', () => {
			const transactions = [
				{
					id: 'TXN1',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT001',
					productId: 'P001',
					quantity: 10,
					salesPrice: 145,
					costPrice: 98,
					revenue: 1450,
					cost: 980,
					grossProfit: 470,
					grossProfitPercentage: 32.41,
					clientId: 'CLIENT1',
				},
				{
					id: 'TXN2',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT001',
					productId: 'P002',
					quantity: 5,
					salesPrice: 189,
					costPrice: 128,
					revenue: 945,
					cost: 640,
					grossProfit: 305,
					grossProfitPercentage: 32.28,
					clientId: 'CLIENT2',
				},
				{
					id: 'TXN3',
					date: '2024-01-16',
					branchId: 'B001',
					categoryId: 'CAT002',
					productId: 'P009',
					quantity: 20,
					salesPrice: 28,
					costPrice: 19,
					revenue: 560,
					cost: 380,
					grossProfit: 180,
					grossProfitPercentage: 32.14,
					clientId: 'CLIENT1',
				},
			];

			const result = service.aggregateByDate(transactions);

			expect(result.size).toBe(2);
			expect(result.get('2024-01-15')?.length).toBe(2);
			expect(result.get('2024-01-16')?.length).toBe(1);
		});
	});

	describe('aggregateByBranch', () => {
		it('should aggregate transactions by branch', () => {
			const transactions = [
				{
					id: 'TXN1',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT001',
					productId: 'P001',
					quantity: 10,
					salesPrice: 145,
					costPrice: 98,
					revenue: 1450,
					cost: 980,
					grossProfit: 470,
					grossProfitPercentage: 32.41,
					clientId: 'CLIENT1',
				},
				{
					id: 'TXN2',
					date: '2024-01-15',
					branchId: 'B002',
					categoryId: 'CAT001',
					productId: 'P002',
					quantity: 5,
					salesPrice: 189,
					costPrice: 128,
					revenue: 945,
					cost: 640,
					grossProfit: 305,
					grossProfitPercentage: 32.28,
					clientId: 'CLIENT2',
				},
			];

			const result = service.aggregateByBranch(transactions);

			expect(result.size).toBe(2);
			expect(result.get('B001')?.length).toBe(1);
			expect(result.get('B002')?.length).toBe(1);
		});
	});

	describe('aggregateByCategory', () => {
		it('should aggregate transactions by category', () => {
			const transactions = [
				{
					id: 'TXN1',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT001',
					productId: 'P001',
					quantity: 10,
					salesPrice: 145,
					costPrice: 98,
					revenue: 1450,
					cost: 980,
					grossProfit: 470,
					grossProfitPercentage: 32.41,
					clientId: 'CLIENT1',
				},
				{
					id: 'TXN2',
					date: '2024-01-15',
					branchId: 'B001',
					categoryId: 'CAT002',
					productId: 'P009',
					quantity: 20,
					salesPrice: 28,
					costPrice: 19,
					revenue: 560,
					cost: 380,
					grossProfit: 180,
					grossProfitPercentage: 32.14,
					clientId: 'CLIENT1',
				},
			];

			const result = service.aggregateByCategory(transactions);

			expect(result.size).toBe(2);
			expect(result.get('CAT001')?.length).toBe(1);
			expect(result.get('CAT002')?.length).toBe(1);
		});
	});
});

