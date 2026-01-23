import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Client } from './client.entity';
import { User } from '../../user/entities/user.entity';
import { CommunicationFrequency, CommunicationType } from '../../lib/enums/client.enums';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';

@Entity('client_communication_schedules')
export class ClientCommunicationSchedule {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ type: 'enum', enum: CommunicationType })
    communicationType: CommunicationType;

    @Column({ type: 'enum', enum: CommunicationFrequency })
    frequency: CommunicationFrequency;

    @Column({ type: 'int', nullable: true })
    customFrequencyDays: number; // For custom frequency - how many days between communications

    @Column({ type: 'timestamptz', nullable: true })
    preferredTime: Date; // Preferred time of day with timezone

    @Column({ type: 'json', nullable: true })
    preferredDays: number[]; // Array of day numbers (0=Sunday, 1=Monday, etc.)

    @Column({ type: 'timestamptz', nullable: true })
    nextScheduledDate: Date;

    @Column({ type: 'timestamptz', nullable: true })
    lastCompletedDate: Date;

    @Column({ type: 'timestamptz', nullable: true })
    firstVisitDate: Date; // Track when the first visit was made

    @Column({ type: 'timestamptz', nullable: true })
    lastVisitDate: Date; // Track the most recent completed visit

    @Column({ type: 'int', default: 0 })
    visitCount: number; // Track total number of completed visits

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'text', nullable: true })
    notes: string;

    @Column({ type: 'json', nullable: true })
    metadata: Record<string, any>; // For storing additional schedule-specific data

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
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
    @JoinColumn({ name: 'assignedToClerkUserId', referencedColumnName: 'clerkUserId' })
    assignedTo: User; // The user responsible for this communication

    @Column({ nullable: true })
    assignedToClerkUserId: string;

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