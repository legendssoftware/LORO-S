import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientAuthService } from './client-auth.service';
import { 
    ClientSignInInput, 
    ClientForgotPasswordInput, 
    ClientResetPasswordInput 
} from './dto/client-auth.dto';
import { 
    ApiOperation, 
    ApiTags, 
    ApiBody,
    ApiOkResponse,
    ApiBadRequestResponse,
    ApiUnauthorizedResponse,
    ApiInternalServerErrorResponse,
    ApiServiceUnavailableResponse,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiConsumes,
    ApiProduces
} from '@nestjs/swagger';
import { isPublic } from '../decorators/public.decorator';

@ApiTags('🏢 Client Authentication')
@Controller('client-auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - Client authentication system failure',
    schema: {
        type: 'object',
        properties: {
            message: { type: 'string', example: 'Client authentication service temporarily unavailable' },
            error: { type: 'string', example: 'Internal Server Error' },
            statusCode: { type: 'number', example: 500 },
            timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
            path: { type: 'string', example: '/client-auth/sign-in' }
        }
    }
})
@ApiServiceUnavailableResponse({
    description: '🔧 Service Unavailable - Client authentication service maintenance',
    schema: {
        type: 'object',
        properties: {
            message: { type: 'string', example: 'Client authentication service is temporarily unavailable for maintenance' },
            error: { type: 'string', example: 'Service Unavailable' },
            statusCode: { type: 'number', example: 503 },
            retryAfter: { type: 'number', example: 300 }
        }
    }
})
export class ClientAuthController {
    constructor(private readonly clientAuthService: ClientAuthService) {}

    @Post('sign-in')
    @isPublic()
    @ApiOperation({ 
        summary: '🔑 Client authentication system',
        description: `
# Client Authentication System

Provides secure authentication services specifically designed for client applications with comprehensive security features and license management integration.

## 🔐 **Authentication Features**
- **Multi-Level Security**: Advanced authentication with multiple security layers
- **License Integration**: Seamless integration with client licensing system
- **Device Tracking**: Comprehensive device and location tracking
- **Session Management**: Secure session creation and management
- **Rate Limiting**: Protection against brute force attacks

## 🛡️ **Security Features**
- **IP Address Monitoring**: Track and validate client IP addresses
- **Device Fingerprinting**: Identify and monitor client devices
- **Geographic Validation**: Location-based access controls
- **Brute Force Protection**: Account lockout after failed attempts
- **Audit Logging**: Complete authentication event logging

## 📊 **License Management**
- **License Validation**: Verify client license status during authentication
- **Feature Access**: Control feature access based on license type
- **Usage Tracking**: Monitor client usage patterns and limits
- **Subscription Status**: Real-time subscription and payment status
- **Compliance Monitoring**: Ensure license compliance and usage limits

## 🎯 **Use Cases**
- **Client Portal Access**: Secure access to client management portals
- **Licensed Software**: Authentication for licensed software applications
- **SaaS Applications**: Multi-tenant SaaS platform authentication
- **Enterprise Clients**: Large enterprise client authentication
- **Partner Access**: Business partner and vendor authentication

## 🔒 **Compliance & Security**
- **Data Protection**: GDPR and POPIA compliant client data handling
- **Industry Standards**: Meets enterprise security requirements
- **Audit Trail**: Complete authentication and access logging
- **Privacy Controls**: Client data privacy and control mechanisms
        `
    })
    @ApiBody({ 
        type: ClientSignInInput,
        description: 'Client authentication credentials with optional security parameters',
        examples: {
            basicClientLogin: {
                summary: '🏢 Basic Client Login',
                description: 'Standard client authentication with email and password',
                value: {
                    email: 'client@company.com',
                    password: 'SecureClientPass123!',
                    rememberMe: true
                }
            },
            enterpriseClientLogin: {
                summary: '🏛️ Enterprise Client Login',
                description: 'Enterprise client authentication with additional security',
                value: {
                    email: 'enterprise@corporation.com',
                    password: 'EnterprisePass456!',
                    licenseKey: 'ENT-2023-ABC123',
                    domainValidation: true
                }
            },
            mobileClientLogin: {
                summary: '📱 Mobile Client Login',
                description: 'Mobile client application authentication',
                value: {
                    email: 'mobile@client.com',
                    password: 'MobilePass789!',
                    deviceId: 'mobile-client-def456',
                    platform: 'iOS',
                    appVersion: '3.2.1'
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Client authentication successful',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Client authentication successful' },
                data: {
                    type: 'object',
                    properties: {
                        accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                        refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                        tokenType: { type: 'string', example: 'Bearer' },
                        expiresIn: { type: 'number', example: 3600 },
                        profileData: {
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 54321 },
                                email: { type: 'string', example: 'client@company.com' },
                                clientId: { type: 'string', example: 'CLIENT-2023-001' },
                                companyName: { type: 'string', example: 'Acme Corporation' },
                                accountType: { type: 'string', example: 'ENTERPRISE' },
                                status: { type: 'string', example: 'ACTIVE' },
                                lastLoginAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                                licenseInfo: {
                                    type: 'object',
                                    properties: {
                                        licenseId: { type: 'string', example: 'LIC-ENT-2023-001' },
                                        plan: { type: 'string', example: 'ENTERPRISE' },
                                        status: { type: 'string', example: 'ACTIVE' },
                                        expiresAt: { type: 'string', format: 'date-time', example: '2024-12-01T10:00:00Z' },
                                        features: {
                                            type: 'object',
                                            properties: {
                                                maxUsers: { type: 'number', example: 100 },
                                                apiAccess: { type: 'boolean', example: true },
                                                advancedReports: { type: 'boolean', example: true },
                                                customIntegrations: { type: 'boolean', example: true },
                                                prioritySupport: { type: 'boolean', example: true }
                                            }
                                        }
                                    }
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
        description: '🔒 Unauthorized - Invalid client credentials',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid client credentials or license expired' },
                error: { type: 'string', example: 'Unauthorized' },
                statusCode: { type: 'number', example: 401 },
                errorDetails: {
                    type: 'object',
                    properties: {
                        authenticationFailed: { type: 'boolean', example: true },
                        licenseStatus: { type: 'string', example: 'EXPIRED' },
                        attemptsRemaining: { type: 'number', example: 2 },
                        lockoutDuration: { type: 'number', example: 300 },
                        lastAttempt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
                    }
                },
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Verify your client credentials are correct',
                        'Check if your license is active and not expired',
                        'Contact support if license issues persist',
                        'Use the forgot password option if needed'
                    ]
                }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Bad Request - Invalid client authentication data',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid client authentication data provided' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Email must be a valid email address',
                        'Password is required',
                        'License key format is invalid',
                        'Client domain validation failed'
                    ]
                }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    signIn(@Body() signInInput: ClientSignInInput, @Req() req: Request) {
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

        return this.clientAuthService.clientSignIn(signInInput, requestData);
    }

    @Post('forgot-password')
    @isPublic()
    @ApiOperation({ 
        summary: '🔑 Client password recovery system',
        description: `
# Client Password Recovery System

Provides secure password reset functionality specifically designed for client accounts with enhanced security measures and license validation.

## 🔐 **Recovery Process**
- **Client Validation**: Verify client account exists and is active
- **License Verification**: Ensure client license is valid before password reset
- **Secure Token Generation**: Create time-limited, single-use reset tokens
- **Email Delivery**: Send secure reset link to verified client email
- **Audit Logging**: Complete logging of password recovery attempts

## 🛡️ **Security Features**
- **Multi-Factor Verification**: Additional security layers for client accounts
- **License Status Check**: Validate client license before allowing reset
- **Rate Limiting**: Prevent password reset abuse and spam
- **IP Monitoring**: Track and validate password reset requests
- **Fraud Detection**: Advanced fraud detection for suspicious activity

## 📋 **Recovery Flow**
1. **Client Identification**: Verify client email and account status
2. **License Validation**: Check client license status and validity
3. **Security Checks**: Perform IP and device validation
4. **Token Generation**: Create secure, time-limited reset token
5. **Email Delivery**: Send reset instructions to client email
6. **Audit Trail**: Log all recovery activity for security monitoring

## 🎯 **Use Cases**
- **Client Account Recovery**: Restore access to client accounts
- **License Holder Reset**: Password reset for licensed software users
- **Enterprise Client Recovery**: Large enterprise client password recovery
- **Partner Account Reset**: Business partner password recovery
- **Bulk Client Recovery**: Administrative password recovery for multiple clients

## 🔒 **Compliance & Security**
- **Data Protection**: GDPR and POPIA compliant client data handling
- **License Compliance**: Ensure password reset doesn't violate license terms
- **Audit Requirements**: Complete audit trail for compliance
- **Privacy Protection**: Secure handling of client recovery data
        `
    })
    @ApiBody({ 
        type: ClientForgotPasswordInput,
        description: 'Client password recovery request with email and optional verification',
        examples: {
            basicClientReset: {
                summary: '🏢 Basic Client Password Reset',
                description: 'Standard client password reset request',
                value: {
                    email: 'client@company.com'
                }
            },
            enterpriseClientReset: {
                summary: '🏛️ Enterprise Client Password Reset',
                description: 'Enterprise client password reset with license verification',
                value: {
                    email: 'enterprise@corporation.com',
                    licenseKey: 'ENT-2023-ABC123',
                    verificationCode: 'VERIFY-789'
                }
            },
            securityClientReset: {
                summary: '🚨 Security Client Password Reset',
                description: 'High-security client password reset request',
                value: {
                    email: 'security@client.com',
                    urgency: 'HIGH',
                    reason: 'Suspected account compromise',
                    additionalVerification: true
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Client password reset email sent successfully',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Password reset email sent successfully to client' },
                data: {
                    type: 'object',
                    properties: {
                        email: { type: 'string', example: 'client@company.com' },
                        clientId: { type: 'string', example: 'CLIENT-2023-001' },
                        resetRequestId: { type: 'string', example: 'CLIENT-RESET-2023-001' },
                        tokenExpiry: { type: 'string', format: 'date-time', example: '2023-12-01T11:00:00Z' },
                        licenseStatus: { type: 'string', example: 'ACTIVE' },
                        nextSteps: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Check your email for password reset instructions',
                                'Click the reset link within 1 hour',
                                'Create a new secure password',
                                'Sign in with your new password',
                                'Verify your license status after reset'
                            ]
                        }
                    }
                },
                timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
            }
        }
    })
    @ApiBadRequestResponse({ 
        description: '❌ Bad Request - Invalid client email or account',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Client email not found or account inactive' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                errorDetails: {
                    type: 'object',
                    properties: {
                        emailNotFound: { type: 'boolean', example: true },
                        accountStatus: { type: 'string', example: 'INACTIVE' },
                        licenseStatus: { type: 'string', example: 'EXPIRED' }
                    }
                },
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Verify the client email address is correct',
                        'Check if the client account is active',
                        'Ensure the client license is valid',
                        'Contact support for account activation'
                    ]
                }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    forgotPassword(@Body() forgotPasswordInput: ClientForgotPasswordInput) {
        return this.clientAuthService.clientForgotPassword(forgotPasswordInput);
    }

    @Post('reset-password')
    @isPublic()
    @ApiOperation({ 
        summary: '🔄 Client password reset completion',
        description: `
# Client Password Reset Completion

Completes the client password reset process using secure tokens with comprehensive validation and license verification.

## 🔐 **Reset Process**
- **Token Validation**: Verify reset token authenticity and expiration
- **License Verification**: Ensure client license remains valid
- **Password Security**: Enforce strong password requirements
- **Account Restoration**: Restore full client account access
- **Notification System**: Confirm successful reset via email

## 🛡️ **Security Features**
- **Token Expiration**: Reset tokens expire after 1 hour for security
- **Single Use Tokens**: Each reset token can only be used once
- **Password Complexity**: Enforce enterprise-grade password requirements
- **License Validation**: Verify license status during reset process
- **Audit Logging**: Complete logging of password reset completion

## 📋 **Reset Completion Flow**
1. **Token Verification**: Validate reset token from client email
2. **License Check**: Verify client license is still active
3. **Password Validation**: Ensure new password meets security requirements
4. **Account Update**: Update client account with new password
5. **Access Restoration**: Restore full client account access
6. **Confirmation**: Send email confirming successful password reset

## 🎯 **Use Cases**
- **Client Account Recovery**: Complete client password recovery process
- **License Holder Reset**: Complete password reset for licensed users
- **Enterprise Recovery**: Complete enterprise client password reset
- **Security Incident**: Complete password reset after security incident
- **Compliance Reset**: Complete password reset for compliance requirements

## 🔒 **Compliance & Security**
- **Password Standards**: Enforce enterprise password complexity requirements
- **License Compliance**: Ensure reset doesn't violate license terms
- **Audit Trail**: Complete audit trail for compliance and security
- **Data Protection**: Secure handling of client password reset data
        `
    })
    @ApiBody({ 
        type: ClientResetPasswordInput,
        description: 'Client password reset completion with token and new password',
        examples: {
            basicClientPasswordReset: {
                summary: '🔄 Basic Client Password Reset',
                description: 'Complete client password reset with secure token',
                value: {
                    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6ImNsaWVudC0yMDIzLTAwMSIsImlhdCI6MTYzMjQ3NDUzMiwiZXhwIjoxNjMyNTYwOTMyfQ.xyz123',
                    password: 'NewClientPass123!',
                    confirmPassword: 'NewClientPass123!'
                }
            },
            enterpriseClientPasswordReset: {
                summary: '🏛️ Enterprise Client Password Reset',
                description: 'Complete enterprise client password reset',
                value: {
                    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6ImVudGVycHJpc2UtMjAyMy0wMDEiLCJpYXQiOjE2MzI0NzQ1MzIsImV4cCI6MTYzMjU2MDkzMn0.abc456',
                    password: 'EnterpriseSecure456!',
                    confirmPassword: 'EnterpriseSecure456!',
                    licenseKey: 'ENT-2023-ABC123'
                }
            },
            securityClientPasswordReset: {
                summary: '🚨 Security Client Password Reset',
                description: 'Complete security incident password reset',
                value: {
                    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6InNlY3VyaXR5LTIwMjMtMDAxIiwiaWF0IjoxNjMyNDc0NTMyLCJleHAiOjE2MzI1NjA5MzJ9.def789',
                    password: 'SecurityReset789!',
                    confirmPassword: 'SecurityReset789!',
                    securityVerification: 'HIGH'
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Client password reset completed successfully',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Client password reset completed successfully' },
                data: {
                    type: 'object',
                    properties: {
                        clientId: { type: 'string', example: 'CLIENT-2023-001' },
                        email: { type: 'string', example: 'client@company.com' },
                        resetCompletedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                        accountStatus: { type: 'string', example: 'ACTIVE' },
                        licenseStatus: { type: 'string', example: 'ACTIVE' },
                        passwordStrength: { type: 'string', example: 'STRONG' },
                        nextSteps: {
                            type: 'array',
                            items: { type: 'string' },
                            example: [
                                'Sign in with your new password',
                                'Update saved passwords in your applications',
                                'Verify all licensed features are accessible',
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
        description: '❌ Bad Request - Invalid token or password requirements',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid reset token or password requirements not met' },
                error: { type: 'string', example: 'Bad Request' },
                statusCode: { type: 'number', example: 400 },
                validationErrors: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Reset token has expired or is invalid',
                        'Password must be at least 8 characters long',
                        'Password must contain at least one uppercase letter',
                        'Password must contain at least one number',
                        'Password must contain at least one special character',
                        'Password confirmation does not match'
                    ]
                },
                tokenInfo: {
                    type: 'object',
                    properties: {
                        expired: { type: 'boolean', example: true },
                        expiresAt: { type: 'string', format: 'date-time', example: '2023-12-01T09:00:00Z' },
                        used: { type: 'boolean', example: false }
                    }
                }
            }
        }
    })
    @HttpCode(HttpStatus.OK)
    resetPassword(@Body() resetPasswordInput: ClientResetPasswordInput) {
        return this.clientAuthService.clientResetPassword(resetPasswordInput);
    }

    @Post('refresh')
    @isPublic()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ 
        summary: '🔄 Client token refresh system',
        description: `
# Client Token Refresh System

Provides secure token refresh functionality for client applications with license validation and enhanced security monitoring.

## 🔐 **Token Management**
- **Refresh Token Validation**: Verify client refresh token authenticity
- **License Verification**: Ensure client license remains active
- **Access Token Generation**: Create new access tokens with current permissions
- **Security Rotation**: Optional refresh token rotation for enhanced security
- **Session Continuity**: Maintain client session without re-authentication

## 🛡️ **Security Features**
- **Token Expiration**: Refresh tokens have extended but limited lifetime
- **License Validation**: Verify license status during token refresh
- **Device Binding**: Tokens can be bound to specific client devices
- **Rate Limiting**: Prevent token refresh abuse and attacks
- **Audit Logging**: Complete logging of token refresh activities

## 📋 **Refresh Process**
1. **Token Submission**: Client submits refresh token for validation
2. **License Check**: Verify client license is still active and valid
3. **Token Validation**: Confirm refresh token authenticity and expiration
4. **Permission Update**: Ensure client permissions are current
5. **Token Generation**: Create new access token with updated permissions
6. **Response**: Return new tokens with updated license information

## 🎯 **Use Cases**
- **Client Session Extension**: Extend client application sessions
- **Licensed Software**: Maintain authentication for licensed applications
- **Mobile Client Apps**: Keep mobile client applications authenticated
- **Enterprise Clients**: Continuous authentication for enterprise clients
- **API Access**: Maintain API access for client integrations

## 🔒 **Compliance & Security**
- **License Compliance**: Ensure token refresh doesn't violate license terms
- **Security Standards**: Industry-standard token refresh security
- **Audit Trail**: Complete audit trail for token refresh activities
- **Data Protection**: Secure handling of client token refresh data
        `
    })
    @ApiBody({ 
        description: 'Client refresh token payload with license validation',
        schema: {
            type: 'object',
            properties: {
                refreshToken: { 
                    type: 'string', 
                    description: 'Valid client refresh token obtained from previous authentication',
                    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6ImNsaWVudC0yMDIzLTAwMSIsImlhdCI6MTYzMjQ3NDUzMiwiZXhwIjoxNjMyNTYwOTMyfQ.client123'
                }
            },
            required: ['refreshToken']
        },
        examples: {
            standardClientRefresh: {
                summary: '🔄 Standard Client Token Refresh',
                description: 'Refresh access token for standard client',
                value: {
                    refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6ImNsaWVudC0yMDIzLTAwMSIsImlhdCI6MTYzMjQ3NDUzMiwiZXhwIjoxNjMyNTYwOTMyfQ.client123'
                }
            },
            enterpriseClientRefresh: {
                summary: '🏛️ Enterprise Client Token Refresh',
                description: 'Refresh token for enterprise client with license validation',
                value: {
                    refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6ImVudGVycHJpc2UtMjAyMy0wMDEiLCJsaWNlbnNlSWQiOiJFTlQtMjAyMy1BQkMxMjMiLCJpYXQiOjE2MzI0NzQ1MzIsImV4cCI6MTYzMjU2MDkzMn0.enterprise456'
                }
            },
            mobileClientRefresh: {
                summary: '📱 Mobile Client Token Refresh',
                description: 'Refresh token for mobile client application',
                value: {
                    refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbGllbnRJZCI6Im1vYmlsZS1jbGllbnQtMjAyMy0wMDEiLCJkZXZpY2VJZCI6Im1vYmlsZS1kZXZpY2UtYWJjIiwiaWF0IjoxNjMyNDc0NTMyLCJleHAiOjE2MzI1NjA5MzJ9.mobile789'
                }
            }
        }
    })
    @ApiOkResponse({ 
        description: '✅ Client token refreshed successfully',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Client token refreshed successfully' },
                data: {
                    type: 'object',
                    properties: {
                        accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                        refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                        tokenType: { type: 'string', example: 'Bearer' },
                        expiresIn: { type: 'number', example: 3600 },
                        refreshedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                        profileData: { 
                            type: 'object',
                            properties: {
                                uid: { type: 'number', example: 54321 },
                                email: { type: 'string', example: 'client@company.com' },
                                clientId: { type: 'string', example: 'CLIENT-2023-001' },
                                companyName: { type: 'string', example: 'Acme Corporation' },
                                accountStatus: { type: 'string', example: 'ACTIVE' },
                                licenseInfo: {
                                    type: 'object',
                                    properties: {
                                        licenseId: { type: 'string', example: 'LIC-ENT-2023-001' },
                                        plan: { type: 'string', example: 'ENTERPRISE' },
                                        status: { type: 'string', example: 'ACTIVE' },
                                        expiresAt: { type: 'string', format: 'date-time', example: '2024-12-01T10:00:00Z' },
                                        features: {
                                            type: 'object',
                                            properties: {
                                                maxUsers: { type: 'number', example: 100 },
                                                apiAccess: { type: 'boolean', example: true },
                                                advancedReports: { type: 'boolean', example: true },
                                                customIntegrations: { type: 'boolean', example: true }
                                            }
                                        }
                                    }
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
        description: '🔒 Unauthorized - Invalid or expired client refresh token',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string', example: 'Invalid or expired client refresh token' },
                error: { type: 'string', example: 'Unauthorized' },
                statusCode: { type: 'number', example: 401 },
                tokenInfo: {
                    type: 'object',
                    properties: {
                        expired: { type: 'boolean', example: true },
                        expiresAt: { type: 'string', format: 'date-time', example: '2023-11-30T10:00:00Z' },
                        requiresReauth: { type: 'boolean', example: true },
                        licenseStatus: { type: 'string', example: 'EXPIRED' }
                    }
                },
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [
                        'Sign in again to obtain new tokens',
                        'Check if your client license is still active',
                        'Verify your account status with support',
                        'Ensure your refresh token is not expired'
                    ]
                }
            }
        }
    })
    refresh(@Body() refreshTokenDto: { refreshToken: string }) {
        return this.clientAuthService.clientRefreshToken(refreshTokenDto.refreshToken);
    }

    /**
     * Extract IP address from request headers
     * @param req - HTTP request object
     * @returns IP address string
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
     * Extract device information from user agent string
     * @param userAgent - User agent string from request headers
     * @returns Device information object
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
     * @param req - HTTP request object
     * @returns Location information object
     */
    private extractLocationInfo(req: Request): {
        city?: string;
        country?: string;
    } {
        // Extract location from CloudFlare headers or other geo-location services
        const cfCountry = req.headers['cf-ipcountry'] as string;
        const cfCity = req.headers['cf-ipcity'] as string;
        
        return {
            country: cfCountry || undefined,
            city: cfCity || undefined
        };
    }
} 