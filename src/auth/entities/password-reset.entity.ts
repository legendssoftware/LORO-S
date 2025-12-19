import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('password_reset')
export class PasswordReset {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ unique: true, nullable: false })
    email: string;

    @Column()
    resetToken: string;

    @Column()
    tokenExpires: Date;

    @Column({ default: false })
    isUsed: boolean;

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
} 