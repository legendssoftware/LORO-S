import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as compression from 'compression';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

	app.use(helmet());

	app.use(compression());

	app.enableCors({
		origin: [
			...(process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']),
			'https://loro.co.za',
			'https://www.loro.co.za',
			'https://*.loro.co.za',
		],
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		credentials: true,
		allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'token'],
		exposedHeaders: ['Content-Range', 'X-Content-Range'],
		maxAge: 3600, // 1 hour
	});

	const config = new DocumentBuilder()
		.setTitle('LORO API Documentation')
		.setDescription(
			`
**LORO** is a comprehensive enterprise management platform that revolutionizes how businesses manage their workforce, operations, and client relationships through cutting-edge technology and intelligent automation.

## 🌟 Platform Overview

LORO combines **GPS tracking**, **AI-powered analytics**, **real-time communication**, and **enterprise-grade security** to deliver a unified business management solution. Our platform empowers organizations to optimize operations, enhance productivity, and drive growth through data-driven insights.

### 🎯 Core Value Proposition
- **360° Business Visibility**: Real-time dashboards and analytics across all operations
- **Intelligent Automation**: AI-powered task optimization and route planning
- **Enterprise Security**: Bank-level security with role-based access control
- **Scalable Architecture**: From startups to enterprise-level organizations
- **Mobile-First Design**: Native mobile apps with offline capabilities

**🔔 Need Help?** Our expert support team is ready to assist with your integration. Contact us at [api-support@loro.co.za](mailto:api-support@loro.co.za) for personalized assistance.
`,
		)
		// === AUTHENTICATION & USER MANAGEMENT ===
		.addTag('👥 Users', 'User Management - User accounts, profiles, roles, and permissions management')
		.addTag('📋 Licensing', 'License Management - Subscription tiers, usage tracking, and license validation')
		.addTag('🔐 Authentication', 'Authentication Management - Secure authentication and authorization services')

		// === ORGANIZATION & STRUCTURE ===
		.addTag('🏢 Organisation', 'Organization Management - Core organization configuration and settings')
		.addTag(
			'🎨 Organisation Appearance',
			'Organization Appearance Management - Core organization appearance configuration and settings',
		)
		.addTag(
			'🕒 Organisation Hours',
			'Organization Hours Management - Core organization hours configuration and settings',
		)
		.addTag(
			'🔧 Organisation Settings',
			'Organization Settings Management - Core organization settings configuration and settings',
		)
		.addTag('🏪 Branches', 'Branch Management - Location-based branch operations and territory mapping')
		.addTag('📦 Assets', 'Asset Management - Digital and physical asset tracking with location support')

		// === LOCATION & TRACKING SERVICES ===
		.addTag('🗺️ GPS Tracking', 'GPS Tracking - Advanced location services with real-time position updates')
		.addTag('🔲 Geofence Settings', 'Geofence Settings - Geofence settings and management')
		.addTag('📍 Check Ins & Check Outs', 'GPS-based employee check-in with location validation')
		.addTag('⏰ Attendance', 'Employee time tracking with location verification')

		// === TASK & WORKFLOW MANAGEMENT ===
		.addTag('🔧 Tasks', 'Task Management - Task assignment, tracking, and route optimization')
		.addTag('📝 Journal', 'Activity Journal - Daily activity logging and management audit trails')
		.addTag('🌴 Leave Management', 'Leave Management - Employee leave requests and approval workflows')
		.addTag('⚠️ Warnings', 'Employee Warnings - Disciplinary actions and warning management')

		// === CLIENT & LEAD MANAGEMENT ===
		.addTag('💎 Clients', 'Client Management - Customer relationship management with location services')
		.addTag('🎯 Leads', 'Lead Management - Sales lead tracking with territory management')
		.addTag('💭 Interactions', 'Interaction Management - Customer interaction tracking and history')
		.addTag('🪙 Claims', 'Claims Processing - Insurance claims with document management')
		.addTag('💎💰 Client Authentication', 'Authentication Management - Authentication and authorization')

		// === COMPETITOR MANAGEMENT ===
		.addTag('⚡ Competitors', 'Competitor Analysis - Market analysis and competitor tracking')

		// === BUSINESS OPERATIONS ===
		.addTag('🛍️ Products', 'Product Catalog - Product management with inventory and analytics')
		.addTag('🛒 Shop', 'E-commerce Platform - Online store with location-based delivery')

		// === COMMUNICATION & NOTIFICATIONS ===
		.addTag('📱 Communication', 'Communication System - Real-time messaging with WebSocket support')
		.addTag('🔔 Notifications', 'Notification System - Push notifications and alerts')
		.addTag('📰 News', 'Company News - Internal announcements and updates')
		.addTag('🔄 WebSocket', 'WebSocket Services - Real-time bi-directional communication')

		// === ANALYTICS & REPORTING ===
		.addTag('📊 Reports', 'Business Reports - Analytics dashboard with location insights')
		.addTag('🏆 Rewards', 'Rewards System - Employee recognition and performance tracking')
		.addTag('💬 Feedback', 'Feedback Management - Customer and employee feedback collection')

		// === EXTERNAL INTEGRATIONS ===
		.addTag('↗️ Resellers', 'Reseller Network - Partner management with territory mapping')

		// === UTILITIES & SERVICES ===
		.addTag('⚙️ PDF Generation', 'Dynamic PDF creation for business documents')
		.addTag('💾 Documents & Files', 'Document and file management with cloud storage')
		.addTag('💼 Payslips', 'Payslip management with cloud storage')

		// === WEBSOCKETS ===
		.addTag('🔄 Quotation Conversion', 'Quotation Conversion - Quotation conversion to order')
		.addTag('🌐 WebSockets', 'WebSocket Services - Real-time bi-directional communication')

		.addBearerAuth()
		.addServer('https://api.loro.co.za', 'Production')
		.addServer('https://api.dev.loro.co.za', 'Development')
		.addServer('wss://api.loro.co.za', 'WebSocket')
		.build();

	const document = SwaggerModule.createDocument(app, config, {
		deepScanRoutes: true,
		operationIdFactory: (methodKey: string) => methodKey,
	});

	// Add WebSocket documentation
	const wsDocument = {
		...document,
		components: {
			...document.components,
			schemas: {
				...document.components?.schemas,
				WebSocketNewQuotation: {
					type: 'object',
					properties: {
						event: {
							type: 'string',
							enum: ['newQuotation', 'locationUpdate', 'taskAssigned', 'statusChange'],
							description: 'WebSocket event name',
						},
						data: {
							type: 'object',
							properties: {
								id: {
									type: 'string',
									description: 'The unique identifier of the event',
								},
								type: {
									type: 'string',
									description: 'The type of event',
								},
								payload: {
									type: 'object',
									description: 'Event-specific data payload',
								},
								timestamp: {
									type: 'string',
									format: 'date-time',
									description: 'Event timestamp',
								},
							},
						},
					},
				},
			},
		},
		paths: {
			...document.paths,
			'/websocket': {
				get: {
					tags: ['websockets'],
					summary: 'WebSocket Connection',
					description:
						`# WebSocket Documentation
						
## Connection Details
- URL: wss://api.loro.co.za
- Protocol: Socket.IO

## Available Events

### System Events
- connect: Connection established
- disconnect: Connection terminated
- error: Error occurred

### Business Events
- locationUpdate: Real-time GPS position updates
- taskAssigned: New task assignments
- statusChange: Entity status changes
- newQuotation: New quotation created

## Authentication
WebSocket connections require JWT authentication via query parameter:
` +
						'```' +
						`
wss://api.loro.co.za?token=your_jwt_token
` +
						'```' +
						`

## Code Examples

### JavaScript/TypeScript
` +
						'```javascript' +
						`
import { io } from "socket.io-client";

const socket = io("wss://api.loro.co.za", {
	query: { token: "your_jwt_token" }
});

// Handle connection
socket.on("connect", function() {
	console.log("Connected to WebSocket");
});

// Listen for events
socket.on("locationUpdate", function(data) {
	console.log("Location update:", data);
});

socket.on("taskAssigned", function(data) {
	console.log("New task:", data);
});

socket.on("error", function(error) {
	console.error("WebSocket error:", error);
});
` +
						'```',
					responses: {
						'101': {
							description: 'WebSocket connection established',
							content: {
								'application/json': {
									schema: {
										$ref: '#/components/schemas/WebSocketNewQuotation',
									},
								},
							},
						},
					},
				},
			},
		},
	};

	SwaggerModule.setup('api', app, wsDocument, {
		swaggerOptions: {
			persistAuthorization: true,
			tagsSorter: 'alpha',
			operationsSorter: 'alpha',
			docExpansion: 'none',
			filter: true,
			showRequestDuration: true,
			showCommonExtensions: true,
			defaultModelsExpandDepth: 1,
			defaultModelExpandDepth: 1,
			displayRequestDuration: true,
		},
		customSiteTitle: 'LORO API Documentation',
		customCss: `
			.swagger-ui .topbar { display: none; }
			.swagger-ui .info { margin: 20px 0; }
			.swagger-ui .info .title { color: #1976d2; }
			.swagger-ui .scheme-container { background: #fafafa; padding: 15px; border-radius: 4px; }
		`,
	});

	await app.listen(process.env.PORT ?? 4400);
}
bootstrap();
