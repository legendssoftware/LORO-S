import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
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
	constructor(
		private jwtService: JwtService,
		private userService: UserService,
		private rewardsService: RewardsService,
		private eventEmitter: EventEmitter2,
		private pendingSignupService: PendingSignupService,
		private passwordResetService: PasswordResetService,
		private licensingService: LicensingService,
		private platformService: PlatformService,
	) {}

	private excludePassword(user: any): Omit<typeof user, 'password'> {
		const { password, ...userWithoutPassword } = user;
		return userWithoutPassword;
	}

	private async generateSecureToken(): Promise<string> {
		return crypto.randomBytes(32).toString('hex');
	}

	async signIn(signInInput: SignInInput, requestData?: any): Promise<SignInResponse> {
		try {
			const { username, password } = signInInput;

			const authProfile = await this.userService.findOneForAuth(username);

			if (!authProfile?.user) {
				// Send failed login email for unknown user
				try {
					// Try to find user by email for failed login notification
					const userByEmail = await this.userService.findOneByEmail(username);
					if (userByEmail?.user) {
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
					console.error('Failed to send failed login notification email:', error);
				}
				throw new BadRequestException('Invalid credentials provided');
			}

			const { password: userPassword } = authProfile?.user;

			const isPasswordValid = await bcrypt.compare(password, userPassword);

			if (!isPasswordValid) {
				// Send failed login email for incorrect password
				try {
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
					console.error('Failed to send failed login notification email:', error);
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
				const licenses = await this.licensingService.findByOrganisation(organisationRef);
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					throw new UnauthorizedException(
						"Your organization's license has expired. Please contact your administrator.",
					);
				}

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

				const accessToken = await this.jwtService.signAsync(payload, { expiresIn: `8h` });
				const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: `7d` });

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

				await this.rewardsService.awardXP(gainedXP);

				// Send login notification email
				try {
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
					console.error('Failed to send login notification email:', error);
				}

				return {
					profileData,
					accessToken,
					refreshToken,
					message: `Welcome ${profileData.name}!`,
				};
			}

			// For users without organization (like system admins)
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

			const accessToken = await this.jwtService.signAsync(payload, { expiresIn: `8h` });
			const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: `7d` });

			return {
				profileData,
				accessToken,
				refreshToken,
				message: `Welcome ${profileData.name}!`,
			};
		} catch (error) {
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
		try {
			const { email } = signUpInput;

			// Check for existing user
			const existingUser = await this.userService.findOneByEmail(email);
			if (existingUser?.user) {
				throw new BadRequestException('Email already taken, please try another one.');
			}

			// Check for existing pending signup
			const existingPendingSignup = await this.pendingSignupService.findByEmail(email);
			if (existingPendingSignup) {
				// If token is still valid, don't send new email
				if (!existingPendingSignup.isVerified && existingPendingSignup.tokenExpires > new Date()) {
					return {
						message: 'Please check your email for the verification link sent earlier.',
					};
				}
				// Delete expired signup
				await this.pendingSignupService.delete(existingPendingSignup.uid);
			}

			// Generate verification token and URL
			const verificationToken = await this.generateSecureToken();
			const verificationUrl = `${process.env.SIGNUP_DOMAIN}/verify/${verificationToken}`;

			// Create pending signup
			await this.pendingSignupService.create(email, verificationToken);

			// Send verification email
			this.eventEmitter.emit('send.email', EmailType.VERIFICATION, [email], {
				name: email.split('@')[0],
				verificationLink: verificationUrl,
				expiryHours: 24,
			});

			return {
				status: 'success',
				message: 'Please check your email and verify your account within the next 24 hours.',
			};
		} catch (error) {
			return {
				message: error?.message,
			};
		}
	}

	async verifyEmail(verifyEmailInput: VerifyEmailInput, requestData?: any) {
		try {
			const { token } = verifyEmailInput;
			const pendingSignup = await this.pendingSignupService.findByToken(token);

			if (!pendingSignup) {
				throw new BadRequestException('Invalid verification token');
			}

			if (pendingSignup.tokenExpires < new Date()) {
				await this.pendingSignupService.delete(pendingSignup.uid);
				throw new BadRequestException('Verification token has expired. Please sign up again.');
			}

			if (pendingSignup.isVerified) {
				throw new BadRequestException('Email already verified. Please proceed to set your password.');
			}

			await this.pendingSignupService.markAsVerified(pendingSignup.uid);

			// Send email verification success notification
			try {
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
				console.error('Failed to send email verification success notification:', error);
			}

			return {
				message: 'Email verified successfully. You can now set your password.',
				email: pendingSignup.email,
			};
		} catch (error) {
			throw new HttpException(
				error.message || 'Email verification failed',
				error.status || HttpStatus.BAD_REQUEST,
			);
		}
	}

	async setPassword(setPasswordInput: SetPasswordInput) {
		try {
			const { token, password } = setPasswordInput;
			const pendingSignup = await this.pendingSignupService.findByToken(token);

			if (!pendingSignup) {
				throw new BadRequestException('Invalid token');
			}

			if (!pendingSignup.isVerified) {
				throw new BadRequestException('Email not verified. Please verify your email first.');
			}

			if (pendingSignup.tokenExpires < new Date()) {
				await this.pendingSignupService.delete(pendingSignup.uid);
				throw new BadRequestException('Token has expired. Please sign up again.');
			}

			// Create the actual user account
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
			await this.pendingSignupService.delete(pendingSignup.uid);

			// Get the web and mobile app links from environment variables
			const webAppLink = `${process.env.WEBSITE_DOMAIN}/sign-in` || '/sign-in';
			const mobileAppLink = `${process.env.WEBSITE_DOMAIN}/mobile-app` || null;

			// Send welcome email to the new user
			this.eventEmitter.emit('send.email', EmailType.SIGNUP, [pendingSignup.email], {
				name: username,
				webAppLink: webAppLink,
				mobileAppLink: mobileAppLink,
			});

			// Notify admin users about the new user registration
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

			const response = {
				status: 'success',
				message: 'Account created successfully. You can now sign in.',
			};

			return response;
		} catch (error) {
			throw new HttpException(
				error.message || 'Failed to create account',
				error.status || HttpStatus.BAD_REQUEST,
			);
		}
	}

	async forgotPassword(forgotPasswordInput: ForgotPasswordInput) {
		try {
			const { email } = forgotPasswordInput;

			// Find user by email
			const existingUser = await this.userService.findOneByEmail(email);

			if (!existingUser?.user) {
				// Return success even if user not found for security
				return {
					message: 'If an account exists with this email, you will receive password reset instructions.',
				};
			}

			// Generate reset token and URL
			const resetToken = await this.generateSecureToken();
			const resetUrl = `${process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN}/reset-password/${resetToken}`;

			// Create password reset record (this will handle rate limiting and duplicates)
			await this.passwordResetService.create(email, resetToken);

			// Send single password reset email with security alert and reset link
			this.eventEmitter.emit('send.email', EmailType.PASSWORD_RESET_REQUEST, [email], {
				name: existingUser.user.name || email.split('@')[0],
				userEmail: email,
				requestTime: new Date().toLocaleString(),
				resetLink: resetUrl,
				expiryHours: 24,
				supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
				dashboardUrl: `${process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN || 'https://dashboard.loro.co.za'}/dashboard`,
			});

			return {
				message: 'Password reset instructions have been sent to your email. Please check your inbox.',
			};
		} catch (error) {
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
		try {
			const { token, password } = resetPasswordInput;

			// Find reset record
			const resetRecord = await this.passwordResetService.findByToken(token);
			if (!resetRecord) {
				throw new BadRequestException('Invalid or expired reset token.');
			}

			if (resetRecord.tokenExpires < new Date()) {
				await this.passwordResetService.delete(resetRecord.uid);
				throw new BadRequestException('Reset token has expired. Please request a new one.');
			}

			if (resetRecord.isUsed) {
				throw new BadRequestException('This reset token has already been used.');
			}

			// Find user
			const user = await this.userService.findOneByEmail(resetRecord.email);
			if (!user?.user) {
				throw new BadRequestException('User not found.');
			}

			// Hash new password
			const hashedPassword = await bcrypt.hash(password, 10);

			// Update user password
			await this.userService.updatePassword(user.user.uid, hashedPassword);

			// Mark reset token as used
			await this.passwordResetService.markAsUsed(resetRecord.uid);

			// Send confirmation email
			this.eventEmitter.emit('send.email', EmailType.PASSWORD_CHANGED, [resetRecord.email], {
				name: user.user.name || resetRecord.email.split('@')[0],
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

	async refreshToken(token: string) {
		try {
			const payload = await this.jwtService.verifyAsync(token);

			if (!payload) {
				throw new BadRequestException('Invalid refresh token');
			}

			const authProfile = await this.userService.findOneByUid(Number(payload?.uid));

			if (!authProfile?.user) {
				throw new BadRequestException('User not found');
			}

			// Check organization license if user belongs to an organization
			if (authProfile.user.organisationRef) {
				const licenses = await this.licensingService.findByOrganisation(authProfile.user.organisationRef);
				const activeLicense = licenses.find((license) =>
					this.licensingService.validateLicense(String(license?.uid)),
				);

				if (!activeLicense) {
					throw new UnauthorizedException(
						"Your organization's license has expired. Please contact your administrator.",
					);
				}

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

				const accessToken = await this.jwtService.signAsync(newPayload, {
					expiresIn: `${process.env.JWT_ACCESS_EXPIRES_IN}`,
				});

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
			const newPayload = {
				uid: payload.uid,
				role: authProfile.user.accessLevel?.toLowerCase(),
				platform: 'all',
				branch: authProfile?.user?.branch?.uid ? { uid: authProfile?.user?.branch.uid } : undefined,
			};

			const accessToken = await this.jwtService.signAsync(newPayload, {
				expiresIn: `${process.env.JWT_ACCESS_EXPIRES_IN}`,
			});

			return {
				accessToken,
				profileData: {
					...authProfile?.user,
					platform: 'all',
				},
				message: 'Access token refreshed successfully',
			};
		} catch (error) {
			if (error?.name === 'TokenExpiredError') {
				throw new HttpException('Refresh token has expired', HttpStatus.UNAUTHORIZED);
			}
			throw new HttpException(error.message || 'Failed to refresh token', error.status || HttpStatus.BAD_REQUEST);
		}
	}
}
