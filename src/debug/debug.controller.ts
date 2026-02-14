import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';

/**
 * Debug controller for development/diagnostic endpoints.
 * Use for health checks, readiness, or non-sensitive debug info.
 */
@ApiTags('Debug')
@Controller('debug')
export class DebugController {
	@Get('ping')
	@ApiOperation({ summary: 'Debug ping' })
	@ApiOkResponse({ description: 'Pong' })
	ping(): { ok: boolean; message: string } {
		return { ok: true, message: 'pong' };
	}
}
