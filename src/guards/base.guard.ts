import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Token } from '../lib/types/token';

@Injectable()
export class BaseGuard {
    constructor(protected readonly jwtService: JwtService) { }

    protected extractAndValidateToken(request: Request): Token {
        const token = this.extractTokenFromHeader(request);

        if (!token) {
            console.error('❌ [BaseGuard] No token provided');
            throw new UnauthorizedException('No token provided');
        }

        try {
            // Check if token is already validated in this request
            if (request['decodedToken']) {
                return request['decodedToken'];
            }

            // Try to verify the token first (checks signature and expiration)
            let decodedToken: Token;
            try {
                decodedToken = this.jwtService.verify(token) as Token;
                console.log('✅ [BaseGuard] Token verified successfully');
            } catch (verifyError) {
                // If verification fails (expired, invalid signature, etc.), throw error
                console.error('❌ [BaseGuard] Token verification failed:', verifyError.message);
                if (verifyError.name === 'TokenExpiredError') {
                    throw new UnauthorizedException('Token expired');
                }
                if (verifyError.name === 'JsonWebTokenError') {
                    throw new UnauthorizedException('Invalid token');
                }
                // For other errors, try decoding as fallback (for debugging)
                console.warn('⚠️ [BaseGuard] Attempting decode as fallback');
                decodedToken = this.jwtService.decode(token) as Token;
                
                if (!decodedToken) {
                    throw new UnauthorizedException('Invalid token format');
                }
            }

            if (!decodedToken) {
                throw new UnauthorizedException('Invalid token format');
            }

            // Cache the decoded token in the request object
            request['decodedToken'] = decodedToken;
            return decodedToken;
        } catch (error) {
            console.error('❌ [BaseGuard] Token extraction failed:', error.message);
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            throw new UnauthorizedException('Invalid token');
        }
    }

    private extractTokenFromHeader(request: Request): string | undefined {
        const token = request.headers['token'] as string;
		if (!token) {
			const [type, authToken] = request.headers.authorization?.split(' ') ?? [];
			return type === 'Bearer' ? authToken : undefined;
		}
		return token;
    }
} 