import { ApiProperty } from "@nestjs/swagger";
import { Gender } from "../../lib/enums/gender.enums";
import { IsString, IsOptional, IsEnum, IsDate, IsNumber, IsObject } from "class-validator";

export class CreateUserProfileDto {
    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'User reference code',
        example: { uid: 1 },
        required: false,
    })
    owner?: { uid: number };

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Height of the user',
        example: '180cm',
        required: false
    })
    height?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Weight of the user',
        example: '75kg',
        required: false
    })
    weight?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Hair color of the user',
        example: 'Brown',
        required: false
    })
    hairColor?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Eye color of the user',
        example: 'Blue',
        required: false
    })
    eyeColor?: string;

    @IsOptional()
    @IsEnum(Gender)
    @ApiProperty({
        description: 'Gender of the user',
        enum: Gender,
        example: Gender.MALE,
        required: false
    })
    gender?: Gender;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Ethnicity of the user',
        example: 'African',
        required: false
    })
    ethnicity?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Body type of the user',
        example: 'Athletic',
        required: false
    })
    bodyType?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Smoking habits of the user',
        example: 'Non-smoker',
        required: false
    })
    smokingHabits?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Drinking habits of the user',
        example: 'Occasional',
        required: false
    })
    drinkingHabits?: string;

    @IsOptional()
    @IsDate()
    @ApiProperty({
        description: 'Date of birth of the user',
        example: '1990-01-01',
        required: false
    })
    dateOfBirth?: Date;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Address of the user',
        example: '123 Main Street',
        required: false
    })
    address?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'City of the user',
        example: 'Cape Town',
        required: false
    })
    city?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Country of the user',
        example: 'South Africa',
        required: false
    })
    country?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'ZIP/Postal code of the user',
        example: '7700',
        required: false
    })
    zipCode?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'About me description',
        example: 'I am a passionate developer who loves creating innovative solutions.',
        required: false
    })
    aboutMe?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Social media links or handles',
        example: 'twitter.com/username',
        required: false
    })
    socialMedia?: string;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Current age of the user',
        example: 30,
        required: false
    })
    currentAge?: number;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Marital status of the user',
        example: 'Single',
        required: false
    })
    maritalStatus?: string;

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: 'Number of dependents',
        example: 2,
        required: false
    })
    numberDependents?: number;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Shoe size',
        example: '10',
        required: false
    })
    shoeSize?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Shirt size',
        example: 'L',
        required: false
    })
    shirtSize?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Pants size',
        example: '32',
        required: false
    })
    pantsSize?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Dress size',
        example: 'M',
        required: false
    })
    dressSize?: string;

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Coat size',
        example: 'L',
        required: false
    })
    coatSize?: string;
} 