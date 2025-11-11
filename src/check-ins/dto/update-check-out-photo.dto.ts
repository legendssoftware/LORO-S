import { IsNotEmpty, IsString, IsNumber } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateCheckOutPhotoDto {
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
		description: 'The updated check-out photo URL',
		example: 'https://storage.googleapis.com/bucket/check-out.jpg'
	})
	photoUrl: string;
}

