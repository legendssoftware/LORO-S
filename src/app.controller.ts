import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse, ApiOkResponse, ApiInternalServerErrorResponse } from '@nestjs/swagger';
import { getDynamicDateTime, createApiDescription } from './lib/utils/swagger-helpers';

@ApiTags('🔧 System Health')
@Controller()
export class AppController {
	constructor(private readonly appService: AppService) {}

	@Get()
	@ApiOperation({
		summary: 'Health check endpoint',
		description: createApiDescription(
			'Returns a simple health check message to verify the API is running.',
			'This endpoint provides a basic health check to verify that the LORO API server is running and responding to requests. It returns a simple greeting message.',
			'AppService',
			'getHello',
			'returns a simple greeting string',
			'a string containing "Hello World!"',
		),
	})
	@ApiOkResponse({
		description: 'API is healthy and responding',
		schema: {
			type: 'string',
			example: 'Hello World!',
		},
	})
	getHello(): string {
		return this.appService.getHello();
	}

	@Get('health/database')
	@ApiOperation({
		summary: 'Get database connection status',
		description: createApiDescription(
			'Retrieves the current database connection status and pool information.',
			'This endpoint checks the database connection status, initialization state, connection pool size, and active connections. Useful for monitoring database health and diagnosing connection issues.',
			'AppService',
			'getDatabaseStatus',
			'checks database connection status and pool information',
			'an object containing connection status, initialization state, pool size, and active connections',
			['Database connection state', 'Connection pool metrics', 'Initialization status'],
		),
	})
	@ApiOkResponse({
		description: 'Database status retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				status: {
					type: 'string',
					example: 'Database Status Check',
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: getDynamicDateTime(),
				},
				connected: {
					type: 'boolean',
					example: true,
					description: 'Whether the database is connected',
				},
				initialized: {
					type: 'boolean',
					example: true,
					description: 'Whether the database connection is initialized',
				},
				poolSize: {
					type: 'number',
					example: 10,
					description: 'Connection pool size limit',
				},
				activeConnections: {
					type: 'number',
					example: 2,
					description: 'Number of active connections in the pool',
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: 'Failed to retrieve database status',
		schema: {
			type: 'object',
			properties: {
				status: {
					type: 'string',
					example: 'Database Status Check',
				},
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: getDynamicDateTime(),
				},
				connected: {
					type: 'boolean',
					example: false,
				},
				initialized: {
					type: 'boolean',
					example: false,
				},
			},
		},
	})
	getDatabaseStatus() {
		return {
			status: 'Database Status Check',
			timestamp: new Date().toISOString(),
			...this.appService.getDatabaseStatus(),
		};
	}

	@Post('health/database/reconnect')
	@ApiOperation({
		summary: 'Force database reconnection',
		description: createApiDescription(
			'Forces a database reconnection by destroying the existing connection and initializing a new one.',
			'This endpoint manually triggers a database reconnection. It destroys the existing database connection, waits 2 seconds, and then initializes a new connection. Use this endpoint when experiencing database connection issues.',
			'AppService',
			'forceReconnect',
			'destroys existing connection and initializes a new database connection',
			'an object containing success status and a message describing the result',
			['Connection destruction', 'Connection initialization', 'Error handling'],
		),
	})
	@ApiOkResponse({
		description: 'Database reconnection completed',
		schema: {
			type: 'object',
			properties: {
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: getDynamicDateTime(),
				},
				success: {
					type: 'boolean',
					example: true,
					description: 'Whether the reconnection was successful',
				},
				message: {
					type: 'string',
					example: 'Database reconnection successful',
					description: 'Status message describing the reconnection result',
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: 'Database reconnection failed',
		schema: {
			type: 'object',
			properties: {
				timestamp: {
					type: 'string',
					format: 'date-time',
					example: getDynamicDateTime(),
				},
				success: {
					type: 'boolean',
					example: false,
				},
				message: {
					type: 'string',
					example: 'Reconnection failed: Connection timeout',
				},
			},
		},
	})
	async forceReconnect() {
		const result = await this.appService.forceReconnect();
		return {
			timestamp: new Date().toISOString(),
			...result,
		};
	}
}
