import { User } from './user.entity'; // Adjusted path assuming it's in the same directory
import { Entity, Column, PrimaryGeneratedColumn, OneToOne, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('user_targets')
@Index(['targetPeriod', 'periodStartDate', 'periodEndDate']) // Period-based filtering
@Index(['periodStartDate', 'periodEndDate']) // Date range queries
@Index(['updatedAt']) // Recent updates tracking
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

	// Monthly target history tracking
	@Column({
		type: 'json',
		nullable: true,
		comment: 'JSON array tracking monthly target performance history'
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
}
