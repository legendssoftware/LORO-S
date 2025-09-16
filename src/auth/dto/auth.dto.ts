import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsEmail, MinLength, Matches, IsOptional } from 'class-validator';

export class SignInInput {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'brandon',
    description: 'The username or email address of the user',
  })
  username: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'brandon@2025',
    description: 'The password of the user',
  })
  password: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: '192.168.1.1',
    description: 'The IP address of the user',
    required: false,
  })
  ipAddress?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: 'Cape Town, South Africa',
    description: 'The location of the user',
    required: false,
  })
  location?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: 'iPhone 12',
    description: 'The device used for login',
    required: false,
  })
  device?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: 'Chrome 91.0',
    description: 'The browser used for login',
    required: false,
  })
  browser?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: 'ExponentPushToken[abc123...]',
    description: 'The expo push token for notifications',
    required: false,
  })
  expoPushToken?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: 'ios_12345_abc',
    description: 'The unique device identifier',
    required: false,
  })
  deviceId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    example: 'ios',
    description: 'The device platform (ios/android)',
    required: false,
  })
  platform?: string;
}

export class SignUpInput {
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    example: 'email/username.co.za',
    description: 'The email of the user',
  })
  email: string;
}

export class VerifyEmailInput {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'abc123',
    description: 'The verification token sent via email',
  })
  token: string;
}

export class SetPasswordInput {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'abc123',
  })
  token: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, number/special character',
  })
  @ApiProperty({
    example: 'StrongPass123!',
    description: 'The new password for the account',
  })
  password: string;
}

export class ForgotPasswordInput {
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    example: 'email/username.co.za',
    description: 'The email of the user',
  })
  email: string;
}

export class ResetPasswordInput {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    example: 'abc123',
    description: 'The password reset token sent via email',
  })
  token: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, number/special character',
  })
  @ApiProperty({
    example: 'StrongPass123!',
    description: 'The new password for the account',
  })
  password: string;
}
