import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Organisation } from 'src/organisation/entities/organisation.entity';
import { JournalStatus, JournalType, InspectionRating, InspectionFormData } from 'src/lib/enums/journal.enums';

@Entity('journal')
export class Journal {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ nullable: true })
    clientRef?: string;

    @Column({ nullable: true })
    fileURL?: string;

    @Column({ type: 'text', nullable: true })
    comments?: string;

    @Column({ 
        type: 'enum', 
        enum: JournalType, 
        default: JournalType.GENERAL 
    })
    type: JournalType;

    @Column({ type: 'varchar', nullable: true })
    title?: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ 
        type: 'enum', 
        enum: JournalStatus, 
        default: JournalStatus.PENDING_REVIEW 
    })
    status: JournalStatus;

    // Inspection-specific fields
    @Column({ type: 'json', nullable: true })
    inspectionData?: InspectionFormData;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    totalScore?: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    maxScore?: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    percentage?: number;

    @Column({ 
        type: 'enum', 
        enum: InspectionRating, 
        nullable: true 
    })
    overallRating?: InspectionRating;

    @Column({ type: 'text', nullable: true })
    inspectorComments?: string;

    @Column({ type: 'varchar', nullable: true })
    storeManagerSignature?: string;

    @Column({ type: 'varchar', nullable: true })
    qcInspectorSignature?: string;

    @Column({ type: 'timestamptz', nullable: true })
    inspectionDate?: Date;

    @Column({ type: 'varchar', nullable: true })
    inspectionLocation?: string;

    @Column({ type: 'json', nullable: true })
    attachments?: string[]; // Array of file URLs

    @Column({ type: 'json', nullable: true })
    metadata?: Record<string, any>; // Additional flexible data

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    timestamp: Date;

    @Column({
        type: 'timestamptz',
        nullable: false,
        default: () => 'CURRENT_TIMESTAMP'
    })
    createdAt: Date;

    @Column({
        type: 'timestamptz',
        nullable: false,
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP'
    })
    updatedAt: Date;

    @Column({ nullable: false, default: false })
    isDeleted: boolean;

    @ManyToOne(() => User, user => user.journals)
    @JoinColumn({ name: 'ownerClerkUserId', referencedColumnName: 'clerkUserId' })
    owner: User;

    @Column({ nullable: true })
    ownerClerkUserId: string;

    @ManyToOne(() => Branch, (branch) => branch?.journals)
    @JoinColumn({ name: 'branchUid' })
    branch: Branch;

    @Column({ nullable: true })
    branchUid: number;

    @ManyToOne(() => Organisation, (organisation) => organisation?.journals)
    @JoinColumn({ name: 'organisationUid' })
    organisation: Organisation;

    @Column({ nullable: true })
    organisationUid: number; 
}
