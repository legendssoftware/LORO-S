import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('pending_signup')
export class PendingSignup {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ unique: true, nullable: false })
    email: string;

    @Column()
    verificationToken: string;

    @Column()
    tokenExpires: Date;

    @Column({ default: false })
    isVerified: boolean;

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
} 