import {
	Controller,
	Post,
	Body,
	HttpCode,
	HttpStatus,
	Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignInInput, SignUpInput, VerifyEmailInput, SetPasswordInput, ForgotPasswordInput, ResetPasswordInput } from './dto/auth.dto';
import { 
	ApiOperation, 
	ApiTags, 
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiUnauthorizedResponse,
	ApiInternalServerErrorResponse,
	ApiServiceUnavailableResponse,
	ApiConsumes,
	ApiProduces,
} from '@nestjs/swagger';
import { isPublic } from '../decorators/public.decorator';

@ApiTags('🔐 Authentication')
@Controller('auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({
	description: '💥 Internal Server Error - Authentication system failure',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication service temporarily unavailable' },
			error: { type: 'string', example: 'Internal Server Error' },
			statusCode: { type: 'number', example: 500 },
			timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
			path: { type: 'string', example: '/auth/sign-in' }
		}
	}
})
@ApiServiceUnavailableResponse({
	description: '🔧 Service Unavailable - Authentication service maintenance',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication service is temporarily unavailable for maintenance' },
			error: { type: 'string', example: 'Service Unavailable' },
			statusCode: { type: 'number', example: 503 },
			retryAfter: { type: 'number', example: 300 }
		}
	}
})
export class AuthController {
	constructor(private readonly authService: AuthService) { }

	@Post('sign-up')
	@isPublic()
	@ApiOperation({ 
		summary: '📝 Create new user account',
		description: `
# User Registration System

Initiates the comprehensive user registration process with multi-step verification and security features.

## 🔐 **Registration Process**
- **Account Creation**: Initial user account setup with basic information
- **Email Verification**: Multi-step email verification process for security
- **Password Setup**: Secure password creation with complexity requirements
- **Profile Completion**: Additional user profile information and preferences
- **Organization Assignment**: Link user to appropriate organization and branch

## 🛡️ **Security Features**
- **Email Verification**: Mandatory email verification before account activation
- **Password Complexity**: Enforced strong password requirements
- **Account Lockout**: Protection against brute force attacks
- **Rate Limiting**: Prevents spam and automated registration attempts
- **Domain Validation**: Ensures email addresses meet organizational requirements

## 📋 **Registration Flow**
1. **Initial Registration**: User submits basic information (email, name, organization)
2. **Email Verification**: System sends verification email with secure token
3. **Account Activation**: User clicks verification link to activate account
4. **Password Setup**: User creates secure password meeting complexity requirements
5. **Profile Completion**: Optional profile setup with additional information
6. **Organization Setup**: Assignment to appropriate organization and branch

## 🎯 **Use Cases**
- **New Employee Onboarding**: Register new staff members during onboarding
- **Customer Account Creation**: Allow customers to self-register for services
- **Partner Registration**: Register business partners and external users
- **Service Provider Setup**: Register external service providers and contractors
- **Bulk Registration**: Administrative bulk user creation for large organizations

## 🔒 **Compliance & Security**
- **Data Protection**: GDPR and POPIA compliant data handling
- **Audit Trail**: Complete registration activity logging
- **Identity Verification**: Multi-factor identity verification process
- **Terms Agreement**: User agreement to terms of service and privacy policy
		`
	})
	@ApiBody({ 
		type: SignUpInput,
		description: 'User registration payload with required account creation information',
		examples: {
			employee: {
				summary: '👤 Employee Registration',
				description: 'Register new company employee',
				value: {
					email: 'john.doe@company.co.za',
					firstName: 'John',
					lastName: 'Doe',
					organizationCode: 'COMP001',
					department: 'Engineering',
					jobTitle: 'Software Developer',
					phone: '+27-11-123-4567',
					acceptTerms: true
				}
			},
			customer: {
				summary: '🛒 Customer Registration',
				description: 'Register new customer account',
				value: {
					email: 'customer@email.com',
					firstName: 'Jane',
					lastName: 'Smith',
					organizationCode: 'CUSTOMER',
					accountType: 'PERSONAL',
					phone: '+27-82-987-6543',
					acceptTerms: true,
					marketingConsent: false
				}
			},
			partner: {
				summary: '🤝 Business Partner Registration',
				description: 'Register business partner account',
				value: {
					email: 'partner@businesspartner.com',
					firstName: 'Michael',
					lastName: 'Johnson',
					organizationCode: 'PARTNER',
					companyName: 'Business Partner Solutions',
					partnerType: 'VENDOR',
					phone: '+27-21-555-0123',
					acceptTerms: true
				}
			}
		}
	})
	@ApiCreatedResponse({ 
		description: '✅ Sign-up initiated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Verification email sent successfully' },
				data: {
					type: 'object',
					properties: {
						email: { type: 'string', example: 'john.doe@company.co.za' },
						firstName: { type: 'string', example: 'John' },
						lastName: { type: 'string', example: 'Doe' },
						organizationCode: { type: 'string', example: 'COMP001' },
						registrationId: { type: 'string', example: 'REG-2023-001' },
						verificationRequired: { type: 'boolean', example: true },
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Check your email for verification link',
								'Click the verification link within 24 hours',
								'Complete password setup',
								'Finalize profile information'
							]
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Invalid email format' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'First name is required',
						'Organization code must be provided',
						'Terms acceptance is required'
					]
				}
			}
		}
	})
	@ApiConflictResponse({ 
		description: '⚠️ Conflict - Email already in use',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Email address is already registered' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictType: { type: 'string', example: 'EMAIL_EXISTS' },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Use the sign-in form if you already have an account',
						'Try the forgot password option if you cannot remember your password',
						'Contact support if you believe this is an error'
					]
				}
			}
		}
	})
	signUp(@Body() signUpInput: SignUpInput) {
		return this.authService.signUp(signUpInput);
	}

	@Post('verify-email')
	@isPublic()
	@ApiOperation({ 
		summary: '✅ Verify email address',
		description: `
# Email Verification System

Verifies user email addresses using secure tokens sent via email, completing the account activation process.

## 🔐 **Verification Process**
- **Token Validation**: Secure token verification with expiration handling
- **Email Confirmation**: Confirms user owns the provided email address
- **Account Activation**: Activates user account upon successful verification
- **Security Logging**: Comprehensive audit trail of verification attempts
- **Device Tracking**: Records verification device and location information

## 🛡️ **Security Features**
- **Time-Limited Tokens**: Tokens expire after 24 hours for security
- **Single-Use Tokens**: Each token can only be used once
- **IP Verification**: Optional IP address verification for enhanced security
- **Rate Limiting**: Prevents verification spam and abuse
- **Fraud Detection**: Monitors for suspicious verification patterns

## 📋 **Verification Flow**
1. **Email Delivery**: User receives verification email with secure link
2. **Token Extraction**: System extracts and validates verification token
3. **Security Checks**: Performs IP, device, and timing validations
4. **Account Activation**: Activates user account upon successful verification
5. **Confirmation**: User receives confirmation of successful verification

## 🎯 **Use Cases**
- **Account Activation**: Complete new user registration process
- **Email Change**: Verify new email addresses when users update profiles
- **Security Verification**: Re-verify email for sensitive operations
- **Compliance**: Meet regulatory requirements for email verification
- **Trust Building**: Establish user identity and contact authenticity

## 🔒 **Compliance & Audit**
- **GDPR Compliance**: Meets data protection requirements
- **Audit Trail**: Complete logging of verification activities
- **Security Standards**: Industry-standard token generation and validation
- **Privacy Protection**: Secure handling of user verification data
		`
	})
	@ApiBody({ 
		type: VerifyEmailInput,
		description: 'Email verification payload with security token',
		examples: {
			standardVerification: {
				summary: '📧 Standard Email Verification',
				description: 'Verify email using token from verification email',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImpvaG4uZG9lQGNvbXBhbnkuY28uemEiLCJpYXQiOjE2MzI0NzQ1MzIsImV4cCI6MTYzMjU2MDkzMn0.xyz123',
					email: 'john.doe@company.co.za'
				}
			},
			mobileVerification: {
				summary: '📱 Mobile App Verification',
				description: 'Verify email from mobile application',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6Im1vYmlsZUBjb21wYW55LmNvLnphIiwiaWF0IjoxNjMyNDc0NTMyLCJleHAiOjE2MzI1NjA5MzJ9.abc456',
					email: 'mobile@company.co.za',
					deviceInfo: {
						platform: 'iOS',
						version: '15.0',
						deviceId: 'mobile-device-123'
					}
				}
			}
		}
	})
	@ApiOkResponse({ 
		description: '✅ Email verified successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Email verified successfully' },
				data: {
					type: 'object',
					properties: {
						email: { type: 'string', example: 'john.doe@company.co.za' },
						userId: { type: 'number', example: 12345 },
						verifiedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						accountStatus: { type: 'string', example: 'ACTIVE' },
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Set up your password',
								'Complete your profile',
								'Explore the dashboard'
							]
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid token',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid or expired verification token' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				errorType: { type: 'string', example: 'INVALID_TOKEN' },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Request a new verification email',
						'Check if the token has expired',
						'Ensure you copied the complete token'
					]
				}
			}
		}
	})
	@HttpCode(HttpStatus.OK)
	verifyEmail(@Body() verifyEmailInput: VerifyEmailInput, @Req() req: Request) {
		// Extract request data for email verification confirmation
		const ipAddress = this.extractIpAddress(req);
		const userAgent = req.headers['user-agent'] || 'Unknown';
		const deviceInfo = this.extractDeviceInfo(userAgent);

		const requestData = {
			ipAddress,
			userAgent,
			deviceType: deviceInfo.deviceType,
			browser: deviceInfo.browser,
			operatingSystem: deviceInfo.os
		};

		return this.authService.verifyEmail(verifyEmailInput, requestData);
	}

	@Post('set-password')
	@isPublic()
	@ApiOperation({ 
		summary: '🔒 Set user password',
		description: `
# Password Setup System

Enables users to set secure passwords after email verification, completing the account setup process.

## 🔐 **Password Security**
- **Complexity Requirements**: Enforced minimum security standards
- **Strength Validation**: Real-time password strength assessment
- **Common Password Detection**: Prevents use of commonly compromised passwords
- **Historical Prevention**: Prevents reuse of previous passwords
- **Encryption**: Secure password hashing and storage

## 🛡️ **Security Features**
- **Token Validation**: Secure token-based password setting
- **Rate Limiting**: Prevents password setting abuse
- **Audit Logging**: Complete password change activity tracking
- **Device Tracking**: Records password setup device information
- **Account Linking**: Links password to verified email account

## 📋 **Password Requirements**
- **Minimum Length**: At least 8 characters required
- **Character Diversity**: Mix of uppercase, lowercase, numbers, and symbols
- **Strength Scoring**: Real-time password strength feedback
- **Blacklist Checking**: Prevents common and compromised passwords
- **Pattern Detection**: Identifies and prevents weak password patterns

## 🎯 **Use Cases**
- **Account Completion**: Final step in user registration process
- **Password Reset**: Set new password after forgotten password flow
- **Security Upgrade**: Upgrade weak passwords to stronger ones
- **Compliance**: Meet organizational password policy requirements
- **Account Recovery**: Restore access to compromised accounts

## 🔒 **Compliance & Standards**
- **NIST Guidelines**: Follows NIST password security recommendations
- **Industry Standards**: Meets common security framework requirements
- **Audit Trail**: Complete logging for security and compliance
- **Privacy Protection**: Secure handling of password data
		`
	})
	@ApiBody({ 
		type: SetPasswordInput,
		description: 'Password setup payload with security token and new password',
		examples: {
			newUserPassword: {
				summary: '🆕 New User Password Setup',
				description: 'Set password for newly registered user',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImpvaG4uZG9lQGNvbXBhbnkuY28uemEiLCJpYXQiOjE2MzI0NzQ1MzIsImV4cCI6MTYzMjU2MDkzMn0.xyz123',
					password: 'SecurePassword123!',
					confirmPassword: 'SecurePassword123!'
				}
			},
			strongPassword: {
				summary: '💪 Strong Password Example',
				description: 'Example of strong password meeting all requirements',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InN0cm9uZ0Bjb21wYW55LmNvLnphIiwiaWF0IjoxNjMyNDc0NTMyLCJleHAiOjE2MzI1NjA5MzJ9.abc456',
					password: 'MyStr0ng!P@ssw0rd2023',
					confirmPassword: 'MyStr0ng!P@ssw0rd2023',
					passwordHint: 'My strong password for 2023'
				}
			}
		}
	})
	@ApiOkResponse({ 
		description: '✅ Password set successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Password set successfully' },
				data: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 12345 },
						email: { type: 'string', example: 'john.doe@company.co.za' },
						accountStatus: { type: 'string', example: 'ACTIVE' },
						passwordSetAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						passwordStrength: { type: 'string', example: 'STRONG' },
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Sign in to your account',
								'Complete your profile',
								'Explore the dashboard'
							]
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid token or password',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid token or password requirements not met' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Password must be at least 8 characters long',
						'Password must contain at least one uppercase letter',
						'Password must contain at least one number',
						'Password must contain at least one special character'
					]
				}
			}
		}
	})
	@HttpCode(HttpStatus.OK)
	setPassword(@Body() setPasswordInput: SetPasswordInput) {
		return this.authService.setPassword(setPasswordInput);
	}

	@Post('forgot-password')
	@isPublic()
	@ApiOperation({ 
		summary: '🔑 Request password reset',
		description: `
# Password Recovery System

Initiates secure password reset process for users who have forgotten their passwords.

## 🔐 **Recovery Process**
- **Email Validation**: Verifies email address exists in system
- **Token Generation**: Creates secure, time-limited reset token
- **Email Delivery**: Sends password reset link via email
- **Security Logging**: Logs all recovery attempts for audit
- **Rate Limiting**: Prevents password reset spam and abuse

## 🛡️ **Security Features**
- **Token Expiration**: Reset tokens expire after 1 hour
- **Single Use**: Each reset token can only be used once
- **IP Tracking**: Records IP addresses for security monitoring
- **Account Lockout**: Temporary lockout after multiple failed attempts
- **Fraud Detection**: Monitors for suspicious reset patterns

## 📋 **Recovery Flow**
1. **Email Submission**: User provides email address for reset
2. **Account Lookup**: System verifies email exists and is active
3. **Token Generation**: Creates secure reset token with expiration
4. **Email Delivery**: Sends reset link to user's email address
5. **Link Validation**: User clicks link to access reset form
6. **Password Reset**: User sets new password using secure form

## 🎯 **Use Cases**
- **Forgotten Password**: Users who cannot remember their password
- **Compromised Account**: Reset password for potentially compromised accounts
- **Security Incident**: Proactive password resets during security events
- **Policy Compliance**: Forced password resets for policy compliance
- **Account Recovery**: Restore access to locked or inactive accounts

## 🔒 **Compliance & Security**
- **GDPR Compliance**: Secure handling of user data during recovery
- **Audit Trail**: Complete logging of password recovery activities
- **Security Standards**: Industry-standard token generation and validation
- **Privacy Protection**: Secure communication of reset instructions
		`
	})
	@ApiBody({ 
		type: ForgotPasswordInput,
		description: 'Password reset request payload with email address',
		examples: {
			standardReset: {
				summary: '📧 Standard Password Reset',
				description: 'Request password reset for standard user account',
				value: {
					email: 'john.doe@company.co.za'
				}
			},
			adminReset: {
				summary: '👨‍💼 Admin Account Reset',
				description: 'Request password reset for admin user account',
				value: {
					email: 'admin@company.co.za',
					requestContext: 'Admin password reset requested'
				}
			},
			securityReset: {
				summary: '🚨 Security Incident Reset',
				description: 'Emergency password reset due to security incident',
				value: {
					email: 'security@company.co.za',
					urgency: 'HIGH',
					reason: 'Potential account compromise detected'
				}
			}
		}
	})
	@ApiOkResponse({ 
		description: '✅ Password reset email sent',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Password reset email sent successfully' },
				data: {
					type: 'object',
					properties: {
						email: { type: 'string', example: 'john.doe@company.co.za' },
						resetRequestId: { type: 'string', example: 'RESET-2023-001' },
						tokenExpiry: { type: 'string', format: 'date-time', example: '2023-12-01T11:00:00Z' },
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Check your email for reset instructions',
								'Click the reset link within 1 hour',
								'Create a new secure password',
								'Sign in with your new password'
							]
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid email',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Email address not found or invalid' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				errorType: { type: 'string', example: 'EMAIL_NOT_FOUND' },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Check the email address spelling',
						'Verify you have an account with this email',
						'Contact support if you need assistance'
					]
				}
			}
		}
	})
	@HttpCode(HttpStatus.OK)
	forgotPassword(@Body() forgotPasswordInput: ForgotPasswordInput) {
		return this.authService.forgotPassword(forgotPasswordInput);
	}

	@Post('reset-password')
	@isPublic()
	@ApiOperation({ 
		summary: '🔄 Reset user password',
		description: `
# Password Reset System

Completes the password reset process using secure tokens, allowing users to set new passwords.

## 🔐 **Reset Process**
- **Token Validation**: Verifies reset token is valid and not expired
- **Password Setting**: Allows user to set new secure password
- **Account Restoration**: Restores full access to user account
- **Security Logging**: Comprehensive audit trail of reset activities
- **Notification**: Confirms successful password reset via email

## 🛡️ **Security Features**
- **Token Expiration**: Reset tokens expire after 1 hour
- **Single Use**: Each reset token can only be used once
- **Password Validation**: Enforces strong password requirements
- **Account Unlock**: Automatically unlocks account after successful reset
- **Fraud Prevention**: Monitors for suspicious reset patterns

## 📋 **Reset Flow**
1. **Token Verification**: Validates reset token from email link
2. **Password Entry**: User enters new password meeting requirements
3. **Confirmation**: User confirms new password by entering twice
4. **Security Checks**: Validates password strength and requirements
5. **Account Update**: Updates account with new password hash
6. **Confirmation**: Sends email confirming successful password reset

## 🎯 **Use Cases**
- **Password Recovery**: Complete forgotten password recovery process
- **Security Incident**: Reset compromised account passwords
- **Policy Compliance**: Enforce password policy updates
- **Account Restoration**: Restore access to locked accounts
- **Preventive Security**: Proactive password updates for security

## 🔒 **Compliance & Security**
- **NIST Guidelines**: Follows password security best practices
- **Audit Trail**: Complete logging of password reset activities
- **Security Standards**: Industry-standard encryption and validation
- **Privacy Protection**: Secure handling of sensitive reset data
		`
	})
	@ApiBody({ 
		type: ResetPasswordInput,
		description: 'Password reset completion payload with token and new password',
		examples: {
			standardReset: {
				summary: '🔄 Standard Password Reset',
				description: 'Complete password reset with new secure password',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImpvaG4uZG9lQGNvbXBhbnkuY28uemEiLCJpYXQiOjE2MzI0NzQ1MzIsImV4cCI6MTYzMjU2MDkzMn0.xyz123',
					password: 'NewSecurePassword123!',
					confirmPassword: 'NewSecurePassword123!'
				}
			},
			strongPasswordReset: {
				summary: '💪 Strong Password Reset',
				description: 'Reset with high-strength password',
				value: {
					token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InN0cm9uZ0Bjb21wYW55LmNvLnphIiwiaWF0IjoxNjMyNDc0NTMyLCJleHAiOjE2MzI1NjA5MzJ9.abc456',
					password: 'MyN3w!Str0ng#P@ssw0rd2024',
					confirmPassword: 'MyN3w!Str0ng#P@ssw0rd2024',
					passwordHint: 'My new strong password for 2024'
				}
			}
		}
	})
	@ApiOkResponse({ 
		description: '✅ Password reset successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Password reset successfully' },
				data: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 12345 },
						email: { type: 'string', example: 'john.doe@company.co.za' },
						resetCompletedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						accountStatus: { type: 'string', example: 'ACTIVE' },
						passwordStrength: { type: 'string', example: 'STRONG' },
						nextSteps: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Sign in with your new password',
								'Update saved passwords in your browser',
								'Consider enabling two-factor authentication'
							]
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid token or password',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid token or password requirements not met' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Reset token has expired',
						'Password must be at least 8 characters long',
						'Password must contain at least one uppercase letter',
						'Password confirmation does not match'
					]
				}
			}
		}
	})
	@HttpCode(HttpStatus.OK)
	resetPassword(@Body() resetPasswordInput: ResetPasswordInput) {
		return this.authService.resetPassword(resetPasswordInput);
	}

	@Post('sign-in')
	@isPublic()
	@ApiOperation({ 
		summary: '🔑 User authentication',
		description: `
# Secure Authentication System

Authenticates users with comprehensive security features and device tracking capabilities.

## 🔐 **Authentication Methods**
- **Email & Password**: Traditional email and password authentication
- **Multi-Factor Authentication**: Optional MFA for enhanced security
- **Single Sign-On (SSO)**: Integration with enterprise SSO providers
- **Device Recognition**: Remember trusted devices for seamless access
- **Biometric Support**: Support for biometric authentication on compatible devices

## 🛡️ **Security Features**
- **Brute Force Protection**: Account lockout after multiple failed attempts
- **Device Fingerprinting**: Track and identify user devices for security
- **Geographic Validation**: Location-based access controls and alerts
- **Session Management**: Secure session creation and management
- **Audit Logging**: Comprehensive authentication event logging

## 📱 **Device & Location Tracking**
- **IP Address Tracking**: Monitor access from different IP addresses
- **Device Information**: Capture browser, OS, and device type details
- **Location Detection**: Geographic location detection and validation
- **New Device Alerts**: Notify users of access from new devices
- **Suspicious Activity**: Detect and alert on unusual access patterns

## 🎯 **Use Cases**
- **Employee Access**: Staff authentication for internal systems
- **Customer Login**: Customer portal and service access
- **Partner Authentication**: Business partner and vendor access
- **Mobile App Access**: Native mobile application authentication
- **API Authentication**: Service-to-service authentication
- **Third-Party Integration**: External system integration authentication

## 📊 **Authentication Analytics**
- **Login Patterns**: Track user login frequency and timing
- **Device Analytics**: Monitor device usage and preferences
- **Security Metrics**: Failed attempts, blocked access, and security events
- **Geographic Distribution**: User access patterns by location
- **Performance Metrics**: Authentication response times and system performance

## 🔒 **Compliance & Privacy**
- **Data Protection**: GDPR and POPIA compliant user data handling
- **Privacy Controls**: User control over data collection and retention
- **Security Standards**: Industry-standard encryption and security protocols
- **Audit Requirements**: Comprehensive audit trails for compliance
		`
	})
	@ApiBody({ 
		type: SignInInput,
		description: 'User authentication credentials and optional security parameters',
		examples: {
			basicLogin: {
				summary: '🔑 Basic Email Login',
				description: 'Standard email and password authentication',
				value: {
					email: 'john.doe@company.co.za',
					password: 'SecurePassword123!',
					rememberMe: true
				}
			},
			mfaLogin: {
				summary: '🛡️ Multi-Factor Authentication',
				description: 'Login with MFA token',
				value: {
					email: 'admin@company.co.za',
					password: 'AdminPassword456!',
					mfaToken: '123456',
					trustDevice: false
				}
			},
			mobileLogin: {
				summary: '📱 Mobile App Login',
				description: 'Mobile application authentication',
				value: {
					email: 'mobile.user@company.co.za',
					password: 'MobilePass789!',
					deviceId: 'mobile-device-abc123',
					platform: 'iOS',
					appVersion: '2.1.0'
				}
			}
		}
	})
	@ApiOkResponse({ 
		description: '✅ Authentication successful',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Authentication successful' },
				data: {
					type: 'object',
					properties: {
						accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
						refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
						tokenType: { type: 'string', example: 'Bearer' },
						expiresIn: { type: 'number', example: 3600 },
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								email: { type: 'string', example: 'john.doe@company.co.za' },
								firstName: { type: 'string', example: 'John' },
								lastName: { type: 'string', example: 'Doe' },
								role: { type: 'string', example: 'USER' },
								organization: { type: 'string', example: 'COMP001' },
								branch: { type: 'string', example: 'MAIN' },
								lastLoginAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								permissions: {
									type: 'array',
									items: { type: 'string' },
									example: ['read:dashboard', 'write:reports', 'admin:users']
								}
							}
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiUnauthorizedResponse({ 
		description: '🔒 Unauthorized - Invalid credentials',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid email or password' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				attemptInfo: {
					type: 'object',
					properties: {
						attemptsRemaining: { type: 'number', example: 2 },
						lockoutDuration: { type: 'number', example: 300 },
						lastAttempt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
					}
				}
			}
		}
	})
	signIn(@Body() signInInput: SignInInput, @Req() req: Request) {
		// Extract request data
		const ipAddress = this.extractIpAddress(req);
		const userAgent = req.headers['user-agent'] || 'Unknown';
		const deviceInfo = this.extractDeviceInfo(userAgent);
		const location = this.extractLocationInfo(req);

		const requestData = {
			ipAddress,
			userAgent,
			deviceType: deviceInfo.deviceType,
			browser: deviceInfo.browser,
			operatingSystem: deviceInfo.os,
			location: location.city || 'Unknown',
			country: location.country || 'Unknown'
		};

		return this.authService.signIn(signInInput, requestData);
	}

	@Post('refresh')
	@isPublic()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ 
		summary: '🔄 Refresh authentication token',
		description: `
# Token Refresh System

Generates new access tokens using valid refresh tokens to maintain secure, continuous authentication.

## 🔐 **Token Management**
- **Refresh Token Validation**: Verifies refresh token is valid and not expired
- **Access Token Generation**: Creates new access token with updated expiration
- **Security Rotation**: Optional refresh token rotation for enhanced security
- **Session Continuity**: Maintains user session without re-authentication
- **Audit Logging**: Tracks all token refresh activities

## 🛡️ **Security Features**
- **Token Expiration**: Refresh tokens have extended but limited lifetime
- **Automatic Rotation**: Optional rotation of refresh tokens on use
- **Device Binding**: Tokens can be bound to specific devices
- **Scope Validation**: Ensures token permissions remain valid
- **Rate Limiting**: Prevents token refresh abuse

## 📋 **Refresh Process**
1. **Token Submission**: Client submits refresh token for validation
2. **Validation**: System verifies token authenticity and expiration
3. **User Verification**: Confirms user account is still active
4. **Token Generation**: Creates new access token with current permissions
5. **Response**: Returns new access token and optional new refresh token

## 🎯 **Use Cases**
- **Session Extension**: Extend user sessions without re-authentication
- **Mobile Apps**: Maintain authentication in mobile applications
- **Single Page Apps**: Keep web applications authenticated
- **API Access**: Continuous API access for automated systems
- **Background Services**: Maintain authentication for background processes

## 🔒 **Security Best Practices**
- **Secure Storage**: Refresh tokens stored securely on client side
- **HTTPS Only**: All token operations over secure connections
- **Token Binding**: Bind tokens to specific devices or IP addresses
- **Audit Trail**: Complete logging of token refresh activities
		`
	})
	@ApiBody({ 
		description: 'Refresh token payload',
		schema: {
			type: 'object',
			properties: {
				refreshToken: { 
					type: 'string', 
					description: 'Valid refresh token obtained from previous authentication',
					example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
				}
			},
			required: ['refreshToken']
		},
		examples: {
			standardRefresh: {
				summary: '🔄 Standard Token Refresh',
				description: 'Refresh access token using valid refresh token',
				value: {
					refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
				}
			},
			mobileRefresh: {
				summary: '📱 Mobile App Token Refresh',
				description: 'Refresh token for mobile application',
				value: {
					refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJtb2JpbGUiLCJkZXZpY2VJZCI6ImFiYzEyMyIsImlhdCI6MTUxNjIzOTAyMn0.xyz789'
				}
			}
		}
	})
	@ApiOkResponse({ 
		description: '✅ Token refreshed successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Token refreshed successfully' },
				data: {
					type: 'object',
					properties: {
						accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
						refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
						tokenType: { type: 'string', example: 'Bearer' },
						expiresIn: { type: 'number', example: 3600 },
						refreshedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								email: { type: 'string', example: 'john.doe@company.co.za' },
								role: { type: 'string', example: 'USER' },
								permissions: {
									type: 'array',
									items: { type: 'string' },
									example: ['read:dashboard', 'write:reports']
								}
							}
						}
					}
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiUnauthorizedResponse({ 
		description: '🔒 Unauthorized - Invalid refresh token',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid or expired refresh token' },
				error: { type: 'string', example: 'Unauthorized' },
				statusCode: { type: 'number', example: 401 },
				tokenInfo: {
					type: 'object',
					properties: {
						expired: { type: 'boolean', example: true },
						expiresAt: { type: 'string', format: 'date-time', example: '2023-11-30T10:00:00Z' },
						requiresReauth: { type: 'boolean', example: true }
					}
				}
			}
		}
	})
	async refreshToken(@Body('refreshToken') refreshToken: string) {
		return this.authService.refreshToken(refreshToken);
	}

	/**
	 * Extract IP address from request
	 */
	private extractIpAddress(req: Request): string {
		return (
			req.headers['x-forwarded-for'] ||
			req.headers['x-real-ip'] ||
			req.connection?.remoteAddress ||
			req.socket?.remoteAddress ||
			(req.connection as any)?.socket?.remoteAddress ||
			req.ip ||
			'Unknown'
		) as string;
	}

	/**
	 * Extract device information from user agent
	 */
	private extractDeviceInfo(userAgent: string): {
		deviceType: string;
		browser: string;
		os: string;
	} {
		const ua = userAgent.toLowerCase();
		
		// Device type detection
		let deviceType = 'Desktop';
		if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
			deviceType = 'Mobile';
		} else if (ua.includes('tablet') || ua.includes('ipad')) {
			deviceType = 'Tablet';
		}

		// Browser detection
		let browser = 'Unknown';
		if (ua.includes('chrome') && !ua.includes('edg')) {
			browser = 'Chrome';
		} else if (ua.includes('firefox')) {
			browser = 'Firefox';
		} else if (ua.includes('safari') && !ua.includes('chrome')) {
			browser = 'Safari';
		} else if (ua.includes('edg')) {
			browser = 'Edge';
		} else if (ua.includes('opera') || ua.includes('opr')) {
			browser = 'Opera';
		}

		// OS detection
		let os = 'Unknown';
		if (ua.includes('windows')) {
			os = 'Windows';
		} else if (ua.includes('mac')) {
			os = 'macOS';
		} else if (ua.includes('linux')) {
			os = 'Linux';
		} else if (ua.includes('android')) {
			os = 'Android';
		} else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) {
			os = 'iOS';
		}

		return { deviceType, browser, os };
	}

	/**
	 * Extract location information from request headers
	 */
	private extractLocationInfo(req: Request): {
		city?: string;
		country?: string;
	} {
		// This is a simplified version. In production, you'd use a GeoIP service
		const cfCountry = req.headers['cf-ipcountry'] as string;
		const cfCity = req.headers['cf-ipcity'] as string;
		
		return {
			country: cfCountry || undefined,
			city: cfCity || undefined
		};
	}
}



