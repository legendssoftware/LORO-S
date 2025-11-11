import { IsNotEmpty, IsString, IsNumber } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateCheckInPhotoDto {
	@IsNotEmpty()
	@IsNumber()
	@ApiProperty({
		description: 'Check-in record ID',
		example: 1
	})
	checkInId: number;

	@IsNotEmpty()
	@IsString()
	@ApiProperty({
		description: 'The updated check-in photo URL',
		example: 'https://storage.googleapis.com/bucket/check-in.jpg'
	})
	photoUrl: string;
}

