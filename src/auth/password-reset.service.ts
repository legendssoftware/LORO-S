import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { PasswordReset } from './entities/password-reset.entity';

@Injectable()
export class PasswordResetService {
	private readonly logger = new Logger(PasswordResetService.name);
	private readonly TOKEN_EXPIRY_HOURS = 24; // 24 hours instead of 30 minutes
	private readonly RATE_LIMIT_MINUTES = 15; // Minimum 15 minutes between requests

	constructor(
		@InjectRepository(PasswordReset)
		private passwordResetRepository: Repository<PasswordReset>,
	) {}

	async create(email: string, resetToken: string): Promise<PasswordReset> {
		try {
			// Check for recent requests (rate limiting)
			const recentRequest = await this.passwordResetRepository.findOne({
				where: { 
					email, 
					isUsed: false,
					createdAt: new Date(Date.now() - this.RATE_LIMIT_MINUTES * 60 * 1000)
				},
				order: { createdAt: 'DESC' },
			});

			if (recentRequest && recentRequest.tokenExpires > new Date()) {
				const minutesLeft = Math.ceil((recentRequest.tokenExpires.getTime() - Date.now()) / (60 * 1000));
				throw new BadRequestException(
					`A password reset link was already sent to this email. Please check your inbox or wait ${minutesLeft} minutes before requesting another.`
				);
			}

			// Clean up any existing unused tokens for this email
			await this.passwordResetRepository.delete({
				email,
				isUsed: false,
			});

			const passwordReset = this.passwordResetRepository.create({
				email,
				resetToken,
				tokenExpires: new Date(Date.now() + this.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000),
			});

			const savedReset = await this.passwordResetRepository.save(passwordReset);
			this.logger.log(`Password reset token created for email: ${email}`);
			
			return savedReset;
		} catch (error) {
			this.logger.error(`Error creating password reset token for ${email}: ${error.message}`);
			throw error;
		}
	}

	async findByEmail(email: string): Promise<PasswordReset | null> {
		try {
			return await this.passwordResetRepository.findOne({
				where: { email, isUsed: false },
				order: { createdAt: 'DESC' },
			});
		} catch (error) {
			this.logger.error(`Error finding password reset by email ${email}: ${error.message}`);
			return null;
		}
	}

	async findByToken(token: string): Promise<PasswordReset | null> {
		try {
			return await this.passwordResetRepository.findOne({
				where: { resetToken: token, isUsed: false },
			});
		} catch (error) {
			this.logger.error(`Error finding password reset by token: ${error.message}`);
			return null;
		}
	}

	async markAsUsed(uid: number): Promise<void> {
		try {
			await this.passwordResetRepository.update(uid, { isUsed: true });
			this.logger.log(`Password reset token marked as used: ${uid}`);
		} catch (error) {
			this.logger.error(`Error marking password reset token as used ${uid}: ${error.message}`);
			throw error;
		}
	}

	async delete(uid: number): Promise<void> {
		try {
			await this.passwordResetRepository.delete(uid);
			this.logger.log(`Password reset token deleted: ${uid}`);
		} catch (error) {
			this.logger.error(`Error deleting password reset token ${uid}: ${error.message}`);
			throw error;
		}
	}

	async cleanupExpired(): Promise<void> {
		try {
			const result = await this.passwordResetRepository.delete({
				tokenExpires: LessThan(new Date()),
				isUsed: false,
			});
			
			if (result.affected && result.affected > 0) {
				this.logger.log(`Cleaned up ${result.affected} expired password reset tokens`);
			}
		} catch (error) {
			this.logger.error(`Error cleaning up expired password reset tokens: ${error.message}`);
		}
	}

	async getResetStats(email: string): Promise<{
		hasActiveReset: boolean;
		minutesUntilExpiry: number;
		requestCount: number;
	}> {
		try {
			const activeReset = await this.passwordResetRepository.findOne({
				where: { email, isUsed: false },
				order: { createdAt: 'DESC' },
			});

			const requestCount = await this.passwordResetRepository.count({
				where: { 
					email,
					createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
				}
			});

			return {
				hasActiveReset: activeReset && activeReset.tokenExpires > new Date(),
				minutesUntilExpiry: activeReset 
					? Math.ceil((activeReset.tokenExpires.getTime() - Date.now()) / (60 * 1000))
					: 0,
				requestCount
			};
		} catch (error) {
			this.logger.error(`Error getting reset stats for ${email}: ${error.message}`);
			return { hasActiveReset: false, minutesUntilExpiry: 0, requestCount: 0 };
		}
	}
}
