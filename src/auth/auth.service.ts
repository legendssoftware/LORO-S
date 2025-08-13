import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
	SignInInput,
	SignUpInput,
	VerifyEmailInput,
	SetPasswordInput,
	ForgotPasswordInput,
	ResetPasswordInput,
} from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UserService } from '../user/user.service';
import { SignInResponse, SignUpResponse } from '../lib/types/auth';
import { ProfileData } from '../lib/types/auth';
import { RewardsService } from '../rewards/rewards.service';
import { XP_VALUES, XP_VALUES_TYPES } from 'src/lib/constants/constants';
import { EmailType } from '../lib/enums/email.enums';
import { AccessLevel } from '../lib/enums/user.enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PendingSignupService } from './pending-signup.service';
import { PasswordResetService } from './password-reset.service';
import { LicensingService } from '../licensing/licensing.service';
import { PlatformService } from '../lib/services/platform.service';

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

	constructor(
		private jwtService: JwtService,
		private userService: UserService,
		private rewardsService: RewardsService,
		private eventEmitter: EventEmitter2,
		private pendingSignupService: PendingSignupService,
		private passwordResetService: PasswordResetService,
		private licensingService: LicensingService,
		private platformService: PlatformService,
	) {
		this.logger.debug('AuthService initialized with all dependencies');
	}

	private excludePassword(user: any): Omit<typeof user, 'password'> {
		this.logger.debug(`Excluding password from user object for user: ${user?.email || user?.username || 'unknown'}`);
		const { password, ...userWithoutPassword } = user;
		this.logger.debug(`Password successfully excluded from user object for: ${user?.email || user?.username || 'unknown'}`);
		return userWithoutPassword;
	}

	private async generateSecureToken(): Promise<string> {
		this.logger.debug('Generating secure token using crypto.randomBytes');
		const token = crypto.randomBytes(32).toString('hex');
		this.logger.debug(`Secure token generated successfully with length: ${token.length}`);
		return token;
	}

	async signIn(signInInput: SignInInput, requestData?: any): Promise<SignInResponse> {
		this.logger.log(`Sign in attempt for user: ${signInInput.username}`);
		try {
			const { username, password } = signInInput;

			this.logger.debug(`Fetching auth profile for user: ${username}`);
			const authProfile = await this.userService.findOneForAuth(username);

			if (!authProfile?.user) {
				this.logger.warn(`User not found for authentication: ${username}`);
				// Send failed login email for unknown user
				try {
					// Try to find user by email for failed login notification
					const userByEmail = await this.userService.findOneByEmail(username);
					if (userByEmail?.user) {
						this.logger.debug(`Sending failed login notification email for user: ${username}`);
						this.eventEmitter.emit('send.email', EmailType.FAILED_LOGIN_ATTEMPT, [userByEmail.user.email], {
							name: userByEmail.user.name || username,
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
								'Change your password immediately if you suspect unauthorized access',
								'Enable two-factor authentication for additional security',
								'Contact support if you notice any unusual activity',
							],
						});
					}
				} catch (error) {
					this.logger.error('Failed to send failed login notification email:', error);
				}
				throw new BadRequestException('Invalid credentials provided');
			}

			const { password: userPassword } = authProfile?.user;

			this.logger.debug(`Validating password for user: ${username}`);
			const isPasswordValid = await bcrypt.compare(password, userPassword);

			if (!isPasswordValid) {
				this.logger.warn(`Invalid password attempt for user: ${username}`);
				// Send failed login email for incorrect password
				try {
					this.logger.debug(`Sending failed login notification email for invalid password: ${username}`);
					this.eventEmitter.emit('send.email', EmailType.FAILED_LOGIN_ATTEMPT, [authProfile.user.email], {
						name: authProfile.user.name || authProfile.user.email,
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
							'Change your password immediately if you suspect unauthorized access',
							'Enable two-factor authentication for additional security',
							'Contact support if you notice any unusual activity',
						],
					});
				} catch (error) {
					this.logger.error('Failed to send failed login notification email:', error);
				}

				return {
					message: 'Invalid credentials provided',
					accessToken: null,
					refreshToken: null,
					profileData: null,
				};
			}

			const userWithoutPassword = this.excludePassword(authProfile.user);
			const { uid, accessLevel, name, organisationRef, organisation, ...restOfUser } = userWithoutPassword;

			// Check organization license if user belongs to an organization
			if (organisationRef) {
				this.logger.debug(`Checking organization license for user: ${username}, orgRef: ${organisationRef}`);
				const licenses = await this.licensingService.findByOrganisation(organisationRef);
				this.logger.debug(`Found ${licenses.length} licenses for organization: ${organisationRef}`);
				
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					this.logger.warn(`No active license found for organization: ${organisationRef}, licenses checked: ${licenses.length}`);
					throw new UnauthorizedException(
						"Your organization's license has expired. Please contact your administrator.",
					);
				}
				this.logger.debug(`Active license found for organization: ${organisationRef}, licenseId: ${activeLicense.uid}`);

				// Add license info to profile data
				const platform = this.platformService.getPrimaryPlatform(activeLicense?.features || {});
				const profileData: ProfileData = {
					uid: uid.toString(),
					accessLevel,
					name,
					organisationRef,
					platform,
					licenseInfo: {
						licenseId: String(activeLicense?.uid),
						plan: activeLicense?.plan,
						status: activeLicense?.status,
						features: activeLicense?.features,
					},
					...restOfUser,
					branch: {
						name: restOfUser?.branch?.name,
						uid: restOfUser?.branch?.uid,
					},
				};

				const tokenRole = accessLevel?.toLowerCase();

				// Include license info in token payload
				const payload = {
					uid: uid?.toString(),
					role: tokenRole,
					organisationRef,
					platform,
					licenseId: String(activeLicense?.uid),
					licensePlan: activeLicense?.plan,
					features: activeLicense?.features,
					branch: restOfUser?.branch?.uid ? { uid: restOfUser?.branch.uid } : undefined,
				};

				this.logger.debug(`Generating access and refresh tokens for user: ${username}`);
				this.logger.debug(`Token payload prepared with platform: ${platform}, role: ${tokenRole}`);
				const accessToken = await this.jwtService.signAsync(payload, { expiresIn: `8h` });
				const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: `7d` });
				this.logger.debug(`JWT tokens generated successfully for user: ${username}`);

				const gainedXP = {
					owner: Number(uid),
					amount: XP_VALUES.DAILY_LOGIN,
					action: 'DAILY_LOGIN',
					source: {
						id: uid.toString(),
						type: XP_VALUES_TYPES.LOGIN,
						details: 'Daily login reward',
					},
				};

				this.logger.debug(`Awarding XP for daily login to user: ${username}, amount: ${XP_VALUES.DAILY_LOGIN}`);
				await this.rewardsService.awardXP(gainedXP, organisationRef, restOfUser?.branch?.uid);
				this.logger.debug(`XP awarded successfully for daily login to user: ${username}`);

				// Send login notification email
				try {
					this.logger.debug(`Sending login notification email to user: ${username}`);
					this.eventEmitter.emit('send.email', EmailType.LOGIN_NOTIFICATION, [authProfile.user.email], {
						name: profileData.name,
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
							'Enable two-factor authentication when available',
						],
					});
				} catch (error) {
					// Don't fail login if email fails
					this.logger.error('Failed to send login notification email:', error);
				}

				this.logger.log(`User sign in successful: ${username}`);
				return {
					profileData,
					accessToken,
					refreshToken,
					message: `Welcome ${profileData.name}!`,
				};
			}

			// For users without organization (like system admins)
			this.logger.debug(`Processing sign in for user without organization: ${username}`);
			const profileData: ProfileData = {
				uid: uid.toString(),
				accessLevel,
				name,
				platform: 'all',
				...restOfUser,
			};

			const tokenRole = accessLevel?.toLowerCase();
			const payload = {
				uid: uid?.toString(),
				role: tokenRole,
				platform: 'all',
				branch: restOfUser?.branch?.uid ? { uid: restOfUser.branch.uid } : undefined,
			};

			this.logger.debug(`Generating tokens for user without organization: ${username}`);
			const accessToken = await this.jwtService.signAsync(payload, { expiresIn: `8h` });
			const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: `7d` });

			this.logger.log(`User sign in successful (no org): ${username}`);
			return {
				profileData,
				accessToken,
				refreshToken,
				message: `Welcome ${profileData.name}!`,
			};
		} catch (error) {
			this.logger.error(`Sign in failed for user: ${signInInput.username}`, error.stack);
			const response = {
				message: error?.message,
				accessToken: null,
				refreshToken: null,
				profileData: null,
			};

			return response;
		}
	}

	async signUp(signUpInput: SignUpInput): Promise<SignUpResponse> {
		this.logger.log(`Sign up attempt for email: ${signUpInput.email}`);
		try {
			const { email } = signUpInput;

			// Check for existing user
			this.logger.debug(`Checking for existing user with email: ${email}`);
			const existingUser = await this.userService.findOneByEmail(email);
			if (existingUser?.user) {
				this.logger.warn(`Sign up failed - email already exists: ${email}`);
				throw new BadRequestException('Email already taken, please try another one.');
			}

			// Check for existing pending signup
			this.logger.debug(`Checking for existing pending signup for email: ${email}`);
			const existingPendingSignup = await this.pendingSignupService.findByEmail(email);
			if (existingPendingSignup) {
				// If token is still valid, don't send new email
				if (!existingPendingSignup.isVerified && existingPendingSignup.tokenExpires > new Date()) {
					this.logger.debug(`Pending signup already exists with valid token for email: ${email}`);
					return {
						message: 'Please check your email for the verification link sent earlier.',
					};
				}
				// Delete expired signup
				this.logger.debug(`Deleting expired pending signup for email: ${email}`);
				await this.pendingSignupService.delete(existingPendingSignup.uid);
			}

			// Generate verification token and URL
			this.logger.debug(`Generating verification token for email: ${email}`);
			const verificationToken = await this.generateSecureToken();
			const verificationUrl = `${process.env.SIGNUP_DOMAIN}/verify/${verificationToken}`;

			// Create pending signup
			this.logger.debug(`Creating pending signup record for email: ${email}`);
			await this.pendingSignupService.create(email, verificationToken);

			// Send verification email
			this.logger.debug(`Sending verification email to: ${email}`);
			this.eventEmitter.emit('send.email', EmailType.VERIFICATION, [email], {
				name: email.split('@')[0],
				verificationLink: verificationUrl,
				expiryHours: 24,
			});

			this.logger.log(`Sign up process initiated successfully for email: ${email}`);
			return {
				status: 'success',
				message: 'Please check your email and verify your account within the next 24 hours.',
			};
		} catch (error) {
			this.logger.error(`Sign up failed for email: ${signUpInput.email}`, error.stack);
			return {
				message: error?.message,
			};
		}
	}

	async verifyEmail(verifyEmailInput: VerifyEmailInput, requestData?: any) {
		this.logger.log(`Email verification attempt with token: ${verifyEmailInput.token.substring(0, 10)}...`);
		try {
			const { token } = verifyEmailInput;
			this.logger.debug(`Finding pending signup by token`);
			const pendingSignup = await this.pendingSignupService.findByToken(token);

			if (!pendingSignup) {
				this.logger.warn(`Invalid verification token provided`);
				throw new BadRequestException('Invalid verification token');
			}

			if (pendingSignup.tokenExpires < new Date()) {
				this.logger.warn(`Verification token expired for email: ${pendingSignup.email}`);
				await this.pendingSignupService.delete(pendingSignup.uid);
				throw new BadRequestException('Verification token has expired. Please sign up again.');
			}

			if (pendingSignup.isVerified) {
				this.logger.warn(`Email already verified for: ${pendingSignup.email}`);
				throw new BadRequestException('Email already verified. Please proceed to set your password.');
			}

			this.logger.debug(`Marking email as verified for: ${pendingSignup.email}`);
			await this.pendingSignupService.markAsVerified(pendingSignup.uid);

			// Send email verification success notification
			try {
				this.logger.debug(`Sending email verification success notification to: ${pendingSignup.email}`);
				this.eventEmitter.emit('send.email', EmailType.EMAIL_VERIFIED, [pendingSignup.email], {
					name: pendingSignup.email.split('@')[0],
					verificationDate: new Date().toISOString(),
					ipAddress: requestData?.ipAddress || 'Unknown',
					location: requestData?.location || 'Unknown',
					deviceType: requestData?.deviceType || 'Unknown',
					browser: requestData?.browser || 'Unknown',
					nextSteps: [
						'Set up your account password',
						'Complete your profile information',
						'Explore the platform features',
					],
					loginUrl: `${process.env.WEBSITE_DOMAIN}/sign-in` || '/sign-in',
				});
			} catch (error) {
				this.logger.error('Failed to send email verification success notification:', error);
			}

			this.logger.log(`Email verification successful for: ${pendingSignup.email}`);
			return {
				message: 'Email verified successfully. You can now set your password.',
				email: pendingSignup.email,
			};
		} catch (error) {
			this.logger.error(`Email verification failed`, error.stack);
			throw new HttpException(
				error.message || 'Email verification failed',
				error.status || HttpStatus.BAD_REQUEST,
			);
		}
	}

	async setPassword(setPasswordInput: SetPasswordInput) {
		this.logger.log(`Set password attempt with token: ${setPasswordInput.token.substring(0, 10)}...`);
		try {
			const { token, password } = setPasswordInput;
			this.logger.debug(`Finding pending signup by token for password setting`);
			const pendingSignup = await this.pendingSignupService.findByToken(token);

			if (!pendingSignup) {
				this.logger.warn(`Invalid token provided for password setting`);
				throw new BadRequestException('Invalid token');
			}

			if (!pendingSignup.isVerified) {
				this.logger.warn(`Email not verified for password setting: ${pendingSignup.email}`);
				throw new BadRequestException('Email not verified. Please verify your email first.');
			}

			if (pendingSignup.tokenExpires < new Date()) {
				this.logger.warn(`Token expired for password setting: ${pendingSignup.email}`);
				await this.pendingSignupService.delete(pendingSignup.uid);
				throw new BadRequestException('Token has expired. Please sign up again.');
			}

			// Create the actual user account
			this.logger.debug(`Creating user account for: ${pendingSignup.email}`);
			const username = pendingSignup.email.split('@')[0].toLowerCase();
			const hashedPassword = await bcrypt.hash(password, 10);

			const createdUser = await this.userService.create({
				email: pendingSignup.email,
				username,
				password: hashedPassword,
				name: username,
				surname: '',
				phone: '',
				photoURL: `https://ui-avatars.com/api/?name=${username}&background=805adc&color=fff`,
				accessLevel: AccessLevel.USER,
				userref: `USR${Date.now()}`,
			});

			// Delete the pending signup
			this.logger.debug(`Deleting pending signup record for: ${pendingSignup.email}`);
			await this.pendingSignupService.delete(pendingSignup.uid);

			// Get the web and mobile app links from environment variables
			const webAppLink = `${process.env.WEBSITE_DOMAIN}/sign-in` || '/sign-in';
			const mobileAppLink = `${process.env.WEBSITE_DOMAIN}/mobile-app` || null;

			// Send welcome email to the new user
			this.logger.debug(`Sending welcome email to new user: ${pendingSignup.email}`);
			this.eventEmitter.emit('send.email', EmailType.SIGNUP, [pendingSignup.email], {
				name: username,
				webAppLink: webAppLink,
				mobileAppLink: mobileAppLink,
			});

			// Notify admin users about the new user registration
			this.logger.debug(`Notifying admin users about new user registration: ${pendingSignup.email}`);
			const { users: adminUsers } = await this.userService.findAdminUsers();

			if (adminUsers && adminUsers.length > 0) {
				const adminEmails = adminUsers.map((user) => user.email);
				const dashboardUrl = process.env.WEBSITE_DOMAIN || 'https://dashboard.loro.co.za';
				const userDetailsLink = `${dashboardUrl}/users/${username}`;

				this.eventEmitter.emit('send.email', EmailType.NEW_USER_ADMIN_NOTIFICATION, adminEmails, {
					name: 'Administrator',
					newUserEmail: pendingSignup.email,
					newUserName: username,
					signupTime: new Date().toLocaleString(),
					userDetailsLink: userDetailsLink,
				});
			}

			this.logger.log(`Account created successfully for: ${pendingSignup.email}`);
			const response = {
				status: 'success',
				message: 'Account created successfully. You can now sign in.',
			};

			return response;
		} catch (error) {
			this.logger.error(`Failed to create account`, error.stack);
			throw new HttpException(
				error.message || 'Failed to create account',
				error.status || HttpStatus.BAD_REQUEST,
			);
		}
	}

	async forgotPassword(forgotPasswordInput: ForgotPasswordInput) {
		this.logger.log(`Forgot password request for email: ${forgotPasswordInput.email}`);
		try {
			const { email } = forgotPasswordInput;

			// Find user by email
			this.logger.debug(`Finding user by email for password reset: ${email}`);
			const existingUser = await this.userService.findOneByEmail(email);

			if (!existingUser?.user) {
				this.logger.warn(`Password reset requested for non-existent email: ${email}`);
				// Return success even if user not found for security
				return {
					message: 'If an account exists with this email, you will receive password reset instructions.',
				};
			}

			// Generate reset token and URL
			this.logger.debug(`Generating reset token for user: ${email}`);
			const resetToken = await this.generateSecureToken();
			const resetUrl = `${process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN}/new-password?token=${resetToken}`;
			this.logger.debug(`Reset URL generated: ${resetUrl.substring(0, resetUrl.lastIndexOf('/') + 1)}[TOKEN]`);

			// Create password reset record (this will handle rate limiting and duplicates)
			this.logger.debug(`Creating password reset record for: ${email}`);
			await this.passwordResetService.create(email, resetToken);
			this.logger.debug(`Password reset record created successfully for: ${email}`);

			// Send single password reset email with security alert and reset link
			this.logger.debug(`Sending password reset email to: ${email}`);
			this.eventEmitter.emit('send.email', EmailType.PASSWORD_RESET_REQUEST, [email], {
				name: existingUser.user.name || email.split('@')[0],
				userEmail: email,
				requestTime: new Date().toLocaleString(),
				resetLink: resetUrl,
				expiryHours: 24,
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				dashboardUrl: `${process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN || 'https://dashboard.loro.co.za'}/dashboard`,
			});

			this.logger.log(`Password reset request processed successfully for: ${email}`);
			return {
				message: 'Password reset instructions have been sent to your email. Please check your inbox.',
			};
		} catch (error) {
			this.logger.error(`Forgot password failed for email: ${forgotPasswordInput.email}`, error.stack);
			// Handle specific BadRequestException from rate limiting
			if (error instanceof BadRequestException) {
				return {
					message: error.message,
				};
			}
			
			// Handle other errors
			throw new HttpException(
				error.message || 'Failed to process password reset request',
				error.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	async resetPassword(resetPasswordInput: ResetPasswordInput) {
		this.logger.log(`Reset password attempt with token: ${resetPasswordInput.token.substring(0, 10)}...`);
		try {
			const { token, password } = resetPasswordInput;

			// Find reset record
			this.logger.debug(`Finding reset record by token`);
			const resetRecord = await this.passwordResetService.findByToken(token);
			if (!resetRecord) {
				this.logger.warn(`Invalid or expired reset token provided`);
				throw new BadRequestException('Invalid or expired reset token.');
			}

			if (resetRecord.tokenExpires < new Date()) {
				this.logger.warn(`Reset token expired for email: ${resetRecord.email}`);
				await this.passwordResetService.delete(resetRecord.uid);
				throw new BadRequestException('Reset token has expired. Please request a new one.');
			}

			if (resetRecord.isUsed) {
				this.logger.warn(`Reset token already used for email: ${resetRecord.email}`);
				throw new BadRequestException('This reset token has already been used.');
			}

			// Find user
			this.logger.debug(`Finding user for password reset: ${resetRecord.email}`);
			const user = await this.userService.findOneByEmail(resetRecord.email);
			if (!user?.user) {
				this.logger.error(`User not found for password reset: ${resetRecord.email}`);
				throw new BadRequestException('User not found.');
			}

			// Hash new password
			this.logger.debug(`Hashing new password for user: ${resetRecord.email}`);
			const hashedPassword = await bcrypt.hash(password, 10);

			// Update user password
			this.logger.debug(`Updating password for user: ${resetRecord.email}`);
			await this.userService.updatePassword(user.user.uid, hashedPassword);

			// Mark reset token as used
			this.logger.debug(`Marking reset token as used for: ${resetRecord.email}`);
			await this.passwordResetService.markAsUsed(resetRecord.uid);

			// Send confirmation email
			this.logger.debug(`Sending password changed confirmation email to: ${resetRecord.email}`);
			this.eventEmitter.emit('send.email', EmailType.PASSWORD_CHANGED, [resetRecord.email], {
				name: user.user.name || resetRecord.email.split('@')[0],
				changeTime: new Date().toLocaleString(),
			});

			this.logger.log(`Password reset successful for: ${resetRecord.email}`);
			return {
				message: 'Password has been reset successfully. You can now log in with your new password.',
			};
		} catch (error) {
			this.logger.error(`Password reset failed`, error.stack);
			throw new HttpException(
				error.message || 'Failed to reset password',
				error.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	async refreshToken(token: string) {
		this.logger.log(`Refresh token attempt`);
		try {
			this.logger.debug(`Verifying refresh token`);
			const payload = await this.jwtService.verifyAsync(token);

			if (!payload) {
				this.logger.warn(`Invalid refresh token payload`);
				throw new BadRequestException('Invalid refresh token');
			}

			this.logger.debug(`Finding user by UID: ${payload?.uid}`);
			const authProfile = await this.userService.findOneByUid(Number(payload?.uid));

			if (!authProfile?.user) {
				this.logger.warn(`User not found for refresh token, UID: ${payload?.uid}`);
				throw new BadRequestException('User not found');
			}

			// Check organization license if user belongs to an organization
			if (authProfile.user.organisationRef) {
				this.logger.debug(`Checking organization license for refresh token, orgRef: ${authProfile.user.organisationRef}`);
				const licenses = await this.licensingService.findByOrganisation(authProfile.user.organisationRef);
				this.logger.debug(`Found ${licenses.length} licenses for organization during refresh: ${authProfile.user.organisationRef}`);
				
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					this.logger.warn(`No active license found for organization during refresh: ${authProfile.user.organisationRef}, licenses checked: ${licenses.length}`);
					throw new UnauthorizedException(
						"Your organization's license has expired. Please contact your administrator.",
					);
				}

				this.logger.debug(`Active license found for organization during refresh: ${authProfile.user.organisationRef}, licenseId: ${activeLicense.uid}`);
				const platform = this.platformService.getPrimaryPlatform(activeLicense?.features || {});

				const newPayload = {
					uid: payload?.uid,
					role: authProfile?.user?.accessLevel?.toLowerCase(),
					organisationRef: authProfile?.user?.organisationRef,
					platform,
					licenseId: String(activeLicense?.uid),
					licensePlan: activeLicense?.plan,
					features: activeLicense?.features,
					branch: authProfile?.user?.branch?.uid ? { uid: authProfile?.user?.branch.uid } : undefined,
				};

				this.logger.debug(`Generating new access token for user: ${authProfile.user.email}`);
				const accessToken = await this.jwtService.signAsync(newPayload, {
					expiresIn: `${process.env.JWT_ACCESS_EXPIRES_IN}`,
				});

				this.logger.log(`Access token refreshed successfully for user: ${authProfile.user.email}`);
				return {
					accessToken,
					profileData: {
						...authProfile?.user,
						platform,
						licenseInfo: {
							licenseId: String(activeLicense?.uid),
							plan: activeLicense?.plan,
							status: activeLicense?.status,
							features: activeLicense?.features,
						},
					},
					message: 'Access token refreshed successfully',
				};
			}

			// For users without organization
			this.logger.debug(`Processing refresh token for user without organization: ${authProfile.user.email}`);
			const newPayload = {
				uid: payload.uid,
				role: authProfile.user.accessLevel?.toLowerCase(),
				platform: 'all',
				branch: authProfile?.user?.branch?.uid ? { uid: authProfile?.user?.branch.uid } : undefined,
			};

			this.logger.debug(`Generating new access token for user without organization: ${authProfile.user.email}`);
			const accessToken = await this.jwtService.signAsync(newPayload, {
				expiresIn: `${process.env.JWT_ACCESS_EXPIRES_IN}`,
			});

			this.logger.log(`Access token refreshed successfully for user without organization: ${authProfile.user.email}`);
			return {
				accessToken,
				profileData: {
					...authProfile?.user,
					platform: 'all',
				},
				message: 'Access token refreshed successfully',
			};
		} catch (error) {
			this.logger.error(`Refresh token failed`, error.stack);
			if (error?.name === 'TokenExpiredError') {
				throw new HttpException('Refresh token has expired', HttpStatus.UNAUTHORIZED);
			}
			throw new HttpException(error.message || 'Failed to refresh token', error.status || HttpStatus.BAD_REQUEST);
		}
	}
}
