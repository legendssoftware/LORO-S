import { User } from "./user.entity";
import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn, JoinColumn } from "typeorm";

@Entity('user_employeement_profile')
export class UserEmployeementProfile {
    @PrimaryGeneratedColumn()
    uid: string;

    @Column({ nullable: true })
    startDate: Date;

    @Column({ nullable: true })
    endDate: Date;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;

    @Column({ nullable: true })
    branchref: string;

    @Column({ nullable: true })
    department: string; 

    @Column({ nullable: true })
    position: string;

    @Column({ nullable: true })
    email: string;

    @Column({ nullable: true })
    contactNumber: string;

    @Column({ default: true })
    isCurrentlyEmployed: boolean;

    //relationships
    @OneToOne(() => User, (user) => user?.userEmployeementProfile)
    @JoinColumn({ name: 'ownerUid' })
    owner: User;
}
