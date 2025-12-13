import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    ManyToOne,
    JoinColumn
} from 'typeorm';
import { Approval } from './approval.entity';
import { User } from '../../user/entities/user.entity';
import { SignatureType } from '../../lib/enums/approval.enums';

@Entity('approval_signatures')
export class ApprovalSignature {
    @PrimaryGeneratedColumn()
    uid: number;

    @ManyToOne(() => Approval, (approval) => approval.signatures, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'approvalUid' })
    approval: Approval;

    @Column({ type: 'int', nullable: false })
    approvalUid: number;

    @ManyToOne(() => User, { nullable: false })
    @JoinColumn({ name: 'signerUid' })
    signer: User;

    @Column({ type: 'int', nullable: false })
    signerUid: number;

    @Column({ type: 'enum', enum: SignatureType })
    signatureType: SignatureType;

    @Column({ type: 'varchar', length: 500, nullable: false })
    signatureUrl: string; // URL to signature image/document

    @Column({ type: 'varchar', length: 1000, nullable: true })
    signatureData: string; // Base64 encoded signature data or hash

    @CreateDateColumn()
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: false })
    signedAt: Date;

    // Digital Certificate Information (for advanced digital signatures)
    @Column({ type: 'varchar', length: 255, nullable: true })
    certificateId: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    certificateIssuer: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    certificateSubject: string;

    @Column({ type: 'timestamp', nullable: true })
    certificateValidFrom: Date;

    @Column({ type: 'timestamp', nullable: true })
    certificateValidTo: Date;

    @Column({ type: 'varchar', length: 100, nullable: true })
    certificateFingerprint: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    signatureAlgorithm: string; // SHA256withRSA, etc.

    // Audit & Verification Information
    @Column({ type: 'varchar', length: 45, nullable: false })
    ipAddress: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    userAgent: string;

    @Column({ type: 'json', nullable: true })
    geolocation: { latitude: number; longitude: number; accuracy?: number };

    @Column({ type: 'varchar', length: 50, nullable: true })
    deviceId: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    deviceType: string; // 'desktop', 'mobile', 'tablet'

    @Column({ type: 'varchar', length: 50, nullable: true })
    browserFingerprint: string;

    // Signature Validation
    @Column({ type: 'boolean', default: true })
    isValid: boolean;

    @Column({ type: 'timestamp', nullable: true })
    validatedAt: Date;

    @Column({ type: 'varchar', length: 255, nullable: true })
    validationMethod: string;

    @Column({ type: 'text', nullable: true })
    validationNotes: string;

    @Column({ type: 'boolean', default: false })
    isRevoked: boolean;

    @Column({ type: 'timestamp', nullable: true })
    revokedAt: Date;

    @Column({ type: 'varchar', length: 255, nullable: true })
    revocationReason: string;

    @Column({ type: 'int', nullable: true })
    revokedBy: number;

    // Biometric Information (if applicable)
    @Column({ type: 'json', nullable: true })
    biometricData: {
        fingerprintHash?: string;
        retinaScanHash?: string;
        faceRecognitionHash?: string;
        voicePrintHash?: string;
        timestamp?: Date;
    };

    // Legal & Compliance
    @Column({ type: 'varchar', length: 100, nullable: true })
    legalFramework: string; // 'eIDAS', 'ESIGN', 'UETA', etc.

    @Column({ type: 'varchar', length: 50, nullable: true })
    complianceLevel: string; // 'Basic', 'Advanced', 'Qualified'

    @Column({ type: 'boolean', default: false })
    requiresWitness: boolean;

    @Column({ type: 'int', nullable: true })
    witnessUid: number;

    @Column({ type: 'timestamp', nullable: true })
    witnessedAt: Date;

    // Technical Metadata
    @Column({ type: 'json', nullable: true })
    signatureMetadata: {
        documentHash?: string;
        timestampToken?: string;
        nonRepudiationProof?: string;
        signaturePolicy?: string;
        additionalData?: Record<string, any>;
    };

    @Column({ type: 'varchar', length: 255, nullable: true })
    externalSignatureId: string; // ID from external signature service

    @Column({ type: 'varchar', length: 255, nullable: true })
    signatureProvider: string; // 'DocuSign', 'Adobe Sign', 'Internal', etc.
} 