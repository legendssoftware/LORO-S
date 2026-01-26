import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * User reference (owner.uid) – always string. No parseInt/Number().
 */
export class OwnerUidDto {
	@IsString()
	@IsNotEmpty()
	@ApiProperty({
		example: '1',
		description: 'User reference (string)',
	})
	uid: string;
}
