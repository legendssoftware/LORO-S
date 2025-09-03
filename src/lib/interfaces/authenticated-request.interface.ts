import { Request } from 'express';
import { AccessLevel } from '../enums/user.enums';

export interface AuthenticatedRequest extends Request {
	user: {
		uid: number;
		accessLevel: AccessLevel;
		role: AccessLevel;
		branch?: {
			uid: number;
		};
		org?: {
			uid: number;
		};
		organisationRef?: number;
	};
}
