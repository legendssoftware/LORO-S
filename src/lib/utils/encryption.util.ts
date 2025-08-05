import * as crypto from 'crypto';

export class EncryptionUtil {
	private static readonly algorithm = 'aes-256-gcm';
	private static readonly ivLength = 16;
	private static readonly tagLength = 16;

	/**
	 * Get encryption key from environment variable or generate a default one
	 * In production, this should always come from environment variables
	 */
	private static getEncryptionKey(): Buffer {
		const key = process.env.ENCRYPTION_KEY || 'loro-default-encryption-key-32chars!!';
		
		if (key.length < 32) {
			// Pad the key if it's too short
			const paddedKey = key.padEnd(32, '0');
			return Buffer.from(paddedKey, 'utf8');
		}
		
		// Take first 32 bytes if key is longer
		return Buffer.from(key.substring(0, 32), 'utf8');
	}

	/**
	 * Encrypt a string value
	 * @param text - Plain text to encrypt
	 * @returns Encrypted string with IV and auth tag
	 */
	static encrypt(text: string): string {
		if (!text || text.trim() === '') {
			return text;
		}

		try {
			const key = this.getEncryptionKey();
			const iv = crypto.randomBytes(this.ivLength);
			const cipher = crypto.createCipheriv(this.algorithm, key, iv);
			cipher.setAAD(Buffer.from('loro-encryption', 'utf8'));

			let encrypted = cipher.update(text, 'utf8', 'hex');
			encrypted += cipher.final('hex');

			const authTag = cipher.getAuthTag();

			// Combine IV + authTag + encrypted data
			const combined = iv.toString('hex') + authTag.toString('hex') + encrypted;
			return combined;
		} catch (error) {
			console.error('Encryption error:', error);
			// Return original text if encryption fails (fallback)
			return text;
		}
	}

	/**
	 * Decrypt an encrypted string
	 * @param encryptedText - Encrypted text with IV and auth tag
	 * @returns Decrypted plain text
	 */
	static decrypt(encryptedText: string): string {
		if (!encryptedText || encryptedText.trim() === '') {
			return encryptedText;
		}

		// Quick check for obviously plain text data
		if (this.looksLikePlainText(encryptedText)) {
			return encryptedText;
		}

		// Check if this looks like encrypted data
		if (!this.isEncrypted(encryptedText)) {
			return encryptedText;
		}

		try {
			const key = this.getEncryptionKey();
			
			// Extract IV, authTag, and encrypted data
			const ivHex = encryptedText.substring(0, this.ivLength * 2);
			const authTagHex = encryptedText.substring(this.ivLength * 2, (this.ivLength + this.tagLength) * 2);
			const encrypted = encryptedText.substring((this.ivLength + this.tagLength) * 2);

			// Debug logging for troubleshooting
			console.log(`[DECRYPT] Processing encrypted string length: ${encryptedText.length}`);
			console.log(`[DECRYPT] IV length: ${ivHex.length}, AuthTag length: ${authTagHex.length}, Encrypted length: ${encrypted.length}`);

			// Validate we have enough data
			if (encrypted.length === 0) {
				console.warn(`[DECRYPT] No encrypted data after extracting IV and AuthTag`);
				return encryptedText;
			}

			// Validate hex format
			if (!this.isValidHex(ivHex) || !this.isValidHex(authTagHex) || !this.isValidHex(encrypted)) {
				console.warn(`[DECRYPT] Invalid hex format detected`);
				return encryptedText;
			}

			const iv = Buffer.from(ivHex, 'hex');
			const authTag = Buffer.from(authTagHex, 'hex');

			const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
			decipher.setAAD(Buffer.from('loro-encryption', 'utf8'));
			decipher.setAuthTag(authTag);

			let decrypted = decipher.update(encrypted, 'hex', 'utf8');
			decrypted += decipher.final('utf8');

			console.log(`[DECRYPT] Successfully decrypted to: ${decrypted}`);
			return decrypted;
		} catch (error) {
			console.error(`[DECRYPT] Failed to decrypt data:`, {
				error: error.message,
				code: error.code,
				inputLength: encryptedText.length,
				inputSample: encryptedText.substring(0, 20) + '...'
			});
			
			// Return the original encrypted text as fallback
			return encryptedText;
		}
	}

	/**
	 * Hash a value using bcrypt (one-way, irreversible)
	 * @param text - Plain text to hash
	 * @param saltRounds - Number of salt rounds (default: 10)
	 * @returns Hashed string
	 */
	static async hash(text: string, saltRounds: number = 10): Promise<string> {
		const bcrypt = require('bcrypt');
		return await bcrypt.hash(text, saltRounds);
	}

	/**
	 * Compare a plain text value with a hashed value
	 * @param text - Plain text
	 * @param hash - Hashed text
	 * @returns Boolean indicating if they match
	 */
	static async compareHash(text: string, hash: string): Promise<boolean> {
		const bcrypt = require('bcrypt');
		return await bcrypt.compare(text, hash);
	}

	/**
	 * Check if a string appears to be encrypted by this utility
	 * @param text - Text to check
	 * @returns Boolean indicating if text appears encrypted
	 */
	static isEncrypted(text: string): boolean {
		if (!text || text.trim() === '') {
			return false;
		}

		// Check if it's hex format and has minimum length for IV + authTag + some data
		const minLength = (this.ivLength + this.tagLength) * 2 + 2; // +2 for at least 1 byte of data
		
		// Must be ALL hex characters and correct minimum length
		const isHexFormat = /^[a-f0-9]+$/i.test(text);
		const hasCorrectLength = text.length >= minLength;
		
		// If it's all hex and long enough, it's likely encrypted
		return isHexFormat && hasCorrectLength;
	}

	/**
	 * Check if a string is valid hexadecimal
	 * @param text - Text to check
	 * @returns Boolean indicating if text is valid hex
	 */
	private static isValidHex(text: string): boolean {
		if (!text || text.length === 0) {
			return false;
		}
		return /^[a-f0-9]+$/i.test(text) && text.length % 2 === 0;
	}

	/**
	 * Check if a string looks like plain text (not encrypted)
	 * @param text - Text to check
	 * @returns Boolean indicating if text looks like plain text
	 */
	private static looksLikePlainText(text: string): boolean {
		if (!text || text.trim() === '') {
			return true;
		}

		// If it contains non-hex characters, it's definitely plain text
		const hasNonHexChars = !/^[a-f0-9]+$/i.test(text);
		if (hasNonHexChars) {
			return true;
		}
		
		// If it's much shorter than minimum encrypted length, it's plain text
		const minEncryptedLength = (this.ivLength + this.tagLength) * 2 + 2;
		const tooShortForEncryption = text.length < minEncryptedLength;
		if (tooShortForEncryption) {
			return true;
		}

		// If it's all hex and long enough, check for obvious plain text patterns
		// (This catches cases where someone might have hex-like usernames)
		const plainTextPatterns = [
			// Email patterns
			/@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
			// Phone patterns with common formatting
			/^\+?[\d\s\-\(\)]+$/,
			// URL patterns
			/^https?:\/\//,
			// Common names (contains spaces or common name chars)
			/[A-Z][a-z]+\s+[A-Z][a-z]+/, // "First Last" pattern
			// Username with dots/underscores (but not all hex)
			/^[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z]$/
		];

		// Only check patterns if it's a reasonable length for plain text
		if (text.length < 100) {
			const matchesPattern = plainTextPatterns.some(pattern => pattern.test(text));
			if (matchesPattern) {
				return true;
			}
		}
		
		// If we get here, it's likely encrypted (all hex, right length, no obvious patterns)
		return false;
	}
}