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
            throw new UnauthorizedException('No token provided');
        }

        try {
            // Check if token is already validated in this request
            if (request['decodedToken']) {
                return request['decodedToken'];
            }

            // Decode the token (extracts payload without verifying signature)
            const decoded = this.jwtService.decode(token, { complete: true }) as any;
            
            if (!decoded || !decoded.payload) {
                throw new UnauthorizedException('Invalid token format');
            }

            // Check expiration manually
            if (decoded.payload.exp) {
                const expirationTime = decoded.payload.exp * 1000;
                if (Date.now() >= expirationTime) {
                    throw new UnauthorizedException('Token expired');
                }
            }

            const decodedToken = decoded.payload as Token;

            // Cache the decoded token in the request object
            request['decodedToken'] = decodedToken;
            return decodedToken;
        } catch (error) {
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