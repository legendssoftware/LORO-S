import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { ClientPasswordReset } from './entities/client-password-reset.entity';
import { ClientSignInInput, ClientForgotPasswordInput, ClientResetPasswordInput } from './dto/client-auth.dto';
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailType } from '../lib/enums/email.enums';
import { LicensingService } from '../licensing/licensing.service';
import { AccessLevel } from 'src/lib/enums/user.enums';
import { PlatformService } from '../lib/services/platform.service';

@Injectable()
export class ClientAuthService {
	constructor(
		private jwtService: JwtService,
		@InjectRepository(ClientAuth)
		private clientAuthRepository: Repository<ClientAuth>,
		@InjectRepository(ClientPasswordReset)
		private clientPasswordResetRepository: Repository<ClientPasswordReset>,
		private eventEmitter: EventEmitter2,
		private licensingService: LicensingService,
		private platformService: PlatformService,
	) {}

	// Reuse the same secure token generation method as in AuthService
	private async generateSecureToken(): Promise<string> {
		return crypto.randomBytes(32).toString('hex');
	}

	private getOrganisationRef(organisation: any): string {
		return String(typeof organisation === 'object' ? organisation.uid : organisation);
	}

	async clientSignIn(signInInput: ClientSignInInput, requestData?: any) {
		try {
			const { email, password } = signInInput;

			const clientAuth = await this.clientAuthRepository.findOne({
				where: { email, isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

					if (!clientAuth) {
			// Send failed login email for unknown client email
			try {
				this.eventEmitter.emit('send.email', EmailType.CLIENT_FAILED_LOGIN_ATTEMPT, [email], {
					name: email.split('@')[0],
					loginTime: new Date().toLocaleString(),
					ipAddress: requestData?.ipAddress || 'Unknown',
					location: requestData?.location || 'Unknown',
					country: requestData?.country || 'Unknown',
					deviceType: requestData?.deviceType || 'Unknown',
					browser: requestData?.browser || 'Unknown',
					operatingSystem: requestData?.operatingSystem || 'Unknown',
					userAgent: requestData?.userAgent || 'Unknown',
					suspicious: true,
					securityTips: [
						'Contact us immediately if you suspect unauthorized access',
						'Ensure you are using the correct client portal URL',
						'Use strong, unique passwords for your client portal',
					],
				});
			} catch (error) {
				console.error('Failed to send client failed login notification email:', error);
			}

			return {
				message: 'Invalid credentials provided',
				accessToken: null,
				refreshToken: null,
				profileData: null,
			};
		}

		const isPasswordValid = await bcrypt.compare(password, clientAuth.password);

		if (!isPasswordValid) {
			// Send failed login email for incorrect password
			try {
				this.eventEmitter.emit('send.email', EmailType.CLIENT_FAILED_LOGIN_ATTEMPT, [clientAuth.email], {
					name: clientAuth.email.split('@')[0],
					loginTime: new Date().toLocaleString(),
					ipAddress: requestData?.ipAddress || 'Unknown',
					location: requestData?.location || 'Unknown',
					country: requestData?.country || 'Unknown',
					deviceType: requestData?.deviceType || 'Unknown',
					browser: requestData?.browser || 'Unknown',
					operatingSystem: requestData?.operatingSystem || 'Unknown',
					userAgent: requestData?.userAgent || 'Unknown',
					suspicious: true,
					securityTips: [
						'Contact us immediately if you suspect unauthorized access',
						'Change your password if you are concerned about security',
						'Use strong, unique passwords for your client portal',
					],
				});
			} catch (error) {
				console.error('Failed to send client failed login notification email:', error);
			}

			return {
				message: 'Invalid credentials provided',
				accessToken: null,
				refreshToken: null,
				profileData: null,
			};
		}

			// Update last login timestamp
			clientAuth.lastLogin = new Date();
			await this.clientAuthRepository.save(clientAuth);

			// Send client login notification email
			try {
				this.eventEmitter.emit('send.email', EmailType.CLIENT_LOGIN_NOTIFICATION, [clientAuth.email], {
					name: clientAuth.client?.name || clientAuth.email.split('@')[0],
					loginTime: new Date().toLocaleString(),
					ipAddress: requestData?.ipAddress || 'Unknown',
					location: requestData?.location || 'Unknown',
					country: requestData?.country || 'Unknown',
					deviceType: requestData?.deviceType || 'Unknown',
					browser: requestData?.browser || 'Unknown',
					operatingSystem: requestData?.operatingSystem || 'Unknown',
					userAgent: requestData?.userAgent || 'Unknown',
					suspicious: false, // You can implement logic to detect suspicious logins
					securityTips: [
						'Always log out from shared devices',
						'Use strong, unique passwords',
						'Contact support if you notice suspicious activity',
					],
				});
			} catch (error) {
				// Don't fail login if email fails
				console.error('Failed to send client login notification email:', error);
			}

			// Check organization license if client belongs to an organization
			if (clientAuth.client?.organisation) {
				const organisationRef = this.getOrganisationRef(clientAuth.client.organisation);

				const licenses = await this.licensingService.findByOrganisation(organisationRef);
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					throw new UnauthorizedException(
						"Your organization's license has expired. Please contact your administrator.",
					);
				}

				// Generate JWT tokens with client-specific fields and license information
				// Restrict client permissions to quotations only
				const clientPermissions = {
					'quotations.view': true,
					'quotations.access': true,
				};

				const platform = this.platformService.getPrimaryPlatform(activeLicense?.features || {});
				const payload = {
					uid: clientAuth.uid,
					role: AccessLevel.CLIENT,
					organisationRef,
					platform,
					licenseId: String(activeLicense?.uid),
					licensePlan: activeLicense?.plan,
					// Override with quotations-only permissions
					features: clientPermissions,
					branch: clientAuth.client?.branch?.uid ? { uid: clientAuth.client.branch.uid } : null,
				};

				const accessToken = await this.jwtService.signAsync(payload, {
					expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
				});

				const refreshToken = await this.jwtService.signAsync(payload, {
					expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
				});

				const response = {
					accessToken,
					refreshToken,
					profileData: {
						uid: clientAuth.client.uid,
						email: clientAuth.email,
						accessLevel: 'client',
						// Client basic information
						name: clientAuth.client.name,
						contactPerson: clientAuth.client.contactPerson,
						phone: clientAuth.client.phone,
						alternativePhone: clientAuth.client.alternativePhone,
						website: clientAuth.client.website,
						logo: clientAuth.client.logo,
						description: clientAuth.client.description,
						address: clientAuth.client.address,
						category: clientAuth.client.category,
						status: clientAuth.client.status,
						
						// CRM related fields
						priceTier: clientAuth.client.priceTier,
						preferredContactMethod: clientAuth.client.preferredContactMethod,
						tags: clientAuth.client.tags,
						industry: clientAuth.client.industry,
						companySize: clientAuth.client.companySize,
						preferredLanguage: clientAuth.client.preferredLanguage,
						acquisitionChannel: clientAuth.client.acquisitionChannel,
						acquisitionDate: clientAuth.client.acquisitionDate,
						creditLimit: clientAuth.client.creditLimit,
						outstandingBalance: clientAuth.client.outstandingBalance,
						lifetimeValue: clientAuth.client.lifetimeValue,
						discountPercentage: clientAuth.client.discountPercentage,
						paymentTerms: clientAuth.client.paymentTerms,
						type: clientAuth.client.type,
						
						// Social profiles and custom fields
						socialProfiles: clientAuth.client.socialProfiles,
						customFields: clientAuth.client.customFields,
						
						// Branch and organization information
						branch: clientAuth.client.branch ? {
							uid: clientAuth.client.branch.uid,
							name: clientAuth.client.branch.name,
							address: clientAuth.client.branch.address,
							phone: clientAuth.client.branch.phone,
							email: clientAuth.client.branch.email,
						} : null,
						
						organisation: clientAuth.client.organisation ? {
							uid: clientAuth.client.organisation.uid,
							name: clientAuth.client.organisation.name,
							address: clientAuth.client.organisation.address,
							phone: clientAuth.client.organisation.phone,
							email: clientAuth.client.organisation.email,
						} : null,
						
						// Authentication specific info
						lastLogin: clientAuth.lastLogin,
						createdAt: clientAuth.client.createdAt,
						updatedAt: clientAuth.client.updatedAt,
						
						// License and permission information
						licenseInfo: {
							licenseId: String(activeLicense?.uid),
							plan: activeLicense?.plan,
							status: activeLicense?.status,
							// Return the restricted permissions
							features: clientPermissions,
						},
					},
					message: 'Authentication successful',
				};

				// Send successful login email notification
				try {
					this.eventEmitter.emit('send.email', EmailType.CLIENT_LOGIN_NOTIFICATION, [clientAuth.email], {
						name: clientAuth.client.name || clientAuth.email.split('@')[0],
						loginTime: new Date().toLocaleString(),
						ipAddress: requestData?.ipAddress || 'Unknown',
						location: requestData?.location || 'Unknown',
						country: requestData?.country || 'Unknown',
						deviceType: requestData?.deviceType || 'Unknown',
						browser: requestData?.browser || 'Unknown',
						operatingSystem: requestData?.operatingSystem || 'Unknown',
						userAgent: requestData?.userAgent || 'Unknown',
						suspicious: false,
						securityTips: [
							'Always log out when using shared devices',
							'Use strong, unique passwords for your client portal',
							'Contact us if you notice any suspicious activity',
						],
					});
				} catch (error) {
					console.error('Failed to send client login notification email:', error);
				}

				return response;
			}

			// For clients without an organization (should be rare)
			// Still restrict to quotations-only access
			const clientPermissions = {
				'quotations.view': true,
				'quotations.access': true,
			};

			const payload = {
				uid: clientAuth.uid,
				role: AccessLevel.CLIENT,
				platform: 'all',
				features: clientPermissions,
				branch: clientAuth.client?.branch?.uid ? { uid: clientAuth.client.branch.uid } : null,
			};

			const accessToken = await this.jwtService.signAsync(payload, {
				expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
			});

			const refreshToken = await this.jwtService.signAsync(payload, {
				expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
			});

			const response = {
				accessToken,
				refreshToken,
				profileData: {
					uid: clientAuth.client.uid,
					email: clientAuth.email,
					accessLevel: 'client',
					// Client basic information
					name: clientAuth.client.name,
					contactPerson: clientAuth.client.contactPerson,
					phone: clientAuth.client.phone,
					alternativePhone: clientAuth.client.alternativePhone,
					website: clientAuth.client.website,
					logo: clientAuth.client.logo,
					description: clientAuth.client.description,
					address: clientAuth.client.address,
					category: clientAuth.client.category,
					status: clientAuth.client.status,
					
					// CRM related fields
					priceTier: clientAuth.client.priceTier,
					preferredContactMethod: clientAuth.client.preferredContactMethod,
					tags: clientAuth.client.tags,
					industry: clientAuth.client.industry,
					companySize: clientAuth.client.companySize,
					preferredLanguage: clientAuth.client.preferredLanguage,
					acquisitionChannel: clientAuth.client.acquisitionChannel,
					acquisitionDate: clientAuth.client.acquisitionDate,
					creditLimit: clientAuth.client.creditLimit,
					outstandingBalance: clientAuth.client.outstandingBalance,
					lifetimeValue: clientAuth.client.lifetimeValue,
					discountPercentage: clientAuth.client.discountPercentage,
					paymentTerms: clientAuth.client.paymentTerms,
					type: clientAuth.client.type,
					
					// Social profiles and custom fields
					socialProfiles: clientAuth.client.socialProfiles,
					customFields: clientAuth.client.customFields,
					
					// Branch and organization information
					branch: clientAuth.client.branch ? {
						uid: clientAuth.client.branch.uid,
						name: clientAuth.client.branch.name,
						address: clientAuth.client.branch.address,
						phone: clientAuth.client.branch.phone,
						email: clientAuth.client.branch.email,
					} : null,
					
					organisation: clientAuth.client.organisation ? {
						uid: clientAuth.client.organisation.uid,
						name: clientAuth.client.organisation.name,
						address: clientAuth.client.organisation.address,
						phone: clientAuth.client.organisation.phone,
						email: clientAuth.client.organisation.email,
					} : null,
					
					// Authentication specific info
					lastLogin: clientAuth.lastLogin,
					createdAt: clientAuth.client.createdAt,
					updatedAt: clientAuth.client.updatedAt,
					
					// Permission information
					features: clientPermissions,
				},
				message: 'Authentication successful',
			};

			// Send successful login email notification
			try {
				this.eventEmitter.emit('send.email', EmailType.CLIENT_LOGIN_NOTIFICATION, [clientAuth.email], {
					name: clientAuth.client.name || clientAuth.email.split('@')[0],
					loginTime: new Date().toLocaleString(),
					ipAddress: requestData?.ipAddress || 'Unknown',
					location: requestData?.location || 'Unknown',
					country: requestData?.country || 'Unknown',
					deviceType: requestData?.deviceType || 'Unknown',
					browser: requestData?.browser || 'Unknown',
					operatingSystem: requestData?.operatingSystem || 'Unknown',
					userAgent: requestData?.userAgent || 'Unknown',
					suspicious: false,
					securityTips: [
						'Always log out when using shared devices',
						'Use strong, unique passwords for your client portal',
						'Contact us if you notice any suspicious activity',
					],
				});
			} catch (error) {
				console.error('Failed to send client login notification email:', error);
			}

			return response;
		} catch (error) {
			return {
				message: error?.message || 'Authentication failed',
				accessToken: null,
				refreshToken: null,
				profileData: null,
			};
		}
	}

	async clientForgotPassword(forgotPasswordInput: ClientForgotPasswordInput) {
		try {
			const { email } = forgotPasswordInput;

			// Find client by email
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { email, isDeleted: false },
				relations: ['client'],
			});

			if (!clientAuth) {
				// Return success even if client not found for security
				return {
					message: 'If an account exists with this email, you will receive password reset instructions.',
				};
			}

			// Check for existing reset token
			const existingReset = await this.clientPasswordResetRepository.findOne({
				where: { email },
			});

			if (existingReset && existingReset.tokenExpires > new Date()) {
				// If token still valid, don't send new email
				return {
					message: 'Password reset instructions have already been sent. Please check your email.',
				};
			}

			// Generate reset token and URL
			const resetToken = await this.generateSecureToken();
			const resetUrl = `${process.env.CLIENT_PORTAL_DOMAIN}/reset-password/${resetToken}`;

			// Create or update password reset record
			const tokenExpires = new Date();
			tokenExpires.setHours(tokenExpires.getHours() + 24); // Token valid for 24 hours

			if (existingReset) {
				existingReset.resetToken = resetToken;
				existingReset.tokenExpires = tokenExpires;
				existingReset.isUsed = false;
				await this.clientPasswordResetRepository.save(existingReset);
			} else {
				const passwordReset = this.clientPasswordResetRepository.create({
					email,
					resetToken,
					tokenExpires,
					clientAuth,
				});
				await this.clientPasswordResetRepository.save(passwordReset);
			}

			// Send reset email
			this.eventEmitter.emit('send.email', EmailType.CLIENT_PASSWORD_RESET, [email], {
				name: clientAuth.client.name || email.split('@')[0],
				resetLink: resetUrl,
			});

			return {
				message: 'Password reset instructions have been sent to your email.',
			};
		} catch (error) {
			throw new HttpException(
				error.message || 'Failed to process password reset request',
				error.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	async clientResetPassword(resetPasswordInput: ClientResetPasswordInput) {
		try {
			const { token, password } = resetPasswordInput;

			// Find reset record
			const resetRecord = await this.clientPasswordResetRepository.findOne({
				where: { resetToken: token },
				relations: ['clientAuth'],
			});

			if (!resetRecord) {
				throw new BadRequestException('Invalid or expired reset token.');
			}

			if (resetRecord.tokenExpires < new Date()) {
				await this.clientPasswordResetRepository.remove(resetRecord);
				throw new BadRequestException('Reset token has expired. Please request a new one.');
			}

			if (resetRecord.isUsed) {
				throw new BadRequestException('This reset token has already been used.');
			}

			// Hash new password
			const hashedPassword = await bcrypt.hash(password, 10);

			// Update client password
			resetRecord.clientAuth.password = hashedPassword;
			await this.clientAuthRepository.save(resetRecord.clientAuth);

			// Mark reset token as used
			resetRecord.isUsed = true;
			await this.clientPasswordResetRepository.save(resetRecord);

			// Send confirmation email
			this.eventEmitter.emit('send.email', EmailType.CLIENT_PASSWORD_CHANGED, [resetRecord.email], {
				name: resetRecord.clientAuth.client.name || resetRecord.email.split('@')[0],
				changeTime: new Date().toLocaleString(),
			});

			return {
				message: 'Password has been reset successfully. You can now log in with your new password.',
			};
		} catch (error) {
			throw new HttpException(
				error.message || 'Failed to reset password',
				error.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	async clientRefreshToken(token: string) {
		try {
			const payload = await this.jwtService.verifyAsync(token);

			if (!payload) {
				return {
					message: 'Invalid refresh token',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			// Find client auth by uid
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { uid: Number(payload.uid), isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth) {
				return {
					message: 'Client not found',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			// Check organization license if client belongs to an organization
			if (clientAuth.client?.organisation) {
				const organisationRef = this.getOrganisationRef(clientAuth.client.organisation);

				const licenses = await this.licensingService.findByOrganisation(organisationRef);
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					return {
						message: "Your organization's license has expired. Please contact your administrator.",
						accessToken: null,
						refreshToken: null,
						profileData: null,
					};
				}

				// Generate new JWT tokens with client-specific fields and license information
				// Maintain the restricted quotations-only permissions
				const clientPermissions = {
					'quotations.view': true,
					'quotations.access': true,
				};

				const platform = this.platformService.getPrimaryPlatform(activeLicense?.features || {});
				const newPayload = {
					uid: clientAuth.uid,
					role: AccessLevel.CLIENT,
					organisationRef,
					platform,
					licenseId: String(activeLicense?.uid),
					licensePlan: activeLicense?.plan,
					features: clientPermissions,
					branch: clientAuth.client?.branch?.uid ? { uid: clientAuth.client.branch.uid } : null,
				};

				const accessToken = await this.jwtService.signAsync(newPayload, {
					expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
				});

				// Generate a new refresh token as well for token rotation
				const refreshToken = await this.jwtService.signAsync(newPayload, {
					expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
				});

				return {
					accessToken,
					refreshToken,
					profileData: {
						uid: clientAuth.client.uid,
						email: clientAuth.email,
						accessLevel: 'client',
						// Client basic information
						name: clientAuth.client.name,
						contactPerson: clientAuth.client.contactPerson,
						phone: clientAuth.client.phone,
						alternativePhone: clientAuth.client.alternativePhone,
						website: clientAuth.client.website,
						logo: clientAuth.client.logo,
						description: clientAuth.client.description,
						address: clientAuth.client.address,
						category: clientAuth.client.category,
						status: clientAuth.client.status,
						
						// CRM related fields
						priceTier: clientAuth.client.priceTier,
						preferredContactMethod: clientAuth.client.preferredContactMethod,
						tags: clientAuth.client.tags,
						industry: clientAuth.client.industry,
						companySize: clientAuth.client.companySize,
						preferredLanguage: clientAuth.client.preferredLanguage,
						acquisitionChannel: clientAuth.client.acquisitionChannel,
						acquisitionDate: clientAuth.client.acquisitionDate,
						creditLimit: clientAuth.client.creditLimit,
						outstandingBalance: clientAuth.client.outstandingBalance,
						lifetimeValue: clientAuth.client.lifetimeValue,
						discountPercentage: clientAuth.client.discountPercentage,
						paymentTerms: clientAuth.client.paymentTerms,
						type: clientAuth.client.type,
						
						// Social profiles and custom fields
						socialProfiles: clientAuth.client.socialProfiles,
						customFields: clientAuth.client.customFields,
						
						// Branch and organization information
						branch: clientAuth.client.branch ? {
							uid: clientAuth.client.branch.uid,
							name: clientAuth.client.branch.name,
							address: clientAuth.client.branch.address,
							phone: clientAuth.client.branch.phone,
							email: clientAuth.client.branch.email,
						} : null,
						
						organisation: clientAuth.client.organisation ? {
							uid: clientAuth.client.organisation.uid,
							name: clientAuth.client.organisation.name,
							address: clientAuth.client.organisation.address,
							phone: clientAuth.client.organisation.phone,
							email: clientAuth.client.organisation.email,
						} : null,
						
						// Authentication specific info
						lastLogin: clientAuth.lastLogin,
						createdAt: clientAuth.client.createdAt,
						updatedAt: clientAuth.client.updatedAt,
						
						// License and permission information
						licenseInfo: {
							licenseId: String(activeLicense?.uid),
							plan: activeLicense?.plan,
							status: activeLicense?.status,
							features: clientPermissions,
						},
					},
					message: 'Tokens refreshed successfully',
				};
			}

			// For clients without an organization (should be rare)
			// Maintain the restricted quotations-only permissions
			const clientPermissions = {
				'quotations.view': true,
				'quotations.access': true,
			};

			const newPayload = {
				uid: clientAuth.uid,
				role: AccessLevel.CLIENT,
				platform: 'all',
				features: clientPermissions,
				branch: clientAuth.client?.branch?.uid ? { uid: clientAuth.client.branch.uid } : null,
			};

			const accessToken = await this.jwtService.signAsync(newPayload, {
				expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
			});

			// Generate a new refresh token as well for token rotation
			const refreshToken = await this.jwtService.signAsync(newPayload, {
				expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
			});

			return {
				accessToken,
				refreshToken,
				profileData: {
					uid: clientAuth.client.uid,
					email: clientAuth.email,
					accessLevel: 'client',
					// Client basic information
					name: clientAuth.client.name,
					contactPerson: clientAuth.client.contactPerson,
					phone: clientAuth.client.phone,
					alternativePhone: clientAuth.client.alternativePhone,
					website: clientAuth.client.website,
					logo: clientAuth.client.logo,
					description: clientAuth.client.description,
					address: clientAuth.client.address,
					category: clientAuth.client.category,
					status: clientAuth.client.status,
					
					// CRM related fields
					priceTier: clientAuth.client.priceTier,
					preferredContactMethod: clientAuth.client.preferredContactMethod,
					tags: clientAuth.client.tags,
					industry: clientAuth.client.industry,
					companySize: clientAuth.client.companySize,
					preferredLanguage: clientAuth.client.preferredLanguage,
					acquisitionChannel: clientAuth.client.acquisitionChannel,
					acquisitionDate: clientAuth.client.acquisitionDate,
					creditLimit: clientAuth.client.creditLimit,
					outstandingBalance: clientAuth.client.outstandingBalance,
					lifetimeValue: clientAuth.client.lifetimeValue,
					discountPercentage: clientAuth.client.discountPercentage,
					paymentTerms: clientAuth.client.paymentTerms,
					type: clientAuth.client.type,
					
					// Social profiles and custom fields
					socialProfiles: clientAuth.client.socialProfiles,
					customFields: clientAuth.client.customFields,
					
					// Branch and organization information
					branch: clientAuth.client.branch ? {
						uid: clientAuth.client.branch.uid,
						name: clientAuth.client.branch.name,
						address: clientAuth.client.branch.address,
						phone: clientAuth.client.branch.phone,
						email: clientAuth.client.branch.email,
					} : null,
					
					organisation: clientAuth.client.organisation ? {
						uid: clientAuth.client.organisation.uid,
						name: clientAuth.client.organisation.name,
						address: clientAuth.client.organisation.address,
						phone: clientAuth.client.organisation.phone,
						email: clientAuth.client.organisation.email,
					} : null,
					
					// Authentication specific info
					lastLogin: clientAuth.lastLogin,
					createdAt: clientAuth.client.createdAt,
					updatedAt: clientAuth.client.updatedAt,
					
					// Permission information
					features: clientPermissions,
				},
				message: 'Tokens refreshed successfully',
			};
		} catch (error) {
			if (error?.name === 'TokenExpiredError') {
				return {
					message: 'Refresh token has expired',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			return {
				message: error?.message || 'Failed to refresh token',
				accessToken: null,
				refreshToken: null,
				profileData: null,
			};
		}
	}
}
