import { Organisation } from 'src/organisation/entities/organisation.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { NewsCategory } from '../../lib/enums/news.enums';
import { GeneralStatus } from '../../lib/enums/status.enums';
import { User } from '../../user/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';

@Entity('news')
export class News {
	@PrimaryGeneratedColumn()
	uid: number;

	@Column({ nullable: false })
	title: string;

	@Column({ nullable: false })
	subtitle: string;

	@Column({ nullable: false, type: 'text' })
	content: string;

	@Column({ nullable: false })
	attachments: string;

	@Column({ nullable: false })
	coverImage: string;

	@Column({ nullable: false })
	thumbnail: string;

	@Column({ nullable: false })
	publishingDate: Date;

	@Column({ nullable: false, default: GeneralStatus.ACTIVE })
	status: GeneralStatus;

	@ManyToOne(() => User, (user) => user?.articles)
	@JoinColumn({ name: 'authorClerkUserId', referencedColumnName: 'clerkUserId' })
	author: User;

	@Column({ nullable: true })
	authorClerkUserId: string;

	@Column({
		nullable: false,
		default: () => 'CURRENT_TIMESTAMP',
	})
	createdAt: Date;

	@Column({
		nullable: false,
		default: () => 'CURRENT_TIMESTAMP',
		onUpdate: 'CURRENT_TIMESTAMP',
	})
	updatedAt: Date;

	@Column({ type: 'boolean', nullable: true, default: false })
	isDeleted: boolean;

	@Column({ nullable: true, type: 'enum', enum: NewsCategory })
	category: NewsCategory;

	@Column({ nullable: true })
	shareLink: string;

	// Relations
	@ManyToOne(() => Branch, (branch) => branch?.news)
	@JoinColumn({ name: 'branchUid' })
	branch: Branch;

	@Column({ nullable: true })
	branchUid: number;

	@ManyToOne(() => Organisation, (organisation) => organisation?.news)
	@JoinColumn({ name: 'organisationUid' })
	organisation: Organisation;

	@Column({ nullable: true })
	organisationUid: number;
}
