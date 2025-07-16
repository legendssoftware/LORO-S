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
		operationIdFactory: (controllerKey: string, methodKey: string) => {
			// Create unique operation IDs by combining controller and method names
			// This prevents Swagger UI from opening all routes with the same method name
			const controllerName = controllerKey.replace('Controller', '').toLowerCase();
			return `${controllerName}_${methodKey}`;
		},
	});

	// Add WebSocket documentation
	const wsDocument = {
		...document,
		components: {
			...document.components,
			schemas: {
				...document.components?.schemas,
				WebSocketQuotationEvent: {
					type: 'object',
					properties: {
						event: {
							type: 'string',
							enum: ['quotation_new', 'quotation_status_changed', 'quotation_metrics'],
							description: 'Quotation WebSocket event name',
						},
						timestamp: {
							type: 'string',
							format: 'date-time',
							description: 'Event timestamp',
						},
						data: {
							type: 'object',
							properties: {
								uid: { type: 'number', description: 'Quotation unique ID' },
								quotationNumber: { type: 'string', description: 'Quotation reference number' },
								totalAmount: { type: 'number', description: 'Total quotation amount' },
								totalItems: { type: 'number', description: 'Total number of items' },
								status: { type: 'string', description: 'Current quotation status' },
								currency: { type: 'string', description: 'Currency code' },
								client: {
									type: 'object',
									properties: {
										uid: { type: 'number' },
										name: { type: 'string' },
										email: { type: 'string' },
									},
								},
								placedBy: {
									type: 'object',
									properties: {
										uid: { type: 'number' },
										name: { type: 'string' },
										email: { type: 'string' },
									},
								},
								quotationItems: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											quantity: { type: 'number' },
											unitPrice: { type: 'number' },
											totalPrice: { type: 'number' },
											product: {
												type: 'object',
												properties: {
													uid: { type: 'number' },
													name: { type: 'string' },
													sku: { type: 'string' },
												},
											},
										},
									},
								},
							},
						},
					},
				},
				WebSocketApprovalEvent: {
					type: 'object',
					properties: {
						event: {
							type: 'string',
							enum: ['approval_created', 'approval_updated', 'approval_action', 'approval_high_priority', 'approval_metrics'],
							description: 'Approval WebSocket event name',
						},
						timestamp: {
							type: 'string',
							format: 'date-time',
							description: 'Event timestamp',
						},
						data: {
							type: 'object',
							properties: {
								approval: {
									type: 'object',
									properties: {
										uid: { type: 'number', description: 'Approval unique ID' },
										approvalReference: { type: 'string', description: 'Approval reference number' },
										title: { type: 'string', description: 'Approval title' },
										description: { type: 'string', description: 'Approval description' },
										type: { type: 'string', description: 'Approval type' },
										status: { type: 'string', description: 'Current approval status' },
										priority: { type: 'string', description: 'Approval priority level' },
										amount: { type: 'number', description: 'Approval amount' },
										currency: { type: 'string', description: 'Currency code' },
										isUrgent: { type: 'boolean', description: 'Whether approval is urgent' },
										isOverdue: { type: 'boolean', description: 'Whether approval is overdue' },
										deadline: { type: 'string', format: 'date-time', description: 'Approval deadline' },
									},
								},
								requester: {
									type: 'object',
									properties: {
										uid: { type: 'number' },
										name: { type: 'string' },
										surname: { type: 'string' },
										email: { type: 'string' },
										accessLevel: { type: 'string' },
									},
								},
								approver: {
									type: 'object',
									properties: {
										uid: { type: 'number' },
										name: { type: 'string' },
										surname: { type: 'string' },
										email: { type: 'string' },
										accessLevel: { type: 'string' },
									},
								},
								action: { type: 'string', description: 'Action performed (for action events)' },
								actionBy: {
									type: 'object',
									properties: {
										uid: { type: 'number' },
										name: { type: 'string' },
										surname: { type: 'string' },
										email: { type: 'string' },
									},
								},
								fromStatus: { type: 'string', description: 'Previous status' },
								toStatus: { type: 'string', description: 'New status' },
								comments: { type: 'string', description: 'Action comments' },
								reason: { type: 'string', description: 'Action reason' },
							},
						},
					},
				},
				WebSocketAnalyticsEvent: {
					type: 'object',
					properties: {
						type: {
							type: 'string',
							enum: ['real-time-metrics', 'product-view', 'sale', 'inventory-update', 'approval-metrics'],
							description: 'Analytics event type',
						},
						data: {
							type: 'object',
							description: 'Analytics-specific data payload',
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
		paths: {
			...document.paths,
			'/websocket': {
				get: {
					tags: ['websockets'],
					summary: 'WebSocket Connection',
					description:
						`# 🔄 WebSocket Documentation

## 📡 Connection Details
- **URL**: wss://api.loro.co.za
- **Protocol**: Socket.IO v4
- **Authentication**: JWT token required

## 🔐 Authentication
WebSocket connections require JWT authentication via query parameter:
` +
						'```' +
						`
wss://api.loro.co.za?token=your_jwt_token
` +
						'```' +
						`

## 📋 Available Events

### 🔧 System Events
- **connect**: Connection established
- **disconnect**: Connection terminated  
- **error**: Error occurred
- **reconnect**: Automatic reconnection

### 🛒 Quotation Events
- **quotation:new**: New quotation created
- **quotation:status-changed**: Quotation status updated
- **quotation:metrics**: Quotation metrics updated

### 📋 Approval Events  
- **approval:created**: New approval request created
- **approval:updated**: Approval request updated
- **approval:action**: Approval action performed (approve/reject/etc)
- **approval:high-priority**: High priority approval alert
- **approval:metrics**: Approval metrics dashboard update

### 📊 Analytics Events
- **analytics:update**: Real-time analytics updates
- **product-view**: Product viewed in real-time
- **sale**: Sale completed
- **inventory-update**: Inventory level changed
- **approval-metrics**: Approval system metrics

### 📍 Location Events
- **locationUpdate**: Real-time GPS position updates
- **taskAssigned**: New task assignments
- **statusChange**: General entity status changes

## 🔔 Subscription Management

### Subscribe to Events
` +
						'```javascript' +
						`
// Subscribe to quotation updates
socket.emit('quotation:subscribe');

// Subscribe to approval updates  
socket.emit('approval:subscribe');

// Subscribe to user-specific approvals
socket.emit('approval:subscribe-user', { userId: 123 });

// Subscribe to organization approvals
socket.emit('approval:subscribe-org', { organisationId: 456 });
` +
						'```' +
						`

## 📖 Code Examples

### JavaScript/TypeScript Connection
` +
						'```javascript' +
						`
import { io } from "socket.io-client";

const socket = io("wss://api.loro.co.za", {
	query: { token: "your_jwt_token" },
	transports: ["websocket"],
	upgrade: true,
	rememberUpgrade: true
});

// Handle connection
socket.on("connect", () => {
	console.log("🔌 Connected to WebSocket:", socket.id);
	
	// Subscribe to events
	socket.emit('quotation:subscribe');
	socket.emit('approval:subscribe');
});

socket.on("disconnect", (reason) => {
	console.log("🔌 Disconnected:", reason);
});
` +
						'```' +
						`

### 🛒 Quotation Event Handling
` +
						'```javascript' +
						`
// New quotation created
socket.on("quotation:new", (data) => {
	console.log("🆕 New quotation:", data);
	// data.uid, data.quotationNumber, data.totalAmount, etc.
	updateQuotationDashboard(data);
});

// Quotation status changed
socket.on("quotation:status-changed", (data) => {
	console.log("🔄 Quotation status changed:", data);
	// data.status, data.quotationNumber, etc.
	updateQuotationStatus(data.uid, data.status);
});

// Real-time quotation metrics
socket.on("quotation:metrics", (data) => {
	console.log("📊 Quotation metrics:", data);
	updateMetricsDashboard(data);
});
` +
						'```' +
						`

### 📋 Approval Event Handling
` +
						'```javascript' +
						`
// New approval request
socket.on("approval:created", (data) => {
	console.log("📋 New approval:", data);
	const approval = data.data.approval;
	const requester = data.data.requester;
	
	showNotification(\`New approval request: \${approval.title}\`);
	updateApprovalsList(approval);
});

// Approval action performed
socket.on("approval:action", (data) => {
	console.log("⚡ Approval action:", data);
	const { approval, action, actionBy, fromStatus, toStatus } = data.data;
	
	showNotification(\`Approval \${approval.approvalReference} \${action} by \${actionBy.name}\`);
	updateApprovalStatus(approval.uid, toStatus);
});

// High priority approval alert
socket.on("approval:high-priority", (data) => {
	console.log("🚨 High priority approval:", data);
	const approval = data.data.approval;
	
	showUrgentNotification(\`URGENT: \${approval.title} requires immediate attention\`);
	highlightUrgentApproval(approval);
});

// Approval metrics update
socket.on("approval:metrics", (data) => {
	console.log("📊 Approval metrics:", data);
	updateApprovalDashboard(data.data);
});
` +
						'```' +
						`

### 📊 Analytics Event Handling
` +
						'```javascript' +
						`
// Real-time analytics updates
socket.on("analytics:update", (data) => {
	console.log("📊 Analytics update:", data);
	
	switch(data.type) {
		case 'real-time-metrics':
			updateRealTimeMetrics(data.data);
			break;
		case 'product-view':
			trackProductView(data.data.productId);
			break;
		case 'sale':
			processSaleUpdate(data.data);
			break;
		case 'inventory-update':
			updateInventoryDisplay(data.data);
			break;
		case 'approval-metrics':
			updateApprovalMetrics(data.data);
			break;
	}
});
` +
						'```' +
						`

### React Hook Example
` +
						'```typescript' +
						`
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export const useWebSocket = (token: string) => {
	const [socket, setSocket] = useState<Socket | null>(null);
	const [connected, setConnected] = useState(false);
	
	useEffect(() => {
		const socketInstance = io("wss://api.loro.co.za", {
			query: { token },
			transports: ["websocket"]
		});
		
		socketInstance.on("connect", () => {
			setConnected(true);
			socketInstance.emit('quotation:subscribe');
			socketInstance.emit('approval:subscribe');
		});
		
		socketInstance.on("disconnect", () => {
			setConnected(false);
		});
		
		setSocket(socketInstance);
		
		return () => {
			socketInstance.disconnect();
		};
	}, [token]);
	
	return { socket, connected };
};

// Usage in component
const Dashboard = () => {
	const { socket, connected } = useWebSocket(userToken);
	
	useEffect(() => {
		if (!socket) return;
		
		socket.on("approval:created", handleNewApproval);
		socket.on("quotation:new", handleNewQuotation);
		
		return () => {
			socket.off("approval:created", handleNewApproval);
			socket.off("quotation:new", handleNewQuotation);
		};
	}, [socket]);
	
	// Component JSX...
};
` +
						'```' +
						`

## 📈 Event Data Examples

### Quotation Event Data
` +
						'```json' +
						`
{
  "event": "quotation_new",
  "timestamp": "2023-12-01T10:00:00Z",
  "data": {
    "uid": 123,
    "quotationNumber": "QUO-1701423600000",
    "totalAmount": 15750.00,
    "totalItems": 25,
    "status": "PENDING_CLIENT",
    "currency": "ZAR",
    "client": {
      "uid": 456,
      "name": "ABC Company",
      "email": "contact@abc.com"
    },
    "placedBy": {
      "uid": 789,
      "name": "John Smith",
      "email": "john@loro.co.za"
    },
    "quotationItems": [
      {
        "quantity": 10,
        "unitPrice": 1575.00,
        "totalPrice": 15750.00,
        "product": {
          "uid": 101,
          "name": "Premium Widget",
          "sku": "PWD-001"
        }
      }
    ]
  }
}
` +
						'```' +
						`

### Approval Event Data
` +
						'```json' +
						`
{
  "event": "approval_action",
  "timestamp": "2023-12-01T10:00:00Z",
  "data": {
    "approval": {
      "uid": 789,
      "approvalReference": "APR-1701423600000",
      "title": "Equipment Purchase Request",
      "description": "Request for new laptop equipment",
      "type": "EXPENSE_CLAIM",
      "status": "APPROVED",
      "priority": "MEDIUM",
      "amount": 25000.00,
      "currency": "ZAR",
      "isUrgent": false,
      "isOverdue": false,
      "deadline": "2023-12-05T17:00:00Z"
    },
    "requester": {
      "uid": 123,
      "name": "Jane",
      "surname": "Doe",
      "email": "jane@company.com",
      "accessLevel": "USER"
    },
    "approver": {
      "uid": 456,
      "name": "Mike",
      "surname": "Manager",
      "email": "mike@company.com",
      "accessLevel": "MANAGER"
    },
    "action": "APPROVE",
    "actionBy": {
      "uid": 456,
      "name": "Mike",
      "surname": "Manager",
      "email": "mike@company.com"
    },
    "fromStatus": "PENDING",
    "toStatus": "APPROVED",
    "comments": "Approved for Q4 budget allocation"
  }
}
` +
						'```' +
						`

## 🚨 Error Handling
` +
						'```javascript' +
						`
socket.on("error", (error) => {
	console.error("🚨 WebSocket error:", error);
	// Handle connection errors
});

socket.on("connect_error", (error) => {
	console.error("🚨 Connection error:", error);
	// Handle authentication or network errors
});

// Implement reconnection logic
socket.on("disconnect", (reason) => {
	if (reason === "io server disconnect") {
		// Server initiated disconnect, try to reconnect
		socket.connect();
	}
});
` +
						'```',
					responses: {
						'101': {
							description: 'WebSocket connection established',
							content: {
								'application/json': {
									schema: {
										oneOf: [
											{ $ref: '#/components/schemas/WebSocketQuotationEvent' },
											{ $ref: '#/components/schemas/WebSocketApprovalEvent' },
											{ $ref: '#/components/schemas/WebSocketAnalyticsEvent' }
										]
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
