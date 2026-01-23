import { Gender } from "../../lib/enums/gender.enums";
import { User } from "./user.entity";
import { Column, Entity, OneToOne, PrimaryGeneratedColumn, JoinColumn } from "typeorm";

@Entity('user_profile')
export class UserProfile {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ nullable: true })
    height: string;

    @Column({ nullable: true })
    weight: string;

    @Column({ nullable: true })
    hairColor: string;

    @Column({ nullable: true })
    eyeColor: string;

    @Column({ nullable: true })
    gender: Gender;

    @Column({ nullable: true })
    ethnicity: string;

    @Column({ nullable: true })
    bodyType: string;

    @Column({ nullable: true })
    smokingHabits: string;

    @Column({ nullable: true })
    drinkingHabits: string;

    @Column({ nullable: true })
    dateOfBirth: Date;

    @Column({ nullable: true })
    address: string;

    @Column({ nullable: true })
    city: string;

    @Column({ nullable: true })
    country: string;

    @Column({ nullable: true })
    zipCode: string;

    @Column({ nullable: true })
    aboutMe: string;

    @Column({ nullable: true })
    socialMedia: string;

    @Column({ nullable: true })
    currentAge: number;

    @Column({ nullable: true })
    maritalStatus: string;

    @Column({ nullable: true })
    numberDependents: number;

    @Column({ nullable: true })
    shoeSize: string;

    @Column({ nullable: true })
    shirtSize: string;

    @Column({ nullable: true })
    pantsSize: string;

    @Column({ nullable: true })
    dressSize: string;

    @Column({ nullable: true })
    coatSize: string;

    @OneToOne(() => User, (user) => user?.userProfile)
    @JoinColumn({ name: 'ownerClerkUserId', referencedColumnName: 'clerkUserId' })
    owner: User;

    @Column({ nullable: true })
    ownerClerkUserId: string;
}   