import { User } from './user.entity'; // Adjusted path assuming it's in the same directory
import { Entity, Column, PrimaryGeneratedColumn, OneToOne, CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate } from 'typeorm';

@Entity('user_targets')
export class UserTarget {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	targetSalesAmount: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	currentSalesAmount: number;

	// Separate tracking for quotations (quotes made but not paid)
	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	targetQuotationsAmount: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	currentQuotationsAmount: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	currentOrdersAmount: number;

	@Column({ nullable: true })
	targetCurrency: string;

	@Column({ type: 'int', nullable: true })
	targetHoursWorked: number;

	@Column({ type: 'int', nullable: true })
	currentHoursWorked: number;

	@Column({ type: 'int', nullable: true })
	targetNewClients: number;

	@Column({ type: 'int', nullable: true })
	currentNewClients: number;

	@Column({ type: 'int', nullable: true })
	targetNewLeads: number;

	@Column({ type: 'int', nullable: true })
	currentNewLeads: number;

	@Column({ type: 'int', nullable: true })
	targetCheckIns: number;

	@Column({ type: 'int', nullable: true })
	currentCheckIns: number;

	@Column({ type: 'int', nullable: true })
	targetCalls: number;

	@Column({ type: 'int', nullable: true })
	currentCalls: number;

	// Cost Breakdown Fields (Monthly) - All in ZAR
	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	baseSalary: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	carInstalment: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	carInsurance: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	fuel: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	cellPhoneAllowance: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	carMaintenance: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	cgicCosts: number;

	@Column({
		type: 'decimal',
		precision: 15,
		scale: 2,
		nullable: true,
		default: 0,
		transformer: {
			to: (value: number) => value,
			from: (value: string) => (value ? parseFloat(value) : null),
		},
	})
	totalCost: number;

	@Column({ nullable: true })
	targetPeriod: string;

	@Column({ type: 'date', nullable: true })
	periodStartDate: Date;

	@Column({ type: 'date', nullable: true })
	periodEndDate: Date;

	@Column({ type: 'timestamp', nullable: true })
	lastCalculatedAt: Date;

	// 🔄 Recurring Target Configuration
	@Column({ type: 'boolean', default: true, comment: 'Enable automatic target recurrence' })
	isRecurring: boolean;

	@Column({ 
		type: 'enum', 
		enum: ['daily', 'weekly', 'monthly'],
		default: 'monthly',
		nullable: true,
		comment: 'Frequency of target recurrence'
	})
	recurringInterval?: 'daily' | 'weekly' | 'monthly';

	@Column({ 
		type: 'boolean', 
		default: false, 
		comment: 'Add unfulfilled targets to next period' 
	})
	carryForwardUnfulfilled: boolean;

	@Column({ 
		type: 'timestamp', 
		nullable: true,
		comment: 'Calculated date when next recurrence should happen'
	})
	nextRecurrenceDate: Date;

	@Column({ 
		type: 'timestamp', 
		nullable: true,
		comment: 'When the last recurrence was processed'
	})
	lastRecurrenceDate: Date;

	@Column({ 
		type: 'int', 
		default: 0,
		comment: 'Number of times this target has recurred'
	})
	recurrenceCount: number;

	@Column({ 
		nullable: true,
		comment: 'ERP sales rep code (sales_code) for linking to ERP data'
	})
	erpSalesRepCode: string;

	// Monthly target history tracking
	@Column({
		type: 'json',
		nullable: true,
		comment: 'JSON array tracking monthly target performance history',
		transformer: {
			to: (value: any) => {
				// When saving, ensure it's a valid JSON string
				if (value === null || value === undefined) return null;
				if (typeof value === 'string') return value;
				return JSON.stringify(value);
			},
			from: (value: string | any) => {
				// When loading, parse JSON string to array
				if (value === null || value === undefined) return [];
				if (typeof value === 'string') {
					try {
						const parsed = JSON.parse(value);
						return Array.isArray(parsed) ? parsed : [];
					} catch (e) {
						console.error('Failed to parse history JSON:', e, 'Raw value:', value);
						return [];
					}
				}
				// If already parsed (shouldn't happen but handle it)
				return Array.isArray(value) ? value : [];
			},
		},
	})
	history: {
		date: string; // YYYY-MM format
		targetSalesAmount?: number;
		achievedSalesAmount?: number;
		targetQuotationsAmount?: number;
		achievedQuotationsAmount?: number;
		targetOrdersAmount?: number;
		achievedOrdersAmount?: number;
		targetNewClients?: number;
		achievedNewClients?: number;
		targetNewLeads?: number;
		achievedNewLeads?: number;
		targetCheckIns?: number;
		achievedCheckIns?: number;
		targetCalls?: number;
		achievedCalls?: number;
		targetHoursWorked?: number;
		achievedHoursWorked?: number;
		missingAmount?: number; // Amount missing to reach target
		completionPercentage?: number; // Overall completion percentage for the month
		status: 'achieved' | 'partial' | 'missed'; // Completion status
		lastUpdated: string; // ISO timestamp when this record was created/updated
	}[];

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@OneToOne(() => User, (user) => user.userTarget)
	user: User;

	/**
	 * Auto-calculate totalCost before insert
	 * Sums all individual cost components to ensure accurate total
	 */
	@BeforeInsert()
	calculateTotalCostBeforeInsert() {
		this.totalCost = this.calculateTotalCost();
	}

	/**
	 * Auto-calculate totalCost before update
	 * Ensures totalCost is always in sync with individual cost fields
	 */
	@BeforeUpdate()
	calculateTotalCostBeforeUpdate() {
		this.totalCost = this.calculateTotalCost();
	}

	/**
	 * Helper method to calculate total cost from all individual components
	 * Returns the sum of: baseSalary + carInstalment + carInsurance + fuel + cellPhoneAllowance + carMaintenance + cgicCosts
	 */
	private calculateTotalCost(): number {
		const baseSalary = this.baseSalary || 0;
		const carInstalment = this.carInstalment || 0;
		const carInsurance = this.carInsurance || 0;
		const fuel = this.fuel || 0;
		const cellPhoneAllowance = this.cellPhoneAllowance || 0;
		const carMaintenance = this.carMaintenance || 0;
		const cgicCosts = this.cgicCosts || 0;

		return baseSalary + carInstalment + carInsurance + fuel + cellPhoneAllowance + carMaintenance + cgicCosts;
	}
}
