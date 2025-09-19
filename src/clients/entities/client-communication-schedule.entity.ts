import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, Index, JoinColumn } from 'typeorm';
import { Client } from './client.entity';
import { User } from '../../user/entities/user.entity';
import { CommunicationFrequency, CommunicationType } from '../../lib/enums/client.enums';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';

@Entity('client_communication_schedules')
@Index(['client', 'isActive', 'isDeleted']) // Composite index for efficient queries
@Index(['assignedTo', 'isActive']) // Index for user-specific queries
@Index(['nextScheduledDate', 'isActive']) // Index for scheduling queries
export class ClientCommunicationSchedule {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'enum', enum: CommunicationType })
    communicationType: CommunicationType;

    @Column({ type: 'enum', enum: CommunicationFrequency })
    frequency: CommunicationFrequency;

    @Column({ type: 'int', nullable: true })
    customFrequencyDays: number; // For custom frequency - how many days between communications

    @Column({ type: 'time', nullable: true })
    preferredTime: string; // Preferred time of day (e.g., "09:00", "14:30")

    @Column({ type: 'json', nullable: true })
    preferredDays: number[]; // Array of day numbers (0=Sunday, 1=Monday, etc.)

    @Column({ type: 'timestamp', nullable: true })
    nextScheduledDate: Date;

    @Column({ type: 'timestamp', nullable: true })
    lastCompletedDate: Date;

    @Column({ type: 'timestamp', nullable: true })
    firstVisitDate: Date; // Track when the first visit was made

    @Column({ type: 'timestamp', nullable: true })
    lastVisitDate: Date; // Track the most recent completed visit

    @Column({ type: 'int', default: 0 })
    visitCount: number; // Track total number of completed visits

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'text', nullable: true })
    notes: string;

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any>; // For storing additional schedule-specific data

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ type: 'boolean', default: false })
    isDeleted: boolean;

    // Relations with proper JoinColumn decorators and nullable flags
    @ManyToOne(() => Client, (client) => client.communicationSchedules, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'clientUid' })
    client: Client;

    @Column({ nullable: false })
    clientUid: number;

    @ManyToOne(() => User, (user) => user.clientCommunicationSchedules, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'assignedToUid' })
    assignedTo: User; // The user responsible for this communication

    @Column({ nullable: true })
    assignedToUid: number;

    @ManyToOne(() => Organisation, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'organisationUid' })
    organisation: Organisation;

    @Column({ nullable: true })
    organisationUid: number;

    @ManyToOne(() => Branch, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branchUid' })
    branch: Branch;

    @Column({ nullable: true })
    branchUid: number;
} 