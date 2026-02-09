import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Organisation } from './organisation.entity';

@Entity()
export class OrganisationAppearance {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ unique: true, nullable: false })
    ref: string;    

    @Column({ nullable: true })
    primaryColor: string;

    @Column({ nullable: true })
    secondaryColor: string;

    @Column({ nullable: true })
    accentColor: string;

    @Column({ nullable: true })
    errorColor: string;

    @Column({ nullable: true })
    successColor: string;

    @Column({ nullable: true })
    logoUrl: string;

    @Column({ nullable: true })
    logoAltText: string;

    @Column({ default: false })
    isDeleted: boolean;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
    updatedAt: Date;

	@OneToOne(() => Organisation, organisation => organisation.appearance)
	@JoinColumn({ name: 'organisationUid', referencedColumnName: 'clerkOrgId' })
	organisation: Organisation;

	@Column({ type: 'varchar' })
	organisationUid: string;
} 