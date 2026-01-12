import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

/**
 * DTO for client password change request
 */
export class ClientPasswordChangeDto {
	@IsNotEmpty({ message: 'Current password is required' })
	@IsString()
	@ApiProperty({
		example: 'CurrentPass123!',
		description: 'The current password of the client',
	})
	currentPassword: string;

	@IsNotEmpty({ message: 'New password is required' })
	@IsString()
	@MinLength(8, { message: 'Password must be at least 8 characters long' })
	@Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
		message: 'Password must contain uppercase, lowercase, and number/special character',
	})
	@ApiProperty({
		example: 'NewStrongPass123!',
		description: 'The new password for the client account. Must be at least 8 characters and contain uppercase, lowercase, and number/special character',
	})
	newPassword: string;
}
