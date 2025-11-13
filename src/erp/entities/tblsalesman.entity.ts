import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ERP Salesman Entity
 * Maps to tblsalesman table in ERP database
 * IMPORTANT: synchronize: false - Never sync with ERP database
 */
@Entity('tblsalesman')
export class TblSalesman {
	@PrimaryGeneratedColumn()
	ID: number;

	@Column({ type: 'varchar', length: 45, nullable: true })
	Code: string;

	@Column({ type: 'varchar', length: 100, nullable: true })
	Description: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceThis13: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetThis13: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast06: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast07: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast08: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast09: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast10: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast11: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast12: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	BalanceLast13: number;

	@Column({ type: 'int', default: 0, nullable: true })
	Blocked: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TragetAmount01: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TragetAmount02: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TragetAmount03: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TragetAmount04: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TragetAmount05: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetPer1: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetPer2: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetPer3: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetPer4: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0, nullable: true })
	TargetPer5: number;

	@Column({ type: 'longblob', nullable: true })
	Image: Buffer;

	@Column({ type: 'varchar', length: 145, default: '', nullable: true })
	crm_uid: string;

	@Column({ type: 'varchar', length: 145, default: '', nullable: true })
	crm_name: string;

	@Column({ type: 'varchar', length: 145, default: '', nullable: true })
	crm_surname: string;

	@Column({ type: 'varchar', length: 145, default: '', nullable: true })
	crm_email: string;

	@Column({ type: 'varchar', length: 45, default: '', nullable: true })
	period: string;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	salesAmount: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	hoursWorked: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	newLeads: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	newClients: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	checkIns: number;

	@Column({ type: 'decimal', precision: 19, scale: 2, default: 0.0, nullable: true })
	calls: number;
}

