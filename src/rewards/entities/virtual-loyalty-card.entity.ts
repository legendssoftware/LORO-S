import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ClientLoyaltyProfile } from './client-loyalty-profile.entity';

@Entity('virtual_loyalty_card')
export class VirtualLoyaltyCard {
	@PrimaryGeneratedColumn()
	uid: number;

	@OneToOne(() => ClientLoyaltyProfile, profile => profile.virtualCard, { nullable: false })
	@JoinColumn({ name: 'loyaltyProfileUid' })
	loyaltyProfile: ClientLoyaltyProfile;

	@Column({ nullable: false })
	loyaltyProfileUid: number;

	@Column({ type: 'varchar', length: 50, unique: true, nullable: false })
	cardNumber: string;

	@Column({ type: 'varchar', nullable: true })
	cardImageUrl: string;

	@Column({ type: 'varchar', nullable: true })
	logoUrl: string;

	@Column({ type: 'varchar', length: 7, nullable: true, default: '#1F2937' })
	primaryColor: string;

	@Column({ type: 'varchar', length: 7, nullable: true, default: '#FFFFFF' })
	secondaryColor: string;

	@Column({ type: 'varchar', length: 7, nullable: true, default: '#F59E0B' })
	accentColor: string;

	@Column({ type: 'varchar', nullable: true })
	backgroundPattern: string;

	@Column({ type: 'varchar', nullable: true })
	cardStyle: string;

	@Column({ type: 'boolean', default: true })
	showPoints: boolean;

	@Column({ type: 'boolean', default: true })
	showTier: boolean;

	@Column({ type: 'boolean', default: true })
	showQRCode: boolean;

	@Column({ type: 'varchar', nullable: true })
	qrCodeUrl: string;

	@Column({ type: 'text', nullable: true })
	qrCodeData: string;

	@Column({ type: 'varchar', nullable: true })
	barcodeUrl: string;

	@Column({ type: 'text', nullable: true })
	barcodeData: string;

	@Column({ type: 'boolean', default: false })
	showBarcode: boolean;

	@Column({ type: 'varchar', nullable: true })
	barcodeFormat: string;

	@Column({ type: 'json', nullable: true })
	customFields: {
		[key: string]: any;
	};

	@Column({ type: 'boolean', default: false })
	isActive: boolean;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
	createdAt: Date;

	@Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
	updatedAt: Date;
}
