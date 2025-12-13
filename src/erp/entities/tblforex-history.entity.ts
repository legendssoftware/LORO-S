import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Forex History Entity
 * Maps to tblforex_history table in bit_consolidated database
 */
@Entity('tblforex_history', { database: 'bit_consolidated' })
export class TblForexHistory {
	@PrimaryGeneratedColumn()
	id: number;

	@Column({ type: 'date', nullable: false })
	forex_date: Date;

	@Column({ type: 'varchar', length: 3, nullable: false })
	forex_code: string;

	@Column({ type: 'decimal', precision: 10, scale: 4, nullable: false })
	rate: number;
}

