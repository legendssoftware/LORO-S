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
import { UnifiedNotificationService } from '../lib/services/unified-notification.service';
import { NotificationEvent, NotificationPriority } from '../lib/types/unified-notification.types';
import { ExpoPushService } from '../lib/services/expo-push.service';

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
		private unifiedNotificationService: UnifiedNotificationService,
		private expoPushService: ExpoPushService,
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
			const { username, password, expoPushToken, deviceId, platform } = signInInput;

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

						// Send failed login push notification
						try {
							const attemptTime = new Date().toLocaleTimeString('en-ZA', {
								hour: '2-digit',
								minute: '2-digit',
								hour12: true,
							});
							const attemptDate = new Date().toLocaleDateString('en-ZA', {
								weekday: 'long',
								year: 'numeric',
								month: 'long',
								day: 'numeric',
							});

							this.logger.debug(`Sending failed login push notification to user: ${username}`);
							await this.unifiedNotificationService.sendTemplatedNotification(
								NotificationEvent.AUTH_LOGIN_FAILED,
								[userByEmail.user.uid],
								{
									message: `🚨 Security Alert: Failed login attempt detected on your account on ${attemptDate} at ${attemptTime}. If this wasn't you, please secure your account immediately.`,
									userName: userByEmail.user.name || username,
									attemptTime,
									attemptDate,
									ipAddress: requestData?.ipAddress || 'Unknown',
									location: requestData?.location || 'Unknown',
									deviceType: requestData?.deviceType || 'Unknown',
									browser: requestData?.browser || 'Unknown',
									securityTip: 'Change your password immediately if you suspect unauthorized access',
									timestamp: new Date().toISOString(),
								},
								{
									priority: NotificationPriority.HIGH,
								},
							);
							this.logger.debug(`Failed login push notification sent to user: ${username}`);
						} catch (notificationError) {
							this.logger.warn(
								`Failed to send failed login push notification to user ${username}:`,
								notificationError.message,
							);
						}
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

				this.logger.log(`User sign in successful: ${username}`);

				// Prepare response data immediately
				const responseData = {
					profileData,
					accessToken,
					refreshToken,
					message: `Welcome ${profileData.name}!`,
				};

				// Process non-critical operations asynchronously (don't block user response)
				setImmediate(async () => {
					try {
						// Award XP for daily login
						try {
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
						} catch (xpError) {
							this.logger.error(`Failed to award XP for daily login to user ${username}:`, xpError.message);
						}

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
						} catch (emailError) {
							this.logger.error(`Failed to send login notification email to user ${username}:`, emailError.message);
						}

						// Send successful login push notification
						try {
							const loginTime = new Date().toLocaleTimeString('en-ZA', {
								hour: '2-digit',
								minute: '2-digit',
								hour12: true,
							});
							const loginDate = new Date().toLocaleDateString('en-ZA', {
								weekday: 'long',
								year: 'numeric',
								month: 'long',
								day: 'numeric',
							});

							this.logger.debug(`Sending successful login push notification to user: ${username}`);
							await this.unifiedNotificationService.sendTemplatedNotification(
								NotificationEvent.AUTH_LOGIN_SUCCESS,
								[authProfile.user.uid],
								{
									message: `Welcome back, ${profileData.name}! Successfully signed in on ${loginDate} at ${loginTime}.`,
									userName: profileData.name,
									loginTime,
									loginDate,
									ipAddress: requestData?.ipAddress || 'Unknown',
									location: requestData?.location || 'Unknown',
									deviceType: requestData?.deviceType || 'Unknown',
									browser: requestData?.browser || 'Unknown',
									timestamp: new Date().toISOString(),
								},
								{
									priority: NotificationPriority.LOW,
								},
							);
							this.logger.debug(`Successful login push notification sent to user: ${username}`);
						} catch (notificationError) {
							this.logger.warn(
								`Failed to send successful login push notification to user ${username}:`,
								notificationError.message,
							);
						}

						// Check device registration for push notifications (async, don't block login)
						try {
							await this.checkAndUpdateDeviceRegistration(authProfile.user, {
								expoPushToken,
								deviceId,
								platform,
								...requestData,
							});
						} catch (deviceError) {
							this.logger.warn(`Failed to check device registration for user ${username}:`, deviceError.message);
						}

					} catch (backgroundError) {
						this.logger.error(`Background sign-in tasks failed for user ${username}:`, backgroundError.message);
						// Don't affect user experience
					}
				});

				return responseData;
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

			// Check device registration for push notifications (async, don't block login)
			this.checkAndUpdateDeviceRegistration(authProfile.user, {
				expoPushToken,
				deviceId,
				platform,
				...requestData,
			}).catch(error => {
				this.logger.warn(`Failed to check device registration for user ${username}:`, error.message);
			});

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

		await this.userService.create({
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

		// Get the created user for notifications
		const createdUserResult = await this.userService.findOneByEmail(pendingSignup.email);
		if (!createdUserResult?.user) {
			this.logger.error(`Failed to find created user: ${pendingSignup.email}`);
			throw new BadRequestException('User creation failed');
		}
		const createdUser = createdUserResult.user;

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

		// Send password set success push notification
		try {
			const setupTime = new Date().toLocaleTimeString('en-ZA', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true,
			});
			const setupDate = new Date().toLocaleDateString('en-ZA', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});

			this.logger.debug(`Sending password setup success push notification to: ${pendingSignup.email}`);
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.AUTH_PASSWORD_SET_SUCCESS,
				[createdUser.uid],
				{
					message: `🎉 Welcome to Loro! Your password has been set successfully on ${setupDate} at ${setupTime}. Your account is now ready to use.`,
					userName: username,
					setupTime,
					setupDate,
					webAppLink,
					mobileAppLink,
					timestamp: new Date().toISOString(),
				},
				{
					priority: NotificationPriority.NORMAL,
				},
			);
			this.logger.debug(`Password setup success push notification sent to: ${pendingSignup.email}`);
		} catch (notificationError) {
			this.logger.warn(
				`Failed to send password setup success push notification to ${pendingSignup.email}:`,
				notificationError.message,
			);
			// Don't fail account creation if notification fails
		}

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

		// Generate reset token and mobile deep link URL
		this.logger.debug(`Generating reset token for user: ${email}`);
		const resetToken = await this.generateSecureToken();
		// Create mobile app deep link for password reset
		const mobileDeepLink = `loro://new-password?token=${resetToken}`;
		// Fallback web URL for email clients that don't support deep links
		const webResetUrl = `${process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN}/new-password?token=${resetToken}`;
		this.logger.debug(`Mobile deep link generated: loro://new-password?token=[TOKEN]`);
		this.logger.debug(`Web fallback URL generated: ${webResetUrl.substring(0, webResetUrl.lastIndexOf('/') + 1)}[TOKEN]`);

			// Create password reset record (this will handle rate limiting and duplicates)
			this.logger.debug(`Creating password reset record for: ${email}`);
			await this.passwordResetService.create(email, resetToken);
			this.logger.debug(`Password reset record created successfully for: ${email}`);

					// Send password reset email with mobile deep link and web fallback
		this.logger.debug(`Sending password reset email to: ${email}`);
		this.eventEmitter.emit('send.email', EmailType.PASSWORD_RESET_REQUEST, [email], {
			name: existingUser.user.name || email.split('@')[0],
			userEmail: email,
			requestTime: new Date().toLocaleString(),
			resetLink: mobileDeepLink, // Primary mobile deep link
			webResetLink: webResetUrl, // Fallback web URL
			mobileDeepLink: mobileDeepLink, // Explicit mobile deep link for email template
			expiryHours: 24,
			supportEmail: process.env.SUPPORT_EMAIL || 'support@loro.africa',
			dashboardUrl: `${process.env.WEBSITE_DOMAIN || process.env.SIGNUP_DOMAIN || 'https://dashboard.loro.co.za'}/dashboard`,
		});

		// Send password reset push notification
		try {
			const requestTime = new Date().toLocaleTimeString('en-ZA', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true,
			});
			const requestDate = new Date().toLocaleDateString('en-ZA', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});

			this.logger.debug(`Sending password reset push notification to: ${email}`);
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.AUTH_PASSWORD_RESET_REQUEST,
				[existingUser.user.uid],
				{
					message: `🔐 Password reset requested for your account on ${requestDate} at ${requestTime}. Check your email for reset instructions. If this wasn't you, please contact support immediately.`,
					userName: existingUser.user.name || email.split('@')[0],
					requestTime,
					requestDate,
					expiryHours: 24,
					timestamp: new Date().toISOString(),
				},
				{
					priority: NotificationPriority.HIGH,
				},
			);
			this.logger.debug(`Password reset push notification sent to: ${email}`);
		} catch (notificationError) {
			this.logger.warn(
				`Failed to send password reset push notification to ${email}:`,
				notificationError.message,
			);
			// Don't fail the password reset if notification fails
		}

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

		// Send password changed push notification
		try {
			const changeTime = new Date().toLocaleTimeString('en-ZA', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true,
			});
			const changeDate = new Date().toLocaleDateString('en-ZA', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});

			this.logger.debug(`Sending password changed push notification to: ${resetRecord.email}`);
			await this.unifiedNotificationService.sendTemplatedNotification(
				NotificationEvent.AUTH_PASSWORD_CHANGED,
				[user.user.uid],
				{
					message: `🔐 Password updated successfully! Your password was changed on ${changeDate} at ${changeTime}. If this wasn't you, please contact support immediately.`,
					userName: user.user.name || resetRecord.email.split('@')[0],
					changeTime,
					changeDate,
					timestamp: new Date().toISOString(),
				},
				{
					priority: NotificationPriority.HIGH,
				},
			);
			this.logger.debug(`Password changed push notification sent to: ${resetRecord.email}`);
		} catch (notificationError) {
			this.logger.warn(
				`Failed to send password changed push notification to ${resetRecord.email}:`,
				notificationError.message,
			);
			// Don't fail password reset if notification fails
		}

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
				// Try to send expired token notification
				try {
					// Try to extract user information from the expired token without verification
					const decodedToken = this.jwtService.decode(token) as any;
					if (decodedToken?.uid) {
						const expiredTime = new Date().toLocaleTimeString('en-ZA', {
							hour: '2-digit',
							minute: '2-digit',
							hour12: true,
						});
						const expiredDate = new Date().toLocaleDateString('en-ZA', {
							weekday: 'long',
							year: 'numeric',
							month: 'long',
							day: 'numeric',
						});

						this.logger.debug(`Sending token expired push notification to user: ${decodedToken.uid}`);
						await this.unifiedNotificationService.sendTemplatedNotification(
							NotificationEvent.AUTH_TOKEN_EXPIRED,
							[decodedToken.uid],
							{
								message: `🔐 Your session has expired on ${expiredDate} at ${expiredTime}. Please sign in again to continue using the application securely.`,
								expiredTime,
								expiredDate,
								requiresSignIn: true,
								timestamp: new Date().toISOString(),
							},
							{
								priority: NotificationPriority.NORMAL,
							},
						);
						this.logger.debug(`Token expired push notification sent to user: ${decodedToken.uid}`);
					}
				} catch (notificationError) {
					this.logger.warn(
						`Failed to send token expired push notification:`,
						notificationError.message,
					);
					// Don't fail the token expiration if notification fails
				}
				throw new HttpException('Refresh token has expired', HttpStatus.UNAUTHORIZED);
			}
			throw new HttpException(error.message || 'Failed to refresh token', error.status || HttpStatus.BAD_REQUEST);
		}
	}

	/**
	 * Check and update device registration for push notifications
	 * This runs asynchronously after successful sign-in
	 */
	private async checkAndUpdateDeviceRegistration(user: any, requestData?: any): Promise<void> {
		// Extract correlation ID from request data for tracking
		const correlationId = requestData?.correlationId || `device-reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		
		try {
			this.logger.log(`🔍 [${correlationId}] [DeviceRegistration] Starting device registration check for user: ${user.email}`);

			// Extract device info from request data
			const deviceToken = requestData?.expoPushToken || requestData?.pushToken;
			const deviceId = requestData?.deviceId;
			// Ensure we use the actual device platform, not user platform
			const devicePlatform = requestData?.platform;
			const userAgent = requestData?.userAgent || '';
			
			// Determine platform with better detection logic
			let platform = devicePlatform;
			if (!platform || platform === 'all') {
				// Fallback to user agent detection
				if (userAgent.toLowerCase().includes('android')) {
					platform = 'android';
				} else if (userAgent.toLowerCase().includes('ios') || userAgent.toLowerCase().includes('iphone') || userAgent.toLowerCase().includes('ipad')) {
					platform = 'ios';
				} else {
					// Default based on device ID pattern if available
					if (deviceId?.toLowerCase().includes('android')) {
						platform = 'android';
					} else if (deviceId?.toLowerCase().includes('ios')) {
						platform = 'ios';
					} else {
						platform = 'unknown';
					}
				}
			}

			this.logger.debug(`📱 [${correlationId}] [DeviceRegistration] Device data received:`, {
				hasToken: !!deviceToken,
				tokenLength: deviceToken?.length || 0,
				tokenPrefix: deviceToken ? deviceToken.substring(0, 30) + '...' : 'NO_TOKEN_PROVIDED',
				deviceId: deviceId || 'NO_DEVICE_ID',
				platform: platform || 'NO_PLATFORM',
				originalPlatform: requestData?.platform || 'NOT_PROVIDED',
				userAgent: userAgent ? userAgent.substring(0, 100) + '...' : 'NOT_PROVIDED',
				userId: user.uid,
				userEmail: user.email,
				correlationId,
			});

			// Check if user has existing device registration
			const currentRegistration = this.expoPushService.getDeviceRegistrationSummary(user);
			this.logger.debug(`📊 [${correlationId}] [DeviceRegistration] Current user registration status:`, {
				hasToken: currentRegistration.hasToken,
				tokenValid: currentRegistration.tokenValid,
				recommendAction: currentRegistration.recommendAction,
				lastUpdated: currentRegistration.deviceInfo.lastUpdated,
				correlationId,
			});

			// Handle case where no device token is provided
			if (!deviceToken) {
				// Check if this is a mobile app that will register separately
				const isMobileApp = userAgent?.includes('Expo') || userAgent?.includes('okhttp') || 
								   platform === 'android' || platform === 'ios';
				
				this.logger.log(`🔍 [${correlationId}] [DeviceRegistration] No device token in sign-in request - analyzing situation for user: ${user.email}`);
				this.logger.debug(`📱 [${correlationId}] [DeviceRegistration] Token analysis:`, {
					isMobileApp,
					hasCurrentToken: currentRegistration.hasToken,
					currentTokenValid: currentRegistration.tokenValid,
					recommendedAction: currentRegistration.recommendAction,
					userAgent: userAgent ? userAgent.substring(0, 50) + '...' : 'NOT_PROVIDED',
					detectedPlatform: platform,
					correlationId
				});
				
				if (isMobileApp) {
					this.logger.log(`📱 [${correlationId}] [DeviceRegistration] Mobile app detected - expecting post-login registration attempts for user: ${user.email}`);
					this.logger.log(`⏳ [${correlationId}] [DeviceRegistration] Mobile app ${user.email} should retry registration after sign-in with device token`);
				} else {
					this.logger.warn(`⚠️ [${correlationId}] [DeviceRegistration] Web/unknown client without token for user: ${user.email}`);
				}
				
				if (!currentRegistration.hasToken) {
					if (isMobileApp) {
						this.logger.log(`🟡 [${correlationId}] [DeviceRegistration] Mobile user ${user.email} has NO stored push token - post-login registration REQUIRED`);
					} else {
						this.logger.log(`🔴 [${correlationId}] [DeviceRegistration] User ${user.email} has NO push token registered - notifications DISABLED until device registers`);
					}
				} else if (!currentRegistration.tokenValid) {
					this.logger.warn(`🔴 [${correlationId}] [DeviceRegistration] User ${user.email} has INVALID stored push token - re-registration REQUIRED`);
				} else {
					this.logger.log(`✅ [${correlationId}] [DeviceRegistration] User ${user.email} has valid stored token - notifications should work`);
				}
				
				// Add a clear indication that post-login registration is expected
				if (isMobileApp && !currentRegistration.hasToken) {
					this.logger.log(`📋 [${correlationId}] [DeviceRegistration] EXPECTATION: Mobile client should make 1-3 registration attempts after this sign-in for user: ${user.email}`);
				}
				
				return;
			}

			// Check if device registration is needed
			this.logger.debug(`🔍 [${correlationId}] [DeviceRegistration] Checking registration status with provided token...`);
			const registrationStatus = await this.expoPushService.checkDeviceRegistrationStatus(
				user,
				deviceToken,
				deviceId,
				platform
			);

			this.logger.log(`📊 [${correlationId}] [DeviceRegistration] Registration check results for user ${user.email}:`, {
				needsRegistration: registrationStatus.needsRegistration,
				reason: registrationStatus.reason,
				hasServerToken: !!registrationStatus.serverToken,
				isValidFormat: registrationStatus.isValidFormat,
				tokensMatch: registrationStatus.tokensMatch,
				correlationId,
			});

			// Initialize registration tracking variables
			let registrationSuccess = false;
			let lastError: any = null;
			
			// If registration is needed, we should update the user's token immediately with retry logic
			if (registrationStatus.needsRegistration) {
				this.logger.log(`🔄 [${correlationId}] [DeviceRegistration] Device registration needed for user ${user.email}: ${registrationStatus.reason}`);

				// Retry device registration up to 3 times
				for (let attempt = 1; attempt <= 3; attempt++) {
					try {
						this.logger.log(`📱 [${correlationId}] [DeviceRegistration] Registration attempt ${attempt}/3 for user ${user.email}`);
						this.logger.debug(`📱 [${correlationId}] [DeviceRegistration] Attempt ${attempt} device data:`, {
							tokenLength: deviceToken?.length || 0,
							tokenPrefix: deviceToken ? deviceToken.substring(0, 30) + '...' : 'NO_TOKEN_PROVIDED',
							deviceId: deviceId || 'NO_DEVICE_ID',
							platform: platform || 'NO_PLATFORM',
							userId: user.uid,
							userEmail: user.email,
							attempt,
							correlationId
						});

						// Update user's push token directly in the database
						await this.userService.updateDeviceRegistration(user.uid, {
							expoPushToken: deviceToken,
							deviceId: deviceId,
							platform: platform,
							pushTokenUpdatedAt: new Date(),
						});

						this.logger.log(`✅ [${correlationId}] [DeviceRegistration] Successfully updated device registration for user ${user.email} on attempt ${attempt}`);
						
						// Update the user object in memory to reflect the changes for consistent status reporting
						user.expoPushToken = deviceToken;
						user.deviceId = deviceId;
						user.platform = platform;
						user.pushTokenUpdatedAt = new Date();
						
						registrationSuccess = true;
						break; // Exit retry loop on success

					} catch (updateError) {
						lastError = updateError;
						this.logger.warn(`⚠️ [${correlationId}] [DeviceRegistration] Registration attempt ${attempt}/3 failed for user ${user.email}:`, updateError.message);
						
						// Wait before retry (exponential backoff)
						if (attempt < 3) {
							const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000); // 500ms, 1s, 2s max
							this.logger.debug(`⏳ [${correlationId}] [DeviceRegistration] Waiting ${delay}ms before retry attempt ${attempt + 1} for user ${user.email}`);
							await new Promise(resolve => setTimeout(resolve, delay));
						}
					}
				}

				// Handle final result
				if (registrationSuccess) {
					this.logger.log(`🎉 [${correlationId}] [DeviceRegistration] Device registration completed successfully after retry attempts for user ${user.email}`);
					
					// Optionally verify the token works
					try {
						const verificationResult = await this.expoPushService.verifyTokenDelivery(deviceToken);
						if (verificationResult.canReceive) {
							this.logger.log(`✅ [${correlationId}] [DeviceRegistration] Push token verified working for user ${user.email}`);
						} else {
							this.logger.warn(`⚠️ [${correlationId}] [DeviceRegistration] Push token verification failed for user ${user.email}: ${verificationResult.error}`);
						}
					} catch (verifyError) {
						this.logger.warn(`⚠️ [${correlationId}] [DeviceRegistration] Could not verify token delivery: ${verifyError.message}`);
					}
				} else {
					this.logger.error(`❌ [${correlationId}] [DeviceRegistration] All 3 registration attempts failed for user ${user.email}. Last error:`, lastError?.message);
					this.logger.error(`💔 [${correlationId}] [DeviceRegistration] User ${user.email} will not receive push notifications until device re-registers`);
					return; // Exit early if all attempts failed
				}
			} else {
				this.logger.log(`✅ [${correlationId}] [DeviceRegistration] Device registration is current for user: ${user.email}`);
				registrationSuccess = true; // No registration needed means it's already successful
			}

			// Final status check with updated user object
			const finalSummary = this.expoPushService.getDeviceRegistrationSummary(user);
			this.logger.log(`📋 [${correlationId}] [DeviceRegistration] Final registration summary for user ${user.email}:`, {
				hasToken: finalSummary.hasToken,
				tokenValid: finalSummary.tokenValid,
				recommendAction: finalSummary.recommendAction,
				deviceInfo: finalSummary.deviceInfo,
				registrationAttemptsMade: registrationStatus.needsRegistration ? (registrationSuccess ? 'SUCCESS_AFTER_RETRIES' : 'FAILED_ALL_ATTEMPTS') : 'NO_ATTEMPTS_NEEDED',
				correlationId,
			});

			// Log completion summary
			if (registrationStatus.needsRegistration) {
				this.logger.log(`🏁 [${correlationId}] [DeviceRegistration] Device registration process completed for ${user.email} - Outcome: ${registrationSuccess ? 'SUCCESS' : 'FAILED'}`);
			} else {
				this.logger.log(`🏁 [${correlationId}] [DeviceRegistration] Device registration check completed for ${user.email} - No registration needed`);
			}

		} catch (error) {
			this.logger.error(`❌ [${correlationId}] [DeviceRegistration] Failed to check device registration for user ${user.email}:`, {
				error: error.message,
				stack: error.stack,
				correlationId,
			});
			// Don't throw error as this should not block sign-in
		}
	}
}
