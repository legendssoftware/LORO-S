import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ClientAuth } from '../../clients/entities/client.auth.entity';

@Entity('client_password_reset')
export class ClientPasswordReset {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ nullable: false })
    email: string;

    @Column()
    resetToken: string;

    @Column()
    tokenExpires: Date;

    @Column({ default: false })
    isUsed: boolean;

    @Column({ type: 'timestamptz', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
    
    @ManyToOne(() => ClientAuth, { nullable: true })
    @JoinColumn({ name: 'clientAuthId' })
    clientAuth: ClientAuth;
} 