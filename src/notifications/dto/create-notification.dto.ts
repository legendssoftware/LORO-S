import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '../../lib/enums/notification.enums';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

/**
 * Owner (user) is resolved from the auth token (clerkUserId); no owner/uid in DTO.
 */
export class CreateNotificationDto {
	@IsNotEmpty()
	@IsEnum(NotificationType)
	@ApiProperty({
		example: NotificationType.USER,
		description: 'The type of the notification',
	})
	type: NotificationType;

	@IsNotEmpty()
	@IsString()
	@ApiProperty({
		example: 'New Order',
		description: 'The title of the notification',
	})
	title: string;

	@IsNotEmpty()
	@IsString()
	@ApiProperty({
		example: 'A new order has been placed',
		description: 'The message of the notification',
	})
	message: string;
}
