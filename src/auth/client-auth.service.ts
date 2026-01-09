import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientAuth } from '../clients/entities/client.auth.entity';
import { ClientPasswordReset } from './entities/client-password-reset.entity';
import { ClientSignInInput, ClientForgotPasswordInput, ClientResetPasswordInput } from './dto/client-auth.dto';
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailType } from '../lib/enums/email.enums';
import { LicensingService } from '../licensing/licensing.service';
import { AccessLevel } from 'src/lib/enums/user.enums';
import { PlatformService } from '../lib/services/platform.service';

@Injectable()
export class ClientAuthService {
	private readonly logger = new Logger(ClientAuthService.name);
	// Request deduplication: key = `${email}:${requestId}`, value = timestamp
	private readonly requestCache = new Map<string, number>();
	private readonly REQUEST_DEDUP_WINDOW_MS = 2000; // 2 seconds

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
		this.logger.debug('Generating secure token for client authentication');
		const token = crypto.randomBytes(32).toString('hex');
		this.logger.debug('Secure token generated successfully');
		return token;
	}

	private getOrganisationRef(organisation: any): string {
		this.logger.debug(`Getting organisation reference from: ${typeof organisation}`);
		const orgRef = String(typeof organisation === 'object' ? organisation.uid : organisation);
		this.logger.debug(`Organisation reference extracted: ${orgRef}`);
		return orgRef;
	}

	async clientSignIn(signInInput: ClientSignInInput, requestData?: any) {
		this.logger.log(`Client sign in attempt for email: ${signInInput.email}`);
		this.logger.debug(`Request data provided: ${JSON.stringify(requestData || {})}`);

		try {
			const { email, password } = signInInput;
			
			// Request deduplication: prevent duplicate sign-in attempts within a short window
			const requestId = `${email}:${requestData?.ipAddress || 'unknown'}:${Date.now()}`;
			const cacheKey = `${email}:${requestData?.ipAddress || 'unknown'}`;
			const now = Date.now();
			const lastRequest = this.requestCache.get(cacheKey);
			
			if (lastRequest && (now - lastRequest) < this.REQUEST_DEDUP_WINDOW_MS) {
				this.logger.warn(`Duplicate sign-in request detected for ${email} from ${requestData?.ipAddress || 'unknown'} (within ${this.REQUEST_DEDUP_WINDOW_MS}ms window)`);
				return {
					message: 'Please wait before trying again',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}
			
			// Update cache
			this.requestCache.set(cacheKey, now);
			
			// Clean up old entries (older than 1 minute)
			if (this.requestCache.size > 1000) {
				for (const [key, timestamp] of this.requestCache.entries()) {
					if (now - timestamp > 60000) {
						this.requestCache.delete(key);
					}
				}
			}

			this.logger.debug(`Finding client auth record for email: ${email}`);
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { email, isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth) {
				this.logger.warn(`Client not found for authentication: ${email}`);
				// Email sending disabled for login-related actions
				return {
					message: 'Invalid credentials provided',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			this.logger.debug(`Validating password for client: ${email}`);
			const isPasswordValid = await bcrypt.compare(password, clientAuth.password);

			if (!isPasswordValid) {
				this.logger.warn(`Invalid password attempt for client: ${email}`);
				// Email sending disabled for login-related actions
				return {
					message: 'Invalid credentials provided',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			// Update last login timestamp
			this.logger.debug(`Updating last login timestamp for client: ${email}`);
			clientAuth.lastLogin = new Date();
			await this.clientAuthRepository.save(clientAuth);
			this.logger.debug(`Last login timestamp updated successfully for client: ${email}`);

			// Email sending disabled for login-related actions

						// Check organization license if client belongs to an organization
			if (clientAuth.client?.organisation) {
				this.logger.debug(`Checking organization license for client: ${email}`);
				const organisationRef = this.getOrganisationRef(clientAuth.client.organisation);

				this.logger.debug(`Finding licenses for organization: ${organisationRef}`);
				const licenses = await this.licensingService.findByOrganisation(organisationRef);
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					this.logger.warn(`No active license found for organization: ${organisationRef}`);
					throw new UnauthorizedException(
						"Your organization's license has expired. Please contact your administrator.",
					);
				}
				this.logger.debug(`Active license found for organization: ${organisationRef}`);

				this.logger.debug(`Generating JWT tokens for client with organization license`);
				const platform = this.platformService.getPrimaryPlatform(activeLicense?.features || {});
				const payload = {
					uid: clientAuth.uid,
					role: AccessLevel.CLIENT,
					organisationRef,
					platform,
					licenseId: String(activeLicense?.uid),
					licensePlan: activeLicense?.plan,
					// Override with quotations-only permissions
					features: {
						'quotations.view': true,
						'quotations.access': true,
					},
					branch: clientAuth.client?.branch?.uid ? { uid: clientAuth.client.branch.uid } : null,
				};

				this.logger.debug(`Signing access and refresh tokens for client: ${email}`);
				const accessToken = await this.jwtService.signAsync(payload, {
					expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
				});

				const refreshToken = await this.jwtService.signAsync(payload, {
					expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
				});

				this.logger.log(`Client sign in successful for: ${email}`);
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
						socialMedia: clientAuth.client.socialMedia,
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
							features: {
								'quotations.view': true,
								'quotations.access': true,
							},
						},
					},
					message: 'Authentication successful',
				};
						}

						// For clients without an organization (should be rare)
			this.logger.debug(`Processing sign in for client without organization: ${email}`);
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

			this.logger.debug(`Generating tokens for client without organization: ${email}`);
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
					socialMedia: clientAuth.client.socialMedia,
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

						this.logger.log(`Client sign in successful (no org): ${email}`);
			return response;
		} catch (error) {
			this.logger.error(`Client sign in failed for: ${signInInput.email}`, error.stack);
			return {
				message: error?.message || 'Authentication failed',
				accessToken: null,
				refreshToken: null,
				profileData: null,
			};
		}
	}

	async clientForgotPassword(forgotPasswordInput: ClientForgotPasswordInput) {
		this.logger.log(`Client forgot password request for email: ${forgotPasswordInput.email}`);
		
		try {
			const { email } = forgotPasswordInput;

			// Find client by email
			this.logger.debug(`Finding client auth record for password reset: ${email}`);
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { email, isDeleted: false },
				relations: ['client'],
			});

			if (!clientAuth) {
				this.logger.warn(`Client password reset requested for non-existent email: ${email}`);
				// Return success even if client not found for security
				return {
					message: 'If an account exists with this email, you will receive password reset instructions.',
				};
			}

			// Check for existing reset token
			this.logger.debug(`Checking for existing reset token for client: ${email}`);
			const existingReset = await this.clientPasswordResetRepository.findOne({
				where: { email },
			});

			if (existingReset && existingReset.tokenExpires > new Date()) {
				this.logger.debug(`Valid reset token already exists for client: ${email}`);
				// If token still valid, don't send new email
				return {
					message: 'Password reset instructions have already been sent. Please check your email.',
				};
			}

			// Generate reset token and URL
			this.logger.debug(`Generating reset token for client: ${email}`);
			const resetToken = await this.generateSecureToken();
			const resetUrl = `${process.env.CLIENT_PORTAL_DOMAIN}/new-password?token=${resetToken}`;

			// Create or update password reset record
			const tokenExpires = new Date();
			tokenExpires.setHours(tokenExpires.getHours() + 24); // Token valid for 24 hours

			if (existingReset) {
				this.logger.debug(`Updating existing reset record for client: ${email}`);
				existingReset.resetToken = resetToken;
				existingReset.tokenExpires = tokenExpires;
				existingReset.isUsed = false;
				await this.clientPasswordResetRepository.save(existingReset);
			} else {
				this.logger.debug(`Creating new reset record for client: ${email}`);
				const passwordReset = this.clientPasswordResetRepository.create({
					email,
					resetToken,
					tokenExpires,
					clientAuth,
				});
				await this.clientPasswordResetRepository.save(passwordReset);
			}

			// Send reset email
			this.logger.debug(`Sending password reset email to client: ${email}`);
			this.eventEmitter.emit('send.email', EmailType.CLIENT_PASSWORD_RESET, [email], {
				name: clientAuth.client.name || email.split('@')[0],
				resetLink: resetUrl,
			});

			this.logger.log(`Client password reset request processed successfully for: ${email}`);
			return {
				message: 'Password reset instructions have been sent to your email.',
			};
		} catch (error) {
			this.logger.error(`Client forgot password failed for email: ${forgotPasswordInput.email}`, error.stack);
			throw new HttpException(
				error.message || 'Failed to process password reset request',
				error.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	async clientResetPassword(resetPasswordInput: ClientResetPasswordInput) {
		this.logger.log(`Client reset password attempt with token: ${resetPasswordInput.token.substring(0, 10)}...`);
		
		try {
			const { token, password } = resetPasswordInput;

			// Find reset record
			this.logger.debug(`Finding reset record by token`);
			const resetRecord = await this.clientPasswordResetRepository.findOne({
				where: { resetToken: token },
				relations: ['clientAuth'],
			});

			if (!resetRecord) {
				this.logger.warn(`Invalid or expired reset token provided`);
				throw new BadRequestException('Invalid or expired reset token.');
			}

			if (resetRecord.tokenExpires < new Date()) {
				this.logger.warn(`Reset token expired for email: ${resetRecord.email}`);
				await this.clientPasswordResetRepository.remove(resetRecord);
				throw new BadRequestException('Reset token has expired. Please request a new one.');
			}

			if (resetRecord.isUsed) {
				this.logger.warn(`Reset token already used for email: ${resetRecord.email}`);
				throw new BadRequestException('This reset token has already been used.');
			}

			// Hash new password
			this.logger.debug(`Hashing new password for client: ${resetRecord.email}`);
			const hashedPassword = await bcrypt.hash(password, 10);

			// Update client password
			this.logger.debug(`Updating password for client: ${resetRecord.email}`);
			resetRecord.clientAuth.password = hashedPassword;
			await this.clientAuthRepository.save(resetRecord.clientAuth);

			// Mark reset token as used
			this.logger.debug(`Marking reset token as used for: ${resetRecord.email}`);
			resetRecord.isUsed = true;
			await this.clientPasswordResetRepository.save(resetRecord);

			// Send confirmation email
			this.logger.debug(`Sending password changed confirmation email to: ${resetRecord.email}`);
			this.eventEmitter.emit('send.email', EmailType.CLIENT_PASSWORD_CHANGED, [resetRecord.email], {
				name: resetRecord.clientAuth.client.name || resetRecord.email.split('@')[0],
				changeTime: new Date().toLocaleString(),
			});

			this.logger.log(`Client password reset successful for: ${resetRecord.email}`);
			return {
				message: 'Password has been reset successfully. You can now log in with your new password.',
			};
		} catch (error) {
			this.logger.error(`Client password reset failed`, error.stack);
			throw new HttpException(
				error.message || 'Failed to reset password',
				error.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	async clientRefreshToken(token: string) {
		this.logger.log(`Client refresh token attempt`);
		
		try {
			this.logger.debug(`Verifying client refresh token`);
			const payload = await this.jwtService.verifyAsync(token);

			if (!payload) {
				this.logger.warn(`Invalid client refresh token payload`);
				return {
					message: 'Invalid refresh token',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			// Find client auth by uid
			this.logger.debug(`Finding client auth by UID: ${payload?.uid}`);
			const clientAuth = await this.clientAuthRepository.findOne({
				where: { uid: Number(payload.uid), isDeleted: false },
				relations: ['client', 'client.organisation', 'client.branch'],
			});

			if (!clientAuth) {
				this.logger.warn(`Client not found for refresh token, UID: ${payload?.uid}`);
				return {
					message: 'Client not found',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			// Check organization license if client belongs to an organization
			if (clientAuth.client?.organisation) {
				this.logger.debug(`Checking organization license for client refresh token, orgRef: ${clientAuth.client.organisation}`);
				const organisationRef = this.getOrganisationRef(clientAuth.client.organisation);

				const licenses = await this.licensingService.findByOrganisation(organisationRef);
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					this.logger.warn(`No active license found for organization during client refresh: ${organisationRef}`);
					return {
						message: "Your organization's license has expired. Please contact your administrator.",
						accessToken: null,
						refreshToken: null,
						profileData: null,
					};
				}

				this.logger.debug(`Active license found for organization during client refresh: ${organisationRef}`);
				const platform = this.platformService.getPrimaryPlatform(activeLicense?.features || {});

				// Generate new JWT tokens with client-specific fields and license information
				// Maintain the restricted quotations-only permissions
				const clientPermissions = {
					'quotations.view': true,
					'quotations.access': true,
				};

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

				this.logger.debug(`Generating new access token for client: ${clientAuth.email}`);
				const accessToken = await this.jwtService.signAsync(newPayload, {
					expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
				});

				// Generate a new refresh token as well for token rotation
				const refreshToken = await this.jwtService.signAsync(newPayload, {
					expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
				});

				this.logger.log(`Client access token refreshed successfully for: ${clientAuth.email}`);
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
						socialMedia: clientAuth.client.socialMedia,
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
			this.logger.debug(`Processing refresh token for client without organization: ${clientAuth.email}`);
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

			this.logger.debug(`Generating new access token for client without organization: ${clientAuth.email}`);
			const accessToken = await this.jwtService.signAsync(newPayload, {
				expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '8h',
			});

			// Generate a new refresh token as well for token rotation
			const refreshToken = await this.jwtService.signAsync(newPayload, {
				expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
			});

			this.logger.log(`Client access token refreshed successfully (no org): ${clientAuth.email}`);
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
					socialMedia: clientAuth.client.socialMedia,
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
			this.logger.error(`Client refresh token failed`, error.stack);
			if (error?.name === 'TokenExpiredError') {
				this.logger.warn(`Client refresh token has expired`);
				throw new UnauthorizedException('Token has expired');
			}

			throw new UnauthorizedException(error?.message || 'Failed to refresh token');
		}
	}
}
