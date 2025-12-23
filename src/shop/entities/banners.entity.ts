import { Branch } from "src/branch/entities/branch.entity";
import { BannerCategory } from "src/lib/enums/category.enum";
import { Organisation } from "src/organisation/entities/organisation.entity";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";

@Entity('banners')
export class Banners {
    @PrimaryGeneratedColumn()
    uid: number;

    @Column({ nullable: false, type: 'varchar' })
    title: string;

    @Column({ nullable: false, type: 'varchar' })
    subtitle: string;

    @Column({ nullable: false, type: 'varchar' })
    description: string;

    @Column({ nullable: false, type: 'varchar' })
    image: string;

    @Column({
        nullable: false,
        default: () => 'CURRENT_TIMESTAMP'
    })
    createdAt: Date;

    @Column({
        nullable: false,
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP'
    })
    updatedAt: Date;

    @Column({ nullable: false, type: 'enum', enum: BannerCategory, default: BannerCategory.NEWS })
    category: BannerCategory;

    // Relations
    @ManyToOne(() => Organisation, (organisation) => organisation?.banners, { nullable: true })
    @JoinColumn({ name: 'organisationUid' })
    organisation: Organisation;

    @Column({ nullable: true })
    organisationUid: number;

    @ManyToOne(() => Branch, (branch) => branch?.banners, { nullable: true })
    @JoinColumn({ name: 'branchUid' })
    branch: Branch;

    @Column({ nullable: true })
    branchUid: number;
} 