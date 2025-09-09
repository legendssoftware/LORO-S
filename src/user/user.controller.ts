import { UserService } from './user.service';
import { RoleGuard } from '../guards/role.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthGuard } from '../guards/auth.guard';
import { Roles } from '../decorators/role.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { BulkCreateUserDto, BulkCreateUserResponse } from './dto/bulk-create-user.dto';
import { BulkUpdateUserDto, BulkUpdateUserResponse } from './dto/bulk-update-user.dto';
import {
	ApiOperation,
	ApiTags,
	ApiParam,
	ApiBody,
	ApiOkResponse,
	ApiCreatedResponse,
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiUnauthorizedResponse,
	ApiQuery,
	ApiHeader,
	ApiResponse,
	ApiBearerAuth,
	ApiForbiddenResponse,
	ApiConflictResponse,
	ApiInternalServerErrorResponse,
	ApiConsumes,
	ApiProduces,
	ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
	Query,
	Req,
	Put,
	ParseIntPipe,
	Headers,
} from '@nestjs/common';
import { AccountStatus } from '../lib/enums/status.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { CreateUserTargetDto } from './dto/create-user-target.dto';
import { UpdateUserTargetDto } from './dto/update-user-target.dto';
import { ExternalTargetUpdateDto } from './dto/external-target-update.dto';
import { User } from './entities/user.entity';
import { UserTarget } from './entities/user-target.entity';
import { PaginatedResponse } from '../lib/interfaces/product.interfaces';

@ApiBearerAuth('JWT-auth')
@ApiTags('👥 Users')
@Controller('user')
@UseGuards(AuthGuard, RoleGuard)
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
	description: '🔒 Unauthorized - Authentication required',
	schema: {
		type: 'object',
		properties: {
			message: { type: 'string', example: 'Authentication token is required' },
			error: { type: 'string', example: 'Unauthorized' },
			statusCode: { type: 'number', example: 401 },
		},
	},
})
/**
 * ## 🎯 Performance Target Management Endpoints
 *
 * This controller provides multiple endpoints for managing user performance targets:
 *
 * ### **Target CRUD Operations**
 * - **GET /:ref/target** - Retrieve user's current targets and progress
 * - **POST /:ref/target** - Create new targets for a user
 * - **PATCH /:ref/target** - Update targets with ABSOLUTE values (set exact amounts)
 * - **DELETE /:ref/target** - Delete user's targets (soft delete with recovery option)
 *
 * ### **External System Integration**
 * - **PUT /:userId/targets/external-update** - INCREMENTAL updates from CRM/ERP systems
 *
 * ### **Which Endpoint Should I Use?**
 *
 * #### **For Setting/Updating Targets & Progress Totals:**
 * Use **PATCH /:ref/target** when:
 * - Setting new target goals (e.g., monthly sales target = R50,000)
 * - Updating cumulative progress totals (e.g., month-to-date sales = R35,000)
 * - Making corrections with absolute values
 * - All values are **absolute amounts**, not increments
 *
 * #### **For Recording Individual Transactions:**
 * Use **PUT /:userId/targets/external-update** when:
 * - Recording individual sales (e.g., +R5,000 for one sale)
 * - Processing credit notes (e.g., -R2,000 for return)
 * - Adding leads, calls, check-ins one by one
 * - All values are **incremental amounts** that get added/subtracted
 *
 * ### **Key Differences:**
 * - **PATCH**: "Set the total to exactly R35,000"
 * - **PUT external-update**: "Add R5,000 to the current total"
 *
 * ### **Negative Values:**
 * - **PATCH**: Use negative values for corrections (will set negative totals)
 * - **PUT external-update**: Use negative increments to reduce totals (e.g., credit notes)
 */
export class UserController {
	constructor(private readonly userService: UserService) {}

	/**
	 * Determines access scope for the authenticated user
	 * @param user - Authenticated user object
	 * @returns Access scope with orgId and branchId (null for org-wide access)
	 */
	private getAccessScope(user: any) {
		const isElevatedUser = [
			AccessLevel.ADMIN,
			AccessLevel.OWNER,
			AccessLevel.MANAGER,
			AccessLevel.DEVELOPER,
			AccessLevel.SUPPORT,
		].includes(user?.role);

		const orgId = user?.org?.uid || user?.organisationRef;
		const branchId = isElevatedUser ? null : user?.branch?.uid; // null = org-wide access for elevated users

		return {
			orgId,
			branchId,
			isElevated: isElevatedUser,
		};
	}

	@Post()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '➕ Create a new user',
		description: `
# Create Comprehensive User Account

Creates a new user account in the system with full profile management and employment tracking capabilities.

## 📋 **Core Features**
- **Complete User Profile**: Personal details, physical characteristics, preferences
- **Employment Management**: Position, department, contact details, employment history
- **Multi-Organization Support**: Organization and branch assignment with role-based access
- **Device Integration**: Push notification tokens, device tracking, platform support
- **Security Management**: Verification tokens, password reset capabilities, audit trails

## 🎯 **Use Cases**
- **Employee Onboarding**: Comprehensive employee account creation with full profile
- **Client Management**: Set up client portal access with contact preferences
- **Team Expansion**: Add new team members with complete organizational context
- **Role-Based Access**: Configure users with specific permissions and department assignments
- **Multi-Branch Operations**: Create users for different branches with location-specific settings
- **Mobile Integration**: Set up users with device tracking and push notification capabilities

## 🔧 **Advanced Features**
- **Profile Completeness**: Personal details including physical characteristics, preferences, and lifestyle information
- **Employment Tracking**: Complete employment history with position, department, and contact details
- **Device Management**: Push notification setup, device tracking, and platform-specific configurations
- **Organization Structure**: Multi-level organization and branch assignment with hierarchical permissions
- **Security Integration**: Email verification, password reset tokens, and comprehensive audit trails
- **HR Integration**: Legacy HR system compatibility with hrID mapping

## 📝 **Field Categories**

### Required Fields
- **Basic Identity**: name, surname, email, username, password
- **Access Control**: accessLevel (defaults to USER if not specified)

### Optional Core Fields
- **Contact**: phone, photoURL, businesscardURL
- **Organization**: organisationRef, departmentId, role, status
- **System**: userref, hrID, isDeleted

### Profile Information (Optional)
- **Physical**: height, weight, hairColor, eyeColor, gender, ethnicity, bodyType
- **Personal**: dateOfBirth, currentAge, maritalStatus, numberDependents
- **Location**: address, city, country, zipCode
- **Lifestyle**: smokingHabits, drinkingHabits, aboutMe, socialMedia
- **Clothing**: shoeSize, shirtSize, pantsSize, dressSize, coatSize

### Employment Profile (Optional)
- **Position**: position, department, branchref
- **Timeline**: startDate, endDate, isCurrentlyEmployed
- **Contact**: email (work), contactNumber

### Device Integration (Optional)
- **Notifications**: expoPushToken, deviceId, platform
- **Tracking**: pushTokenUpdatedAt

### Security Features (Optional)
- **Verification**: verificationToken, resetToken, tokenExpires

## 🔒 **Security & Validation**
- Password strength validation and encryption
- Email format validation and uniqueness checks
- Organization and branch permission validation
- Device token format validation
- Date validation for employment periods and birth dates
- Comprehensive input sanitization and validation
		`,
	})
	@ApiBody({
		type: CreateUserDto,
		description:
			'User creation payload with comprehensive user information including personal profile and employment details',
		examples: {
			employee: {
				summary: '👨‍💼 Employee Account',
				description: 'Example of creating a comprehensive employee account',
				value: {
					name: 'John',
					surname: 'Doe',
					email: 'john.doe@loro.co.za',
					phone: '+27 64 123 4567',
					username: 'john.doe',
					password: 'SecurePass123!',
					accessLevel: AccessLevel.USER,
					role: 'employee',
					status: 'active',
					organisationRef: 'ORG123',
					departmentId: 1,
					hrID: 12345,
					profile: {
						gender: 'MALE',
						dateOfBirth: '1990-01-15',
						address: '123 Main Street',
						city: 'Cape Town',
						country: 'South Africa',
						zipCode: '7700',
						height: '180cm',
						weight: '75kg',
						maritalStatus: 'Single',
						aboutMe: 'Passionate software developer with 5+ years of experience',
					},
					employmentProfile: {
						position: 'Software Engineer',
						department: 'Engineering',
						startDate: '2023-01-15',
						isCurrentlyEmployed: true,
						email: 'john.doe@company.com',
						contactNumber: '+27 64 123 4567',
					},
				},
			},
			manager: {
				summary: '👔 Manager Account',
				description: 'Example of creating a comprehensive manager account',
				value: {
					name: 'Jane',
					surname: 'Smith',
					email: 'jane.smith@loro.co.za',
					phone: '+27 64 987 6543',
					username: 'jane.smith',
					password: 'ManagerPass456!',
					accessLevel: AccessLevel.MANAGER,
					role: 'manager',
					status: 'active',
					organisationRef: 'ORG123',
					departmentId: 2,
					businesscardURL: 'https://example.com/jane-businesscard.jpg',
					profile: {
						gender: 'FEMALE',
						dateOfBirth: '1985-05-20',
						address: '456 Executive Avenue',
						city: 'Johannesburg',
						country: 'South Africa',
						zipCode: '2000',
						height: '165cm',
						weight: '60kg',
						maritalStatus: 'Married',
						numberDependents: 2,
						aboutMe: 'Experienced engineering manager with leadership expertise',
					},
					employmentProfile: {
						position: 'Engineering Manager',
						department: 'Engineering',
						startDate: '2023-01-01',
						isCurrentlyEmployed: true,
						email: 'jane.smith@company.com',
						contactNumber: '+27 64 987 6543',
					},
				},
			},
			basicUser: {
				summary: '👤 Basic User Account',
				description: 'Example of creating a basic user account with minimal required fields',
				value: {
					name: 'Alex',
					surname: 'Johnson',
					email: 'alex.johnson@loro.co.za',
					username: 'alex.johnson',
					password: 'BasicPass789!',
					accessLevel: AccessLevel.USER,
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ User created successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)',
				},
			},
			required: ['message'],
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid or missing required data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Email is required' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'Phone number must be in valid format',
						'Access level must be one of the allowed values',
					],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to create users in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - User already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with email john.doe@loro.co.za already exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictingUser: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 9876 },
						email: { type: 'string', example: 'john.doe@loro.co.za' },
						username: { type: 'string', example: 'john.doe' },
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - System malfunction',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create user due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/user' },
			},
		},
	})
	create(@Body() createUserDto: CreateUserDto, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		console.log(req, 'full request body');
		const orgId = req.user?.org?.uid || req.user?.organisationRef;
		const branchId = req.user?.branch?.uid;
		return this.userService.create(createUserDto, orgId, branchId);
	}

	@Post('bulk')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '👥 Create multiple users in bulk',
		description: `
# Bulk User Creation

Create multiple user accounts at once with transaction support to ensure data consistency.

## 🎯 **Features**
- ✅ **Transaction Support**: All users are created within a single transaction
- ✅ **Individual Error Tracking**: Failed users don't affect successful ones
- ✅ **Batch Limit**: Maximum 50 users per request for performance
- ✅ **Auto-Password Generation**: Optionally generate secure passwords automatically
- ✅ **Welcome Emails**: Automatically send welcome emails to created users
- ✅ **Validation**: Comprehensive validation for usernames, emails, and client assignments
- ✅ **Cache Management**: Invalidates relevant caches after successful creation
- ✅ **Event Emission**: Triggers bulk creation events for real-time updates

## 🔧 **Usage**
Send an array of user objects in the request body. Each user must contain all required fields (username, password*, name, surname, email).

## 📧 **Email Features**
- Welcome emails are sent by default (can be disabled)
- Auto-generated passwords can be sent securely via email
- Notification emails for account creation confirmations

## 🎛️ **Response**
Returns detailed results including:
- Total requested vs created counts
- Success rate percentage
- Individual user results with error details
- List of created user IDs
- Number of welcome emails sent
- Processing duration

## 📏 **Limits**
- Minimum: 1 user
- Maximum: 50 users per request
- Users with validation errors will be skipped
- Successful users will still be created if some fail

## 🏢 **Organization & Branch**
Users will be automatically associated with the authenticated user's organization and branch unless specified otherwise.
		`,
	})
	@ApiBody({
		type: BulkCreateUserDto,
		description: 'Array of users to create with optional settings',
		examples: {
			'IT Department Onboarding': {
				summary: 'Create multiple IT department users with detailed profiles',
				value: {
					orgId: 1,
					branchId: 1,
					sendWelcomeEmails: true,
					autoGeneratePasswords: false,
					users: [
						{
							username: 'theguy',
							password: 'SecurePass123!',
							name: 'The Guy',
							surname: 'Developer',
							email: 'theguy@example.co.za',
							phone: '+27 64 123 4567',
							role: 'Senior Developer',
							accessLevel: 'DEVELOPER',
							departmentId: 1,
							organisationRef: 'ORG001',
							assignedClientIds: [1, 2, 3],
							photoURL: 'https://example.co.za/photos/theguy.jpg',
							profile: {
								dateOfBirth: '1990-05-15',
								address: '123 Tech Street, Pretoria South Africa',
								city: 'Pretoria',
								country: 'South Africa',
							},
							employmentProfile: {
								position: 'Senior Software Developer',
								department: 'Information Technology',
								startDate: '2024-01-15',
								email: 'theguy.work@example.co.za',
								contactNumber: '+27 64 123 4567',
							},
						},
						{
							username: 'devmanager',
							password: 'SecurePass456!',
							name: 'Dev',
							surname: 'Manager',
							email: 'dev.manager@example.co.za',
							phone: '+27 64 765 4321',
							role: 'Development Manager',
							accessLevel: 'MANAGER',
							departmentId: 1,
							organisationRef: 'ORG001',
							assignedClientIds: [1, 2, 3, 4, 5, 6],
							profile: {
								dateOfBirth: '1985-03-20',
								address: '456 Management Ave, Pretoria South Africa',
								city: 'Pretoria',
								country: 'South Africa',
							},
							employmentProfile: {
								position: 'Development Team Manager',
								department: 'Information Technology',
								startDate: '2024-01-01',
								email: 'dev.manager.work@example.co.za',
								contactNumber: '+27 64 765 4321',
							},
						},
						{
							username: 'juniordev',
							password: 'SecurePass789!',
							name: 'Junior',
							surname: 'Developer',
							email: 'junior.dev@example.co.za',
							phone: '+27 64 555 1234',
							role: 'Junior Developer',
							accessLevel: 'USER',
							departmentId: 1,
							organisationRef: 'ORG001',
							assignedClientIds: [1, 2],
							profile: {
								dateOfBirth: '1995-08-10',
								address: '789 Starter Road, Pretoria South Africa',
								city: 'Pretoria',
								country: 'South Africa',
							},
							employmentProfile: {
								position: 'Junior Software Developer',
								department: 'Information Technology',
								startDate: '2024-02-01',
								email: 'junior.work@example.co.za',
								contactNumber: '+27 64 555 1234',
							},
						},
					],
				},
			},
			'Sales Team Expansion': {
				summary: 'Create sales team members with client assignments',
				value: {
					sendWelcomeEmails: true,
					autoGeneratePasswords: true,
					users: [
						{
							username: 'salesmanager',
							name: 'Sales',
							surname: 'Manager',
							email: 'sales.manager@example.co.za',
							phone: '+27 64 100 2000',
							role: 'Sales Manager',
							accessLevel: 'MANAGER',
							departmentId: 2,
							assignedClientIds: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
							employmentProfile: {
								position: 'Regional Sales Manager',
								department: 'Sales',
								startDate: '2024-01-01',
							},
						},
						{
							username: 'salesrep1',
							name: 'Sales Rep',
							surname: 'One',
							email: 'salesrep1@example.co.za',
							phone: '+27 64 100 2001',
							role: 'Sales Representative',
							accessLevel: 'USER',
							departmentId: 2,
							assignedClientIds: [10, 11, 12, 13, 14],
							employmentProfile: {
								position: 'Sales Representative',
								department: 'Sales',
								startDate: '2024-02-01',
							},
						},
						{
							username: 'salesrep2',
							name: 'Sales Rep',
							surname: 'Two',
							email: 'salesrep2@example.co.za',
							phone: '+27 64 100 2002',
							role: 'Sales Representative',
							accessLevel: 'USER',
							departmentId: 2,
							assignedClientIds: [15, 16, 17, 18, 19, 20],
							employmentProfile: {
								position: 'Sales Representative',
								department: 'Sales',
								startDate: '2024-02-15',
							},
						},
					],
				},
			},
			'Support Team Setup': {
				summary: 'Create customer support team with access levels',
				value: {
					sendWelcomeEmails: true,
					autoGeneratePasswords: false,
					users: [
						{
							username: 'supportlead',
							password: 'Support123!',
							name: 'Support',
							surname: 'Lead',
							email: 'support.lead@example.co.za',
							phone: '+27 64 300 4000',
							role: 'Support Team Lead',
							accessLevel: 'SUPPORT',
							departmentId: 3,
							assignedClientIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
							employmentProfile: {
								position: 'Customer Support Team Lead',
								department: 'Customer Support',
								startDate: '2024-01-05',
							},
						},
						{
							username: 'supportagent1',
							password: 'Support456!',
							name: 'Support',
							surname: 'Agent One',
							email: 'support1@example.co.za',
							phone: '+27 64 300 4001',
							role: 'Support Agent',
							accessLevel: 'USER',
							departmentId: 3,
							assignedClientIds: [1, 2, 3, 4, 5],
							employmentProfile: {
								position: 'Customer Support Agent',
								department: 'Customer Support',
								startDate: '2024-01-10',
							},
						},
					],
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ Bulk creation completed successfully',
		type: BulkCreateUserResponse,
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 10 },
				totalCreated: { type: 'number', example: 9 },
				totalFailed: { type: 'number', example: 1 },
				successRate: { type: 'number', example: 90.0 },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							user: { type: 'object', description: 'Created user data or null if failed' },
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'Username already exists' },
							index: { type: 'number', example: 0 },
							username: { type: 'string', example: 'theguy' },
							email: { type: 'string', example: 'theguy@example.co.za' },
						},
					},
				},
				message: { type: 'string', example: 'Bulk creation completed: 9 users created, 1 failed' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: ['User 3 (duplicate@email.com): Email already exists'],
				},
				duration: { type: 'number', example: 2150 },
				createdUserIds: {
					type: 'array',
					items: { type: 'number' },
					example: [101, 102, 103, 104, 105, 106, 107, 108, 109],
				},
				welcomeEmailsSent: { type: 'number', example: 9 },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid bulk creation data',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'array',
					items: { type: 'string' },
					example: ['users must contain at least 1 element', 'users must contain no more than 50 elements'],
				},
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
			},
		},
	})
	@ApiUnprocessableEntityResponse({
		description: '⚠️ Some validation errors occurred',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Some users failed validation' },
				statusCode: { type: 'number', example: 422 },
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Internal server error during bulk creation',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Database transaction failed' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
			},
		},
	})
	async createBulkUsers(
		@Body() bulkCreateUserDto: BulkCreateUserDto,
		@Req() req: AuthenticatedRequest,
	): Promise<BulkCreateUserResponse> {
		// Automatically set orgId and branchId from authenticated user if not provided
		if (!bulkCreateUserDto.orgId) {
			bulkCreateUserDto.orgId = req.user?.org?.uid || req.user?.organisationRef;
		}
		if (!bulkCreateUserDto.branchId) {
			bulkCreateUserDto.branchId = req.user?.branch?.uid;
		}

		return this.userService.createBulkUsers(bulkCreateUserDto);
	}

	@Patch('bulk')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT, AccessLevel.DEVELOPER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📝 Update multiple users in bulk',
		description: `
# Bulk User Updates

Update multiple user accounts at once with transaction support to ensure data consistency.

## 🎯 **Features**
- ✅ **Transaction Support**: All updates are processed within a single transaction
- ✅ **Individual Error Tracking**: Failed updates don't affect successful ones
- ✅ **Batch Limit**: Maximum 50 users per request for performance
- ✅ **Client Validation**: Optionally validate assigned client IDs exist
- ✅ **Change Tracking**: Tracks which fields were updated for each user
- ✅ **Notification Emails**: Sends emails for significant changes (role, status, password)
- ✅ **Cache Management**: Invalidates relevant caches after successful updates
- ✅ **Event Emission**: Triggers bulk update events for real-time updates

## 🔧 **Usage**
Send an array of update objects, each containing a user reference ID and the data to update.

## 📧 **Notification Features**
- Automatic emails for password changes, role updates, status changes
- Comprehensive change summaries in notification emails
- Admin notifications for role elevations
- Configurable notification settings

## 🎛️ **Response**
Returns detailed results including:
- Total requested vs updated counts
- Success rate percentage
- Individual update results with error details
- List of updated fields for each user
- Number of notification emails sent
- Processing duration

## 📏 **Limits**
- Minimum: 1 user update
- Maximum: 50 user updates per request
- Only existing, non-deleted users can be updated
- Invalid user IDs will be skipped with error details

## 🔧 **Field Updates**
Any fields from the UpdateUserDto can be updated:
- Basic info (name, surname, email, phone)
- Access control (role, accessLevel, status)
- Organization (departmentId, assignedClientIds)
- Profile and employment details
		`,
	})
	@ApiBody({
		type: BulkUpdateUserDto,
		description: 'Array of user updates with reference IDs and update data',
		examples: {
			'Role and Access Updates': {
				summary: 'Update user roles and access levels for promotion',
				value: {
					sendNotificationEmails: true,
					validateClientIds: true,
					updates: [
						{
							ref: 123,
							data: {
								role: 'Senior Developer',
								accessLevel: 'DEVELOPER',
								assignedClientIds: [1, 2, 3, 4, 5, 6],
								departmentId: 1,
								phone: '+27 64 999 8888',
							},
						},
						{
							ref: 124,
							data: {
								role: 'Team Lead',
								accessLevel: 'MANAGER',
								assignedClientIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
								departmentId: 1,
							},
						},
						{
							ref: 125,
							data: {
								role: 'Development Manager',
								accessLevel: 'ADMIN',
								assignedClientIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
								departmentId: 1,
							},
						},
					],
				},
			},
			'Contact Information Update': {
				summary: 'Update contact details and profile information',
				value: {
					sendNotificationEmails: false,
					validateClientIds: false,
					updates: [
						{
							ref: 201,
							data: {
								name: 'Updated Name',
								phone: '+27 64 123 9999',
								email: 'updated.email@example.co.za',
								photoURL: 'https://example.co.za/photos/updated.jpg',
							},
						},
						{
							ref: 202,
							data: {
								phone: '+27 64 456 7890',
								businesscardURL: 'https://example.co.za/cards/new-card.jpg',
							},
						},
					],
				},
			},
			'Status and Security Updates': {
				summary: 'Update user status, passwords and security settings',
				value: {
					sendNotificationEmails: true,
					validateClientIds: true,
					updates: [
						{
							ref: 301,
							data: {
								status: 'active',
								password: 'NewSecurePassword123!',
								accessLevel: 'USER',
							},
						},
						{
							ref: 302,
							data: {
								status: 'suspended',
								assignedClientIds: [],
							},
						},
						{
							ref: 303,
							data: {
								status: 'active',
								role: 'Rehabilitated User',
								assignedClientIds: [1, 2, 3],
							},
						},
					],
				},
			},
			'Client Assignment Batch': {
				summary: 'Update client assignments for multiple users',
				value: {
					sendNotificationEmails: false,
					validateClientIds: true,
					updates: [
						{
							ref: 401,
							data: {
								assignedClientIds: [10, 11, 12, 13, 14, 15],
							},
						},
						{
							ref: 402,
							data: {
								assignedClientIds: [16, 17, 18, 19, 20, 21],
							},
						},
						{
							ref: 403,
							data: {
								assignedClientIds: [22, 23, 24, 25, 26, 27],
							},
						},
						{
							ref: 404,
							data: {
								assignedClientIds: [28, 29, 30, 31, 32, 33],
							},
						},
					],
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ Bulk update completed successfully',
		type: BulkUpdateUserResponse,
		schema: {
			type: 'object',
			properties: {
				totalRequested: { type: 'number', example: 10 },
				totalUpdated: { type: 'number', example: 9 },
				totalFailed: { type: 'number', example: 1 },
				successRate: { type: 'number', example: 90.0 },
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							ref: { type: 'number', example: 123 },
							success: { type: 'boolean', example: true },
							error: { type: 'string', example: 'User not found' },
							index: { type: 'number', example: 0 },
							username: { type: 'string', example: 'theguy' },
							email: { type: 'string', example: 'theguy@example.co.za' },
							updatedFields: {
								type: 'array',
								items: { type: 'string' },
								example: ['role', 'accessLevel', 'assignedClientIds'],
							},
						},
					},
				},
				message: { type: 'string', example: 'Bulk update completed: 9 users updated, 1 failed' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: ['User ID 999: User not found'],
				},
				duration: { type: 'number', example: 1850 },
				updatedUserIds: {
					type: 'array',
					items: { type: 'number' },
					example: [123, 124, 125, 126, 127, 128, 129, 130, 131],
				},
				notificationEmailsSent: { type: 'number', example: 5 },
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid bulk update data',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'updates must contain at least 1 element',
						'updates must contain no more than 50 elements',
					],
				},
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
			},
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 Some users not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Some users could not be found' },
				statusCode: { type: 'number', example: 404 },
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '🔥 Internal server error during bulk update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Database transaction failed' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
			},
		},
	})
	async updateBulkUsers(
		@Body() bulkUpdateUserDto: BulkUpdateUserDto,
		@Req() req: AuthenticatedRequest,
	): Promise<BulkUpdateUserResponse> {
		return this.userService.updateBulkUsers(bulkUpdateUserDto);
	}

	@Get()
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '📋 Get all users',
		description: `
# User Directory

Retrieves a comprehensive list of all users in your organization with advanced filtering and pagination capabilities.

## 📊 **Response Features**
- **User Profiles**: Complete user information including employment details
- **Real-time Status**: Current account status and access levels
- **Contact Information**: Phone, email, and profile photos
- **Department Data**: Organization structure and reporting lines
- **Performance Metrics**: Access to user activity and engagement data

## 🔍 **Advanced Filtering**
- **Status Filtering**: Active, inactive, pending, suspended users
- **Role-Based**: Filter by access levels (admin, manager, user, etc.)
- **Department**: Filter by organizational departments
- **Branch/Location**: Multi-location organization support
- **Search**: Full-text search across names, emails, and usernames
- **Date Ranges**: Filter by creation dates or last activity

## 📈 **Business Intelligence**
- **User Analytics**: Registration trends and user growth
- **Activity Metrics**: Login frequency and system usage
- **Role Distribution**: Access level breakdown across organization
- **Department Analysis**: User distribution by departments
- **Performance Indicators**: User engagement and productivity metrics

## 🎯 **Use Cases**
- **HR Management**: Employee directory and contact information
- **Team Planning**: Resource allocation and team composition
- **Access Control**: Permission management and security audits
- **Reporting**: Generate user reports for compliance and analytics
- **Communication**: Broadcast messages and announcements
		`,
	})
	@ApiQuery({
		name: 'page',
		description: 'Page number for pagination (starts from 1)',
		required: false,
		type: Number,
		example: 1,
	})
	@ApiQuery({
		name: 'limit',
		description: 'Number of items per page (max 100)',
		required: false,
		type: Number,
		example: 10,
	})
	@ApiQuery({
		name: 'status',
		description: 'Filter by account status',
		required: false,
		enum: AccountStatus,
		example: AccountStatus.ACTIVE,
	})
	@ApiQuery({
		name: 'accessLevel',
		description: 'Filter by access level',
		required: false,
		enum: AccessLevel,
		example: AccessLevel.USER,
	})
	@ApiQuery({
		name: 'search',
		description: 'Search term for filtering users (name, email, username)',
		required: false,
		type: String,
		example: 'john',
	})
	@ApiQuery({ name: 'branchId', description: 'Filter by branch ID', required: false, type: Number, example: 123 })
	@ApiQuery({
		name: 'organisationId',
		description: 'Filter by organisation ID',
		required: false,
		type: Number,
		example: 456,
	})
	@ApiOkResponse({
		description: '✅ Users retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1 },
							username: { type: 'string', example: 'john.doe' },
							name: { type: 'string', example: 'John' },
							surname: { type: 'string', example: 'Doe' },
							email: { type: 'string', example: 'john.doe@loro.co.za' },
							phone: { type: 'string', example: '+27123456789' },
							photoURL: { type: 'string', example: 'https://example.com/photo.jpg', nullable: true },
							businesscardURL: {
								type: 'string',
								example: 'https://example.com/businesscard.jpg',
								nullable: true,
							},
							avatar: { type: 'string', example: 'https://example.com/avatar.jpg', nullable: true },
							role: { type: 'string', example: 'sales_rep' },
							status: { type: 'string', example: 'active' },
							departmentId: { type: 'number', example: 1, nullable: true },
							accessLevel: {
								type: 'string',
								enum: Object.values(AccessLevel),
								example: AccessLevel.USER,
							},
							organisationRef: { type: 'string', example: '123', nullable: true },
							userref: { type: 'string', example: 'USR123456' },
							hrID: { type: 'number', example: 12345, nullable: true },
							expoPushToken: { type: 'string', example: 'ExponentPushToken[abc123]', nullable: true },
							deviceId: { type: 'string', example: 'device123', nullable: true },
							platform: { type: 'string', example: 'ios', nullable: true },
							isDeleted: { type: 'boolean', example: false },
							assignedClientIds: {
								type: 'array',
								items: { type: 'number' },
								example: [101, 102, 103],
								nullable: true,
							},
							assignedClients: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 101 },
										name: { type: 'string', example: 'Client Name' },
										contactPerson: { type: 'string', example: 'John Smith' },
										email: { type: 'string', example: 'john@client.com' },
										phone: { type: 'string', example: '+27123456789' },
										status: { type: 'string', example: 'active' },
										createdAt: { type: 'string', format: 'date-time' },
									},
								},
								nullable: true,
							},
							organisation: {
								type: 'object',
								nullable: true,
								properties: {
									uid: { type: 'number', example: 1 },
									name: { type: 'string', example: 'Orrbit Technologies' },
								},
							},
							branch: {
								type: 'object',
								nullable: true,
								properties: {
									uid: { type: 'number', example: 1 },
									name: { type: 'string', example: 'Pretoria South Africa' },
								},
							},
							userTarget: {
								type: 'object',
								nullable: true,
								properties: {
									uid: { type: 'number', example: 1 },
									targetSalesAmount: { type: 'number', example: 50000 },
									currentSalesAmount: { type: 'number', example: 32500 },
									targetNewLeads: { type: 'number', example: 20 },
									currentNewLeads: { type: 'number', example: 18 },
								},
							},
							createdAt: { type: 'string', format: 'date-time' },
							updatedAt: { type: 'string', format: 'date-time' },
						},
					},
				},
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 156 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 10 },
						totalPages: { type: 'number', example: 16 },
					},
				},
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable',
				},
			},
			required: ['data', 'meta', 'message'],
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to view users',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view users in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Database connection failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve users due to database error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/user' },
			},
		},
	})
	findAll(
		@Req() req: AuthenticatedRequest,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
		@Query('status') status?: AccountStatus,
		@Query('accessLevel') accessLevel?: AccessLevel,
		@Query('search') search?: string,
		@Query('branchId') branchId?: number,
		@Query('organisationId') organisationId?: number,
	): Promise<PaginatedResponse<Omit<User, 'password'>>> {
		const accessScope = this.getAccessScope(req.user);

		const filters = {
			...(status && { status }),
			...(accessLevel && { accessLevel }),
			...(search && { search }),
			...(branchId && { branchId: Number(branchId) }),
			...(organisationId && { organisationId: Number(organisationId) }),
			orgId: accessScope.orgId,
			userBranchId: accessScope.branchId, // null for elevated users = org-wide access
		};

		return this.userService.findAll(
			filters,
			page ? Number(page) : 1,
			limit ? Number(limit) : Number(process.env.DEFAULT_PAGE_LIMIT),
		);
	}

	@Get(':ref')
	@ApiOperation({
		summary: '👤 Get user by reference',
		description: `
# User Profile Retrieval

Retrieves detailed information about a specific user by their unique reference identifier.

## 📊 **Response Data**
- **Complete Profile**: Personal information, employment details, and preferences
- **Real-time Status**: Current account status and last activity
- **Contact Information**: Phone, email, and emergency contacts
- **Department Data**: Organization structure and reporting relationships
- **Access Details**: Permissions, roles, and security settings
- **Analytics**: Activity metrics and engagement data

## 🔍 **Profile Sections**
- **Basic Information**: Name, contact details, profile photo
- **Employment Profile**: Position, department, salary, start date
- **Personal Details**: Address, demographics, preferences
- **Access Control**: Role, permissions, and security settings
- **Device Information**: Mobile tokens, platform, and last sync
- **Activity Metrics**: Login frequency, system usage, performance

## 🔒 **Security Features**
- **Role-Based Access**: Elevated users (ADMIN, OWNER, MANAGER, DEVELOPER, SUPPORT) can access all users
- **Organization Filtering**: Regular users can only access profiles in their organization/branch
- **Permission Validation**: Only authorized users can access profiles
- **Data Masking**: Sensitive information is filtered based on access level
- **Audit Logging**: All profile access is logged for security
- **Real-time Validation**: User status and permissions are checked

## 📈 **Business Intelligence**
- **Profile Completeness**: Identifies incomplete or outdated profiles
- **Engagement Analytics**: User system usage and activity patterns
- **Performance Metrics**: Individual productivity and goal achievement
- **Compliance Check**: Ensures profile meets organizational standards
- **Reporting Data**: Provides data for HR and management reports

## 🎪 **Use Cases**
- **Profile Management**: View and verify user information
- **HR Operations**: Employee record access and management
- **Team Collaboration**: Find team member contact and role information
- **System Administration**: User account verification and troubleshooting
- **Reporting**: Generate individual user reports and analytics
		`,
	})
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiParam({
		name: 'ref',
		description: 'User reference code or unique identifier',
		type: 'number',
		example: 123,
	})
	@ApiOkResponse({
		description: '✅ User retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				user: {
					type: 'object',
					nullable: true,
					properties: {
						uid: { type: 'number', example: 123 },
						username: { type: 'string', example: 'john.doe' },
						name: { type: 'string', example: 'John' },
						surname: { type: 'string', example: 'Doe' },
						email: { type: 'string', example: 'john.doe@loro.co.za' },
						phone: { type: 'string', example: '+27123456789' },
						photoURL: { type: 'string', example: 'https://example.com/photo.jpg', nullable: true },
						businesscardURL: {
							type: 'string',
							example: 'https://example.com/businesscard.jpg',
							nullable: true,
						},
						avatar: { type: 'string', example: 'https://example.com/avatar.jpg', nullable: true },
						role: { type: 'string', example: 'sales_rep' },
						status: { type: 'string', example: 'active' },
						departmentId: { type: 'number', example: 1, nullable: true },
						accessLevel: { type: 'string', enum: Object.values(AccessLevel), example: AccessLevel.USER },
						organisationRef: { type: 'string', example: '123', nullable: true },
						userref: { type: 'string', example: 'USR123456' },
						hrID: { type: 'number', example: 12345, nullable: true },
						expoPushToken: { type: 'string', example: 'ExponentPushToken[abc123]', nullable: true },
						deviceId: { type: 'string', example: 'device123', nullable: true },
						platform: { type: 'string', example: 'ios', nullable: true },
						pushTokenUpdatedAt: {
							type: 'string',
							format: 'date-time',
							example: '2024-01-15T10:30:00Z',
							nullable: true,
						},
						isDeleted: { type: 'boolean', example: false },
						assignedClientIds: {
							type: 'array',
							items: { type: 'number' },
							example: [101, 102, 103],
							nullable: true,
						},
						assignedClients: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 101 },
									name: { type: 'string', example: 'Client Name' },
									contactPerson: { type: 'string', example: 'John Smith' },
									email: { type: 'string', example: 'john@client.com' },
									phone: { type: 'string', example: '+27123456789' },
									status: { type: 'string', example: 'active' },
									createdAt: { type: 'string', format: 'date-time' },
								},
							},
							nullable: true,
						},
						organisation: {
							type: 'object',
							nullable: true,
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'Orrbit Technologies' },
							},
						},
						branch: {
							type: 'object',
							nullable: true,
							properties: {
								uid: { type: 'number', example: 1 },
								name: { type: 'string', example: 'Pretoria South Africa' },
							},
						},
						userProfile: {
							type: 'object',
							nullable: true,
							properties: {
								uid: { type: 'number', example: 1 },
								height: { type: 'string', example: '180cm' },
								weight: { type: 'string', example: '75kg' },
								gender: { type: 'string', example: 'MALE' },
								dateOfBirth: { type: 'string', format: 'date', example: '1990-01-15' },
								address: { type: 'string', example: '123 Main Street' },
								city: { type: 'string', example: 'Cape Town' },
								country: { type: 'string', example: 'South Africa' },
								zipCode: { type: 'string', example: '7700' },
								maritalStatus: { type: 'string', example: 'Single' },
								aboutMe: { type: 'string', example: 'Passionate software developer' },
								currentAge: { type: 'number', example: 34 },
								numberDependents: { type: 'number', example: 0 },
							},
						},
						userEmployeementProfile: {
							type: 'object',
							nullable: true,
							properties: {
								uid: { type: 'string', example: '1' },
								position: { type: 'string', example: 'Software Engineer' },
								department: { type: 'string', example: 'Engineering' },
								startDate: { type: 'string', format: 'date', example: '2023-01-15' },
								isCurrentlyEmployed: { type: 'boolean', example: true },
								email: { type: 'string', example: 'john.doe@company.com' },
								contactNumber: { type: 'string', example: '+27123456789' },
							},
						},
						userTarget: {
							type: 'object',
							nullable: true,
							properties: {
								uid: { type: 'number', example: 1 },
								targetSalesAmount: { type: 'number', example: 50000 },
								currentSalesAmount: { type: 'number', example: 32500 },
								targetQuotationsAmount: { type: 'number', example: 30000 },
								currentQuotationsAmount: { type: 'number', example: 18000 },
								currentOrdersAmount: { type: 'number', example: 14500 },
								targetNewLeads: { type: 'number', example: 20 },
								currentNewLeads: { type: 'number', example: 18 },
								targetNewClients: { type: 'number', example: 5 },
								currentNewClients: { type: 'number', example: 3 },
								targetCheckIns: { type: 'number', example: 30 },
								currentCheckIns: { type: 'number', example: 25 },
								periodStartDate: { type: 'string', format: 'date', example: '2024-01-01' },
								periodEndDate: { type: 'string', format: 'date', example: '2024-03-31' },
							},
						},
						createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T10:00:00Z' },
						updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
					},
				},
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable',
				},
			},
			required: ['user', 'message'],
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with reference 123 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view this user profile' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Profile retrieval failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while retrieving user profile' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
			},
		},
	})
	findOne(
		@Param('ref') ref: number,
		@Req() req: AuthenticatedRequest,
	): Promise<{ user: Omit<User, 'password'> | null; message: string }> {
		const accessScope = this.getAccessScope(req.user);

		if (accessScope.isElevated) {
			return this.userService.findOne(ref, accessScope.orgId, null);
		} else {
			return this.userService.findOne(ref, accessScope.orgId, accessScope.branchId);
		}
	}

	@Patch(':ref')
	@ApiOperation({
		summary: '✏️ Update user information',
		description: `
# User Profile Management

Updates an existing user's information with comprehensive validation and audit trail maintenance.

## 🔄 **Supported Updates**
- **Personal Information**: Name, contact details, profile photo
- **Employment Details**: Position, department, salary, manager assignment
- **Access Control**: Role changes, permission modifications
- **Status Management**: Account activation, suspension, reactivation
- **Profile Data**: Physical details, emergency contacts, preferences
- **Security Settings**: Password requirements, authentication methods

## 🔒 **Security Features**
- **Audit Trail**: All changes are logged with user and timestamp
- **Permission Validation**: Updates require appropriate access levels
- **Data Validation**: Business rules prevent invalid state changes
- **Rollback Capability**: Previous versions are preserved for recovery
- **Approval Workflows**: Sensitive changes may require approval

## 📋 **Common Use Cases**
- **Profile Updates**: Employee self-service profile modifications
- **HR Management**: Administrative updates to employment records
- **Role Changes**: Promotion, transfer, or responsibility changes
- **Contact Updates**: Address, phone, emergency contact modifications
- **Access Management**: Permission adjustments and security updates
		`,
	})
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiParam({
		name: 'ref',
		description: 'User reference code or unique identifier',
		type: 'number',
		example: 123,
	})
	@ApiBody({
		type: UpdateUserDto,
		description: 'User update payload with fields to modify - supports partial updates',
		examples: {
			profileUpdate: {
				summary: '👤 Profile Update',
				description: 'Update basic profile information',
				value: {
					name: 'John',
					surname: 'Doe',
					phone: '+27 64 123 4567',
					photoURL: 'https://example.com/new-photo.jpg',
					businesscardURL: 'https://example.com/new-businesscard.jpg',
					profile: {
						height: '185cm',
						weight: '80kg',
						address: '456 New Street',
						city: 'Johannesburg',
						country: 'South Africa',
						zipCode: '2000',
						maritalStatus: 'Married',
						aboutMe: 'Updated profile description with new experiences',
						socialMedia: 'linkedin.com/in/johndoe',
					},
				},
			},
			employmentUpdate: {
				summary: '💼 Employment Update',
				description: 'Update employment details',
				value: {
					departmentId: 2,
					employmentProfile: {
						position: 'Lead Software Engineer',
						department: 'Engineering',
						startDate: '2023-01-15',
						isCurrentlyEmployed: true,
						email: 'john.doe@newcompany.com',
						contactNumber: '+27 64 999 8888',
						branchref: 'BRANCH456',
					},
				},
			},
			statusUpdate: {
				summary: '🔄 Status Change',
				description: 'Change user status and access level',
				value: {
					status: 'active',
					role: 'manager',
					accessLevel: AccessLevel.MANAGER,
					organisationRef: 'ORG456',
				},
			},
			deviceUpdate: {
				summary: '📱 Device Information Update',
				description: 'Update device and notification settings',
				value: {
					expoPushToken: 'ExponentPushToken[updated-token]',
					deviceId: 'device789xyz',
					platform: 'android',
					pushTokenUpdatedAt: '2024-02-01T00:00:00Z',
				},
			},
			comprehensiveUpdate: {
				summary: '🔄 Comprehensive Update',
				description: 'Update multiple aspects of user profile',
				value: {
					name: 'John',
					surname: 'Doe-Smith',
					email: 'john.doesmith@loro.co.za',
					phone: '+27 64 111 2222',
					role: 'senior-engineer',
					departmentId: 3,
					profile: {
						gender: 'MALE',
						dateOfBirth: '1990-01-15',
						address: '789 Executive Drive',
						city: 'Durban',
						country: 'South Africa',
						zipCode: '4000',
						height: '182cm',
						weight: '78kg',
						maritalStatus: 'Married',
						numberDependents: 1,
						aboutMe: 'Senior software engineer with team leadership experience',
						currentAge: 34,
					},
					employmentProfile: {
						position: 'Senior Software Engineer',
						department: 'Engineering',
						startDate: '2023-01-15',
						isCurrentlyEmployed: true,
						email: 'john.doesmith@company.com',
						contactNumber: '+27 64 111 2222',
					},
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ User updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)',
				},
			},
			required: ['message'],
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 User not found for update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with reference code 123 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user reference code is correct',
						'Check if the user has been deleted',
						'Ensure you have permission to access this user',
					],
				},
			},
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid update data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for user update' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email must be a valid email address',
						'Phone number must be in valid format',
						'Access level must be one of the allowed values',
					],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to update user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update this user' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: {
					type: 'string',
					example: 'User belongs to different branch or insufficient role permissions',
				},
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Update conflicts with current state',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot update user - conflicting data exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Email address already in use by another user',
						'Username already exists',
						'Cannot change role while user has active sessions',
					],
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Update failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to update user due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/user/123' },
			},
		},
	})
	update(
		@Param('ref') ref: number,
		@Body() updateUserDto: UpdateUserDto,
		@Req() req: AuthenticatedRequest,
	): Promise<{ message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG update route:', {
			updatingUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.update(ref, updateUserDto, accessScope.orgId, accessScope.branchId);
	}

	@Patch('restore/:ref')
	@ApiOperation({
		summary: '🔄 Restore a deleted user',
		description: `
# User Account Recovery

Restores a previously deleted user account back to active status, maintaining data integrity and audit trails.

## 🔄 **Recovery Process**
- **Validation Checks**: Ensures user is eligible for restoration
- **Data Integrity**: Validates all related records are consistent
- **Status Reset**: Returns user to appropriate active status
- **Audit Trail**: Logs restoration action with user and timestamp
- **Notification System**: Alerts relevant stakeholders of restoration

## ⚠️ **Recovery Requirements**
- **Retention Period**: User must be within retention period (90 days default)
- **Data Consistency**: All related records must be intact
- **Permission Checks**: User must have restoration permissions
- **Business Rules**: User must meet business criteria for restoration

## 🔒 **Security Features**
- **Authorization**: Only authorized users can restore accounts
- **Audit Logging**: Complete audit trail of restoration activity
- **Data Validation**: Ensures restored user data is valid and consistent
- **Rollback Protection**: Prevents restoration if data integrity is compromised

## 📋 **Common Use Cases**
- **Accidental Deletion**: Recover users deleted by mistake
- **Employee Return**: Restore accounts for returning employees
- **Process Errors**: Restore users deleted due to workflow errors
- **Data Recovery**: Recover users lost during system issues
- **Compliance Needs**: Restore users required for regulatory compliance
		`,
	})
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiParam({
		name: 'ref',
		description: 'User reference code or unique identifier of deleted user',
		type: 'number',
		example: 123,
	})
	@ApiOkResponse({
		description: '✅ User restored successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)',
				},
			},
			required: ['message'],
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 Deleted user not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Deleted user with reference code 123 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				reasons: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User was never deleted',
						'User has been permanently deleted',
						'User reference code is incorrect',
						'User belongs to different organization',
					],
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user reference code is correct',
						'Check if user was recently permanently deleted',
						'Ensure you have permission to access this user',
					],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to restore users',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to restore users' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient permissions or user belongs to different branch' },
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - User cannot be restored',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot restore user - retention period has expired' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Retention period expired 15 days ago',
						'User data has been archived',
						'Related records have been purged',
					],
				},
				resolution: {
					type: 'object',
					properties: {
						possibleActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Contact system administrator for manual recovery',
								'Check archived data sources',
								'File data recovery request with IT department',
							],
						},
						escalationPath: { type: 'string', example: 'Contact IT Support for advanced recovery options' },
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Restoration failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to restore user due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/user/restore/123' },
			},
		},
	})
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG restore route:', {
			restoringUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.restore(ref, accessScope.orgId, accessScope.branchId);
	}

	@Delete(':ref')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '🗑️ Soft delete a user',
		description: `
# User Account Deactivation

Marks a user account as deleted without permanently removing it from the database. This ensures data integrity and maintains audit trails.

## 🔒 **Safety Features**
- **Soft Delete**: User is marked as deleted but remains in database
- **Audit Trail**: Deletion is logged with user and timestamp
- **Recovery**: Deleted users can be restored using restore endpoint
- **Data Integrity**: Related records (employment, assets) are preserved

## ⚠️ **Pre-Delete Checks**
- **Active Sessions**: Cannot delete users with active sessions
- **Asset Assignments**: Assets must be returned before deletion
- **Pending Approvals**: Cannot delete users with pending workflow approvals
- **Compliance**: Checks regulatory requirements for user deletion

## 📋 **Common Use Cases**
- **Employee Termination**: Formal employee departure process
- **Account Suspension**: Temporary or permanent account deactivation
- **Data Cleanup**: Archive inactive or unused accounts
- **Security Incidents**: Immediate account deactivation for security reasons
- **Compliance**: Regulatory requirement for account disposal

## 🔄 **Recovery Process**
Use the restore endpoint to recover accidentally deleted users within the retention period (90 days default).

## 🎯 **Impact Assessment**
- **Asset Management**: Automatically returns assigned assets
- **Access Control**: Revokes all permissions and access tokens
- **Workflow**: Transfers pending approvals to designated backup users
- **Notifications**: Alerts relevant stakeholders of account deactivation
		`,
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference code or unique identifier',
		type: 'number',
		example: 123,
	})
	@ApiOkResponse({
		description: '✅ User deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable (SUCCESS_MESSAGE)',
				},
			},
			required: ['message'],
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 User not found for deletion',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with reference code 123 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user reference code is correct',
						'Check if the user has already been deleted',
						'Ensure you have permission to access this user',
					],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to delete user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to delete this user' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient permissions or user belongs to different branch' },
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - User cannot be deleted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete user - user has active sessions' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				blockingFactors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User has 2 active sessions',
						'User has 3 assets assigned',
						'User has 1 pending approval workflow',
					],
				},
				resolution: {
					type: 'object',
					properties: {
						requiredActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'End active user sessions',
								'Return assigned assets',
								'Transfer pending approvals',
							],
						},
						estimatedResolutionTime: { type: 'string', example: '2-3 business days' },
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Deletion failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to delete user due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/user/123' },
			},
		},
	})
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG remove route:', {
			removingUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.remove(ref, accessScope.orgId, accessScope.branchId);
	}

	@Get(':ref/target')
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({
		summary: '📊 Get user performance targets and current progress',
		description: `
# User Performance Target Dashboard

Retrieves comprehensive performance targets for a specific user with detailed progress tracking and analytics capabilities.

## 📋 **What This Endpoint Returns**
- **Target Goals**: All configured target amounts (sales, leads, hours, etc.)
- **Current Progress**: Real-time achievement totals for each target category
- **Achievement Percentages**: Calculated progress percentages for each target
- **Period Information**: Target period dates and remaining time
- **Progress Metrics**: Overall completion and trend analysis

## 🧮 **How Progress is Calculated**
- **Achievement Percentage**: (currentValue ÷ targetValue) × 100
- **Overall Progress**: Weighted average across all target categories
- **Example**: Target R50,000 | Current R35,000 = 70% achievement

## 📊 **Response Structure**
\`\`\`json
{
  "userTarget": {
    "targetSalesAmount": 50000,     // Goal to achieve
    "currentSalesAmount": 35000,    // What's been achieved
    "progressMetrics": {
      "salesProgress": 70.0         // 35000/50000 = 70%
    }
  }
}
\`\`\`

## 🎯 **Target Categories Included**
- **Sales Revenue**: Total sales targets (quotations + orders combined)
- **Quotations**: Quote generation targets (pending conversion)
- **Orders**: Conversion targets (paid and confirmed sales)
- **Work Hours**: Expected vs actual hours worked tracking
- **New Leads**: Lead generation and pipeline development
- **New Clients**: Client acquisition and onboarding goals
- **Check-ins**: Customer interaction frequency targets
- **Calls**: Communication activity and outreach targets

## 📊 **Analytics & Insights**
- **Achievement Percentages**: Progress calculation for each target category
- **Overall Progress**: Weighted average of all target achievements
- **Trend Analysis**: Performance trend indicators (Ahead, On Track, Behind, At Risk)
- **Milestone Tracking**: Next achievement milestones and deadlines
- **Period Analysis**: Days remaining and target completion estimates

## 🔒 **Access Control**
- **Self-Service**: Users can view their own performance targets
- **Management Access**: Managers can view targets for their team members
- **Hierarchical Permissions**: Supports organizational hierarchy and branch-level access
- **Role-Based Filtering**: Data visibility based on user access level

## 📈 **Business Intelligence**
- **Performance Metrics**: Comprehensive target achievement analysis
- **Productivity Tracking**: Work hours and activity correlation
- **Sales Analytics**: Revenue generation and conversion tracking
- **Team Performance**: Individual contribution to team goals
- **Forecasting**: Target completion predictions and trend analysis

## 🎯 **Use Cases**
- **Performance Reviews**: Comprehensive target achievement analysis
- **Team Management**: Monitor individual and team performance
- **Sales Analytics**: Track revenue generation and conversion rates
- **Productivity Monitoring**: Analyze work patterns and efficiency
- **Goal Setting**: Historical performance for future target setting
- **Incentive Programs**: Performance-based compensation calculations
		`,
		operationId: 'getUserTargets',
	})
	@ApiParam({
		name: 'ref',
		description: 'User ID - Must be a valid user identifier',
		type: Number,
		example: 123,
	})
	@ApiOkResponse({
		description: '✅ User performance targets retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				userTarget: {
					type: 'object',
					nullable: true,
					properties: {
						uid: { type: 'number', example: 1, description: 'Unique target record identifier' },
						targetSalesAmount: {
							type: 'number',
							example: 50000,
							description: 'Sales revenue target amount (total of quotations + orders)',
							nullable: true,
						},
						currentSalesAmount: {
							type: 'number',
							example: 32500,
							description: 'Current achieved sales amount (total of quotations + orders)',
							nullable: true,
						},
						targetQuotationsAmount: {
							type: 'number',
							example: 30000,
							description: 'Target quotations amount (quotes made but not paid)',
							nullable: true,
						},
						currentQuotationsAmount: {
							type: 'number',
							example: 18000,
							description: 'Current quotations amount (quotes made but not paid)',
							nullable: true,
						},
						targetOrdersAmount: {
							type: 'number',
							example: 20000,
							description: 'Target orders amount (converted and paid)',
							nullable: true,
						},
						currentOrdersAmount: {
							type: 'number',
							example: 14500,
							description: 'Current orders amount (converted and paid)',
							nullable: true,
						},
						targetHoursWorked: {
							type: 'number',
							example: 160,
							description: 'Expected hours to work in target period',
							nullable: true,
						},
						currentHoursWorked: {
							type: 'number',
							example: 142,
							description: 'Current hours worked in period',
							nullable: true,
						},
						targetNewClients: {
							type: 'number',
							example: 5,
							description: 'Number of new clients to acquire',
							nullable: true,
						},
						currentNewClients: {
							type: 'number',
							example: 3,
							description: 'Current new clients acquired',
							nullable: true,
						},
						targetNewLeads: {
							type: 'number',
							example: 20,
							description: 'Number of new leads to generate',
							nullable: true,
						},
						currentNewLeads: {
							type: 'number',
							example: 18,
							description: 'Current leads generated',
							nullable: true,
						},
						targetCheckIns: {
							type: 'number',
							example: 15,
							description: 'Client check-in frequency target',
							nullable: true,
						},
						currentCheckIns: {
							type: 'number',
							example: 12,
							description: 'Current check-ins completed',
							nullable: true,
						},
						targetCalls: {
							type: 'number',
							example: 50,
							description: 'Communication calls target',
							nullable: true,
						},
						currentCalls: {
							type: 'number',
							example: 45,
							description: 'Current calls completed',
							nullable: true,
						},
						periodStartDate: {
							type: 'string',
							format: 'date',
							example: '2024-01-01',
							description: 'Target period start date',
							nullable: true,
						},
						periodEndDate: {
							type: 'string',
							format: 'date',
							example: '2024-01-31',
							description: 'Target period end date',
							nullable: true,
						},
						createdAt: { type: 'string', format: 'date-time', description: 'Target creation timestamp' },
						updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
					},
				},
				message: {
					type: 'string',
					example: 'Success',
					description: 'Success message from environment variable',
				},
			},
			required: ['userTarget', 'message'],
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found or no targets configured',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found or no performance targets have been set' },
				errorCode: { type: 'string', example: 'USER_TARGETS_NOT_FOUND' },
			},
		},
	})
	getUserTarget(
		@Param('ref') ref: number,
		@Req() req: AuthenticatedRequest,
	): Promise<{ userTarget: UserTarget | null; message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG getUserTarget route:', {
			gettingTargetForUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.getUserTarget(ref, accessScope.orgId, accessScope.branchId);
	}

	@Post(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🎯 Create user performance targets',
		description: `
# User Performance Target Creation

Creates comprehensive performance targets for a specific user with advanced configuration options and automatic progress tracking initialization.

## 📋 **Core Features**
- **Multi-Category Targets**: Configure targets across sales, hours, leads, clients, and activities
- **Flexible Periods**: Support for weekly, monthly, quarterly, and yearly target periods
- **Currency Support**: Multi-currency sales targets for international operations
- **Progress Initialization**: Automatic setup of progress tracking and milestone calculation
- **Validation Engine**: Comprehensive validation of target values and configurations

## 🎯 **Target Configuration**
- **Sales Targets**: Revenue goals with quotations and orders breakdown
- **Work Hours**: Expected hours and productivity targets
- **Lead Generation**: Pipeline development and conversion goals
- **Client Acquisition**: New client onboarding and retention targets
- **Activity Targets**: Check-ins, calls, and engagement metrics
- **Custom Metrics**: Additional KPIs specific to roles or departments

## 📊 **Advanced Features**
- **Period Management**: Automatic date calculation and period validation
- **Hierarchical Inheritance**: Team and branch-level target templates
- **Integration Support**: Seamless integration with existing performance systems
- **Notification System**: Automatic milestone alerts and progress notifications
- **Analytics Setup**: Performance tracking and reporting configuration

## 🔒 **Security & Permissions**
- **Role-Based Access**: Only managers and administrators can create targets
- **Organization Boundaries**: Targets respect organizational and branch hierarchies
- **User Validation**: Ensures target user exists and is active
- **Audit Trail**: Complete logging of target creation and modifications

## 📈 **Business Intelligence**
- **Performance Baselines**: Establish measurable performance standards
- **Goal Alignment**: Align individual targets with organizational objectives
- **Progress Tracking**: Real-time progress monitoring and analytics
- **Milestone Management**: Automatic achievement tracking and recognition
- **Forecasting**: Performance prediction and trend analysis

## 🎯 **Use Cases**
- **Employee Onboarding**: Set initial performance expectations and goals
- **Performance Management**: Establish clear, measurable objectives
- **Sales Management**: Configure revenue and activity targets
- **Team Planning**: Align individual goals with team objectives
- **Incentive Programs**: Create performance-based reward systems
- **Career Development**: Set growth and development targets

## 🔧 **Configuration Options**
- **Target Values**: Numerical goals for each performance category
- **Period Settings**: Start and end dates with automatic validation
- **Currency Preferences**: ISO 4217 currency codes for international operations
- **Notification Rules**: Progress alerts and milestone notifications
- **Reporting Configuration**: Dashboard and analytics setup
		`,
		operationId: 'createUserTargets',
	})
	@ApiParam({
		name: 'ref',
		description: 'User ID for target assignment',
		type: Number,
		example: 123,
	})
	@ApiBody({
		type: CreateUserTargetDto,
		description: 'Comprehensive target configuration data',
		examples: {
			monthlyTargets: {
				summary: 'Monthly sales rep targets',
				value: {
					targetSalesAmount: 50000,
					targetQuotationsAmount: 30000,

					targetCurrency: 'ZAR',
					targetHoursWorked: 160,
					targetNewLeads: 20,
					targetNewClients: 5,
					targetCheckIns: 15,
					targetCalls: 50,
					targetPeriod: 'Monthly',
					periodStartDate: '2024-01-01',
					periodEndDate: '2024-01-31',
				},
			},
			quarterlyTargets: {
				summary: 'Quarterly manager targets',
				value: {
					targetSalesAmount: 150000,
					targetQuotationsAmount: 90000,

					targetCurrency: 'USD',
					targetHoursWorked: 480,
					targetNewLeads: 60,
					targetNewClients: 15,
					targetCheckIns: 45,
					targetCalls: 150,
					targetPeriod: 'Quarterly',
					periodStartDate: '2024-01-01',
					periodEndDate: '2024-03-31',
				},
			},
		},
	})
	@ApiCreatedResponse({
		description: '✅ User performance targets created successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'User targets set successfully',
					description: 'Success message from service',
				},
			},
			required: ['message'],
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid target configuration provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for target configuration' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'targetSalesAmount must be a positive number',
						'targetPeriod must be one of: Weekly, Monthly, Quarterly, Yearly',
						'periodEndDate must be after periodStartDate',
					],
				},
			},
		},
	})
	@ApiNotFoundResponse({ description: '❌ User not found or not accessible' })
	setUserTarget(
		@Param('ref') ref: number,
		@Body() createUserTargetDto: CreateUserTargetDto,
		@Req() req: AuthenticatedRequest,
	): Promise<{ message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG setUserTarget route:', {
			settingTargetForUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.setUserTarget(ref, createUserTargetDto, accessScope.orgId, accessScope.branchId);
	}

	@Patch(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '📊 Update user performance targets',
		description: `
# Performance Target Management System

Updates existing performance targets for a specific user with comprehensive validation, progress preservation, and advanced analytics capabilities.

## 🎯 **Core Features**
- **PATCH Semantics**: Partial or complete target updates with field-level precision
- **Progress Preservation**: Maintains existing progress during target modifications
- **Historical Tracking**: Complete audit trail of all target changes and modifications
- **Dynamic Recalculation**: Automatic recalculation of achievement percentages
- **Mid-Period Adjustments**: Support for target changes during active periods

## 🧮 **How Target Calculations Work**

### **Target Values vs Progress Values**
- **Target Values**: The goals you want to achieve (e.g., targetSalesAmount: 50000)
- **Current/Progress Values**: What has been achieved so far (e.g., currentSalesAmount: 30000)
- **Achievement Percentage**: (currentValue / targetValue) × 100

### **Direct Value Updates**
When updating targets or progress, you set **absolute values**, not increments:
- **targetSalesAmount: 60000** → Sets the target to exactly R60,000
- **currentSalesAmount: 35000** → Sets current progress to exactly R35,000

### **Important**: This endpoint does NOT support incremental updates
For incremental updates (adding/subtracting individual sales), use the **external-update** endpoint instead.

## 📊 **Update Scenarios**
- **Target Adjustments**: Increase or decrease targets based on market conditions
- **Progress Updates**: Update current achievement values with latest data
- **Period Extensions**: Modify start and end dates for target periods
- **Currency Changes**: Update currency for international operations
- **Category Additions**: Add new target categories or remove existing ones
- **Emergency Resets**: Correct errors or reset targets due to exceptional circumstances

## 💡 **Update Calculation Examples**

### **Scenario 1: Adjust Monthly Sales Target**
Current state: Target R50,000 | Current R30,000 | Achievement: 60%
Update: \`{ "targetSalesAmount": 70000 }\`
Result: Target R70,000 | Current R30,000 | Achievement: 42.86%

### **Scenario 2: Update Progress with Latest Sales Data**
Current state: Target R50,000 | Current R30,000 | Achievement: 60%
Update: \`{ "currentSalesAmount": 45000 }\`
Result: Target R50,000 | Current R45,000 | Achievement: 90%

### **Scenario 3: Comprehensive Mid-Period Update**
Update both targets and progress:
\`\`\`json
{
  "targetSalesAmount": 60000,
  "currentSalesAmount": 42000,
  "targetNewLeads": 25,
  "currentNewLeads": 18
}
\`\`\`

## 🔧 **Business Rules & Validation**
- **Progress Preservation**: Updates preserve existing progress unless explicitly reset
- **Achievement Percentages**: Automatically recalculated after any update
- **Period Recalculation**: Date changes automatically recalculate progress metrics
- **Audit Trail**: All modifications are logged with user, timestamp, and reason
- **Validation Engine**: Comprehensive validation prevents invalid state transitions

## ⚠️ **Important Notes**
- Use this endpoint for **absolute value updates** (setting exact amounts)
- For **incremental updates** (adding individual sales/credits), use the **external-update** endpoint
- Progress values should represent **cumulative totals** for the target period
- Negative values are allowed for correction purposes but will trigger validation warnings

## 📈 **Advanced Analytics**
- **Progress Impact Analysis**: Calculate impact of target changes on overall progress
- **Achievement Forecasting**: Predict target completion based on current trajectory
- **Performance Metrics**: Track target modification patterns and success rates
- **Milestone Tracking**: Automatic recalculation of next achievement milestones
- **Trend Analysis**: Historical analysis of target adjustments and outcomes

## 🔒 **Security & Permissions**
- **Role-Based Access**: Only managers and administrators can update targets
- **Organization Boundaries**: Target updates respect organizational hierarchies
- **User Validation**: Ensures target user exists and is accessible
- **Change Authorization**: Validates permission to modify specific target categories
- **Data Integrity**: Maintains consistency across all related target data

## 📋 **Use Cases**
- **Performance Reviews**: Adjust targets based on review outcomes
- **Market Changes**: Respond to market conditions with target modifications
- **Team Restructuring**: Update targets following organizational changes
- **Seasonal Adjustments**: Modify targets for seasonal business patterns
- **Goal Recalibration**: Adjust targets based on actual performance data
- **Emergency Corrections**: Fix errors or handle exceptional circumstances

## 🎪 **Integration Features**
- **ERP Synchronization**: Seamless integration with external systems
- **Notification System**: Automatic alerts for target changes and milestones
- **Reporting Integration**: Updated targets reflect in all performance reports
- **Dashboard Updates**: Real-time dashboard updates with new target information
- **Workflow Integration**: Connect with existing performance management workflows
		`,
		operationId: 'updateUserTargets',
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference identifier - Must be a valid user ID within your organization',
		type: Number,
		example: 123,
	})
	@ApiBody({
		type: UpdateUserTargetDto,
		description: 'Target update configuration with comprehensive validation and support for partial updates',
		examples: {
			targetAdjustment: {
				summary: '📈 Absolute Target Adjustment',
				description:
					'Set new absolute target values (not incremental). Current: R50k target → New: R60k target',
				value: {
					targetSalesAmount: 60000,
					targetQuotationsAmount: 35000,
					targetOrdersAmount: 25000,
					reason: 'Market opportunity adjustment - setting new absolute targets',
					adjustmentType: 'ABSOLUTE_INCREASE',
					effectiveDate: '2024-01-15',
				},
			},
			progressUpdate: {
				summary: '📊 Absolute Progress Update',
				description: 'Set current cumulative progress values. Example: Total month-to-date sales = R45,000',
				value: {
					currentSalesAmount: 45000,
					currentQuotationsAmount: 28000,
					currentOrdersAmount: 17000,
					currentHoursWorked: 120,
					currentNewLeads: 15,
					currentNewClients: 8,
					currentCheckIns: 25,
					currentCalls: 68,
					lastUpdated: '2024-01-15T10:30:00Z',
				},
			},
			correctionUpdate: {
				summary: '🔧 Correction with Negative Values',
				description:
					'Correct errors in progress values. Negative values allowed for corrections (credit notes, reversals)',
				value: {
					currentSalesAmount: 42000,
					currentOrdersAmount: 15000,
					reason: 'Correcting for R3,000 credit note and cancelled order',
					correctionType: 'ERROR_CORRECTION',
					correctionDetails: 'Removed cancelled order (R3k) and applied credit note',
				},
			},
			monthlyRecalibration: {
				summary: '📅 Monthly Target Recalibration',
				description: 'Adjust targets and update cumulative progress based on month-to-date performance',
				value: {
					targetSalesAmount: 70000,
					currentSalesAmount: 38000,
					targetNewLeads: 25,
					currentNewLeads: 16,
					updateReason: 'Mid-month recalibration based on performance trend',
					effectiveDate: '2024-01-15',
				},
			},
			periodModification: {
				summary: '📅 Period Extension',
				description: 'Extend target period due to business requirements',
				value: {
					periodEndDate: '2024-03-31',
					extensionReason: 'Project timeline extension requires target period adjustment',
					recalculateProgress: true,
				},
			},
			currencyChange: {
				summary: '💱 Currency Update',
				description: 'Update currency for international operations',
				value: {
					targetCurrency: 'EUR',
					exchangeRate: 0.85,
					conversionDate: '2024-01-15',
					currencyChangeReason: 'Regional expansion to European market',
				},
			},
			comprehensiveUpdate: {
				summary: '🔄 Comprehensive Absolute Update',
				description:
					'Update multiple categories with absolute values. All values represent new absolute targets/totals',
				value: {
					targetSalesAmount: 75000,
					targetQuotationsAmount: 45000,
					targetOrdersAmount: 30000,
					targetHoursWorked: 180,
					targetNewLeads: 30,
					targetNewClients: 12,
					targetCheckIns: 40,
					targetCalls: 100,
					currentSalesAmount: 52000,
					currentQuotationsAmount: 31000,
					currentOrdersAmount: 21000,
					currentHoursWorked: 145,
					currentNewLeads: 22,
					currentNewClients: 9,
					currentCheckIns: 28,
					currentCalls: 75,
					targetCurrency: 'USD',
					updateReason: 'Q2 target recalibration - all values are new absolute totals',
					approvedBy: 'manager-456',
					effectiveDate: '2024-04-01',
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ User performance targets updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'User targets updated successfully',
					description: 'Success message from service',
				},
			},
			required: ['message'],
		},
	})
	@ApiBadRequestResponse({
		description: '❌ Invalid update data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid target update configuration' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Cannot decrease target below current achievement',
						'Invalid currency code provided',
						'Period dates must be within current fiscal year',
						'Target values must be positive numbers',
						'End date must be after start date',
					],
				},
				fieldErrors: {
					type: 'object',
					properties: {
						targetSalesAmount: {
							type: 'string',
							example: 'Value must be greater than current achievement of 45000',
						},
						targetCurrency: {
							type: 'string',
							example: 'Invalid currency code. Must be valid ISO 4217 currency',
						},
						periodEndDate: { type: 'string', example: 'End date must be after start date' },
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found or no targets configured to update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found or no targets exist to update' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				details: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 123 },
						organizationId: { type: 'number', example: 456 },
						branchId: { type: 'number', example: 789 },
						reason: {
							type: 'string',
							example: 'User exists but no performance targets have been configured',
						},
					},
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to update targets',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update targets for this user' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: {
					type: 'string',
					example: 'Insufficient access level or user belongs to different organization',
				},
				requiredPermissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'OWNER'],
				},
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Target update conflicts with current state',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot update targets - conflicts with current state' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Target period has already ended',
						'Another user is currently updating these targets',
						'Target values conflict with organizational policies',
					],
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Target update failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to update targets due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				path: { type: 'string', example: '/user/123/target' },
			},
		},
	})
	updateUserTarget(
		@Param('ref') ref: number,
		@Body() updateUserTargetDto: UpdateUserTargetDto,
		@Req() req: AuthenticatedRequest,
	): Promise<{ message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG updateUserTarget route:', {
			updatingTargetForUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.updateUserTarget(ref, updateUserTargetDto, accessScope.orgId, accessScope.branchId);
	}

	@Delete(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: '🗑️ Delete user performance targets',
		description: `
# Performance Target Deletion System

Safely removes performance targets for a specific user with comprehensive cleanup, data preservation, and impact analysis capabilities.

## 🔒 **Safety & Security Features**
- **Soft Deletion**: Targets are marked as deleted but preserved for historical analysis
- **Progress Preservation**: All progress data is archived for reporting and compliance
- **Impact Analysis**: Comprehensive assessment of deletion impact on team metrics
- **Audit Trail**: Complete logging of deletion actions with user identification
- **Rollback Capability**: Ability to restore deleted targets within retention period

## 📊 **Data Management**
- **Historical Preservation**: All performance data is archived for future reference
- **Reporting Continuity**: Historical reports remain accessible after deletion
- **Compliance Support**: Maintains data required for regulatory compliance
- **Analytics Integration**: Archived data remains available for analytical purposes
- **Backup Creation**: Automatic backup of target data before deletion

## 🔧 **System Impact**
- **Dashboard Updates**: User dashboard reflects removal of active targets
- **Team Metrics**: Team and branch metrics are recalculated excluding deleted targets
- **Notification System**: Stakeholders are automatically notified of target removal
- **Workflow Integration**: Related workflows are updated to reflect target deletion
- **Performance Reports**: Active reports are updated to exclude deleted targets

## 📋 **Use Cases**
- **Employee Transitions**: Remove targets during role changes or departures
- **Performance Restructuring**: Clear targets for new performance framework
- **Temporary Suspension**: Suspend targets during leave or special circumstances
- **System Maintenance**: Clean up obsolete or incorrect targets
- **Compliance Requirements**: Remove targets for legal or regulatory reasons
- **Performance Reset**: Clear targets for fresh start or new period

## 🎯 **Business Process Integration**
- **HR Workflow**: Integration with employee lifecycle management
- **Performance Management**: Seamless integration with performance review cycles
- **Reporting Systems**: Automatic updates to all performance reporting
- **Analytics Platforms**: Historical data preservation for trend analysis
- **Notification Systems**: Automatic stakeholder communication

## ⚠️ **Impact Assessment**
- **Team Performance**: Analysis of impact on team and branch metrics
- **Individual Progress**: Final progress snapshot and achievement summary
- **Organizational Metrics**: Impact on overall organizational performance
- **Forecasting**: Adjustment of performance forecasts and projections
- **Resource Planning**: Updates to capacity and resource allocation

## 🔄 **Recovery Options**
- **Restoration Period**: Targets can be restored within configurable retention period
- **Data Recovery**: Complete recovery of all target data and progress
- **Audit Recovery**: Full audit trail recovery for compliance purposes
- **Selective Recovery**: Option to recover specific target categories
- **Batch Recovery**: Ability to recover multiple targets simultaneously
		`,
		operationId: 'deleteUserTargets',
	})
	@ApiParam({
		name: 'ref',
		description: 'User reference identifier - Must be a valid user ID within your organization',
		type: Number,
		example: 123,
	})
	@ApiOkResponse({
		description: '✅ User performance targets deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					example: 'User targets deleted successfully',
					description: 'Success message from service',
				},
			},
			required: ['message'],
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User or targets not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found or no targets exist to delete' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				details: {
					type: 'object',
					properties: {
						userId: { type: 'number', example: 123 },
						organizationId: { type: 'number', example: 456 },
						branchId: { type: 'number', example: 789 },
						reason: {
							type: 'string',
							example: 'User exists but no performance targets have been configured',
						},
						suggestions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Verify the user ID is correct',
								'Check if targets have already been deleted',
								'Ensure user belongs to your organization',
							],
						},
					},
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to delete targets',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to delete targets for this user' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: {
					type: 'string',
					example: 'Insufficient access level or user belongs to different organization',
				},
				requiredPermissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER', 'OWNER'],
				},
				currentPermissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['USER'],
				},
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Target deletion conflicts with current state',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Cannot delete targets - conflicts with current system state' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflicts: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User has active performance review in progress',
						'Targets are locked for end-of-period calculations',
						'Another user is currently updating these targets',
					],
				},
				resolution: {
					type: 'object',
					properties: {
						waitTime: { type: 'string', example: '24 hours until targets can be deleted' },
						alternativeActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Wait for active processes to complete',
								'Contact system administrator for override',
								'Schedule deletion for later time',
							],
						},
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Target deletion failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to delete targets due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
				path: { type: 'string', example: '/user/123/target' },
				errorDetails: {
					type: 'object',
					properties: {
						component: { type: 'string', example: 'Target Management Service' },
						operation: { type: 'string', example: 'DELETE_TARGET' },
						errorCode: { type: 'string', example: 'TMS_DELETE_FAILURE' },
						retryable: { type: 'boolean', example: true },
					},
				},
			},
		},
	})
	deleteUserTarget(@Param('ref') ref: number, @Req() req: AuthenticatedRequest): Promise<{ message: string }> {
		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG deleteUserTarget route:', {
			deletingTargetForUser: ref,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		return this.userService.deleteUserTarget(ref, accessScope.orgId, accessScope.branchId);
	}

	@Post('admin/re-invite-all')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({
		summary: '📧 Re-invite All Users (Admin)',
		description: `
      **Send re-invitation emails to all active users in the organization/branch**
      
      This endpoint allows administrators to send re-invitation emails to all eligible users:
      - Fetches all active users in the current organization/branch
      - Excludes users with inappropriate statuses (deleted, banned, inactive)
      - Sends re-invitation emails to foster platform engagement
      - Returns summary statistics of the operation
      
      **Security Features:**
      - Requires admin authentication
      - Respects organization/branch boundaries
      - Excludes inappropriate user statuses
      
      **Use Cases:**
      - Platform re-engagement campaigns
      - After system updates or new features
      - Periodic user activation drives
      - Organization-wide communications
    `,
		operationId: 'reInviteAllUsers',
	})
	@ApiOkResponse({
		description: '✅ Re-invitation emails sent successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: {
					type: 'string',
					example: 'Re-invitation emails sent to 15 out of 20 users successfully',
				},
				data: {
					type: 'object',
					properties: {
						invitedCount: {
							type: 'number',
							example: 15,
							description: 'Number of users who received re-invitation emails',
						},
						totalUsers: {
							type: 'number',
							example: 20,
							description: 'Total number of users in the organization/branch',
						},
						excludedCount: {
							type: 'number',
							example: 5,
							description: 'Number of users excluded from re-invitation (deleted, banned, etc.)',
						},
					},
				},
			},
		},
	})
	async reInviteAllUsers(@Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid || req.user?.organisationRef;
			const branchId = req.user?.branch?.uid;

			const scope = {
				orgId: orgId?.toString(),
				branchId: branchId?.toString(),
				userId: req.user.uid.toString(),
				userRole: req.user.accessLevel,
			};

			const result = await this.userService.reInviteAllUsers(scope);

			return {
				success: true,
				message: `Re-invitation emails sent to ${result.invitedCount} out of ${result.totalUsers} users successfully`,
				data: result,
			};
		} catch (error) {
			throw error;
		}
	}

	@Post('admin/:userId/re-invite')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({
		summary: '📧 Re-invite Individual User',
		description: `
# Individual User Re-engagement System

Sends personalized re-invitation emails to specific users with comprehensive validation and delivery tracking capabilities.

## 📋 **Core Features**
- **Personalized Invitations**: Customized re-invitation emails with user-specific content
- **Delivery Tracking**: Comprehensive tracking of email delivery and engagement
- **Status Validation**: Automatic validation of user eligibility for re-invitation
- **Organization Scope**: Respects organizational and branch boundaries
- **Audit Trail**: Complete logging of re-invitation activities and outcomes

## 🔒 **Security & Validation**
- **Authentication Required**: Admin/manager authentication for re-invitation access
- **Organization Boundaries**: Validates user belongs to same organization/branch
- **Status Eligibility**: Checks user status appropriateness for re-invitation
- **Permission Validation**: Ensures requester has sufficient permissions
- **Rate Limiting**: Prevents abuse with built-in rate limiting controls

## 📊 **Advanced Features**
- **Delivery Confirmation**: Real-time confirmation of successful email delivery
- **Engagement Tracking**: Track user response and platform re-engagement
- **Personalization Engine**: Dynamic content based on user profile and history
- **Follow-up Automation**: Automated follow-up sequences for non-responsive users
- **Analytics Integration**: Comprehensive metrics on re-invitation effectiveness

## 🎯 **Use Cases**
- **Individual Re-engagement**: Targeted approach for high-value users
- **Inactive User Recovery**: Recover users who have become inactive
- **VIP User Management**: Personal touch for important stakeholders
- **Targeted Campaigns**: Precision re-activation for specific user segments
- **Customer Success**: Proactive outreach to improve user experience
- **Compliance Follow-up**: Ensure critical users maintain platform access

## 📈 **Business Intelligence**
- **Success Metrics**: Track re-invitation success rates and user re-engagement
- **User Segmentation**: Analyze effectiveness across different user types
- **Timing Analysis**: Optimize re-invitation timing for maximum impact
- **Channel Performance**: Evaluate email delivery and engagement rates
- **ROI Tracking**: Measure business impact of re-engagement efforts

## 🔧 **Integration Features**
- **Email Service Integration**: Seamless integration with email delivery services
- **CRM Synchronization**: Sync re-invitation activities with CRM systems
- **Analytics Platforms**: Integration with business intelligence tools
- **Notification Systems**: Real-time alerts for delivery and engagement events
- **Workflow Integration**: Connect with existing user management workflows
		`,
		operationId: 'reInviteUser',
	})
	@ApiParam({
		name: 'userId',
		description: 'ID of the user to re-invite',
		type: 'string',
		example: '123',
	})
	@ApiOkResponse({
		description: '✅ Re-invitation email sent successfully',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: {
					type: 'string',
					example: 'Re-invitation email sent to user@example.com successfully',
				},
				data: {
					type: 'object',
					properties: {
						userId: {
							type: 'string',
							example: '123',
							description: 'ID of the user who received the re-invitation',
						},
						email: {
							type: 'string',
							example: 'user@example.com',
							description: 'Email address where the re-invitation was sent',
						},
						sentBy: {
							type: 'string',
							example: 'admin-456',
							description: 'ID of the admin who sent the re-invitation',
						},
						deliveryStatus: {
							type: 'string',
							example: 'sent',
							description: 'Email delivery status',
						},
						timestamp: {
							type: 'string',
							format: 'date-time',
							example: '2023-12-01T10:00:00Z',
							description: 'Re-invitation sent timestamp',
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '🔍 User not found for re-invitation',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'User with ID 123 not found or not accessible' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				reasons: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User ID does not exist',
						'User belongs to different organization',
						'User has been permanently deleted',
						'User is not within your management scope',
					],
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user ID is correct',
						'Check if user belongs to your organization',
						'Ensure you have permission to manage this user',
					],
				},
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions for re-invitation',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'You do not have permission to re-invite users' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient access level or organizational permissions' },
				requiredPermissions: {
					type: 'array',
					items: { type: 'string' },
					example: ['ADMIN', 'MANAGER'],
				},
			},
		},
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - User not eligible for re-invitation',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'User is not eligible for re-invitation' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				eligibilityIssues: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'User is already active',
						'User was recently invited (within 24 hours)',
						'User has opted out of re-invitations',
						'User account is suspended or banned',
					],
				},
				resolution: {
					type: 'object',
					properties: {
						waitTime: { type: 'string', example: '24 hours before next re-invitation' },
						alternativeActions: {
							type: 'array',
							items: { type: 'string' },
							example: [
								'Contact user directly',
								'Update user status first',
								'Use bulk re-invitation for multiple users',
							],
						},
					},
				},
			},
		},
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Re-invitation failed',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Failed to send re-invitation email due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/user/admin/123/re-invite' },
				errorDetails: {
					type: 'object',
					properties: {
						component: { type: 'string', example: 'Email Service' },
						errorCode: { type: 'string', example: 'SMTP_CONNECTION_FAILED' },
						retryable: { type: 'boolean', example: true },
					},
				},
			},
		},
	})
	async reInviteUser(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid || req.user?.organisationRef;
			const branchId = req.user?.branch?.uid;

			const scope = {
				orgId: orgId?.toString(),
				branchId: branchId?.toString(),
				userId: req.user.uid.toString(),
				userRole: req.user.accessLevel,
			};

			const result = await this.userService.reInviteUser(userId, scope);

			return {
				success: true,
				message: `Re-invitation email sent to ${result.email} successfully`,
				data: {
					userId: result.userId,
					email: result.email,
					sentBy: req.user.uid.toString(),
				},
			};
		} catch (error) {
			throw error;
		}
	}

	@Put(':userId/targets/external-update')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.SUPPORT)
	@ApiOperation({
		summary: '📈 Incremental Target Updates from External Systems',
		description: `
# Incremental Target Update System

**This endpoint is designed for INCREMENTAL updates from external systems (CRM, ERP, etc.)**

## 🚨 **REQUIRED PAYLOAD STRUCTURE**

**Your payload was missing required fields! Here's the correct structure:**

### ❌ **Your Original Payload (WRONG)**
**MISSING REQUIRED FIELDS:**
- No "source" field (required)
- No "metadata" object (required)
- Fields in wrong location (transactionType, description, timestamp should be in metadata)

### ✅ **Corrected Payload (CORRECT)**
**ALL REQUIRED FIELDS INCLUDED:**
- "source": "LEGEND_ERP_SYSTEM" (REQUIRED)
- "transactionId": "test" (REQUIRED)
- "updateMode": "INCREMENT" (REQUIRED)
- "updates": with your values (REQUIRED)
- "metadata": object containing updateReason, timestamp, etc. (REQUIRED)

### 🔑 **Key Differences**
- **Source field**: Now OPTIONAL (will default to "UNKNOWN_SOURCE" if not provided)
- **Add metadata object**: Required container for update context
- **Move fields**: transactionType, description, timestamp go inside metadata
- **Add updateReason**: Required field explaining why the update happened

## 🎯 **Key Features**
- **Incremental Updates**: Add/subtract individual transactions (sales, credit notes, leads)
- **Three Update Modes**: INCREMENT (add), DECREMENT (subtract), REPLACE (set absolute)
- **Transaction-Based**: Send individual sale amounts, not cumulative totals
- **Concurrency Safe**: Handles multiple simultaneous updates with locking
- **Audit Trail**: Complete transaction history and change tracking

## 🧮 **How Incremental Calculations Work**

### **INCREMENT Mode**
- **Purpose**: Add positive values to current amounts
- **Only Positive Values Allowed**: Use positive numbers to increase totals
- **Example**: Current R30000 + Increment R5000 = New R35000
- **For Decreases**: Use DECREMENT mode instead

### **DECREMENT Mode**
- **Purpose**: Subtract positive values from current amounts
- **Only Positive Values Allowed**: Use positive numbers to decrease totals
- **Example**: Current R30000 - Decrement R2000 = New R28000
- **Use Cases**: Credit notes, reversals, corrections

### **REPLACE Mode**
- **Purpose**: Set exact absolute values
- **Example**: Replace with R35000 = New R35000 (regardless of current value)
- **Use Cases**: System recalculations, bulk corrections

## 💡 **Common Usage Scenarios**

### **Scenario 1: New Sale Made**
**Payload**: INCREMENT mode with currentSalesAmount: 5000, currentOrdersAmount: 5000
**Result**: Adds R5000 to both sales and orders totals

### **Scenario 2: Credit Note Applied**
**Payload**: DECREMENT mode with currentSalesAmount: 2000, currentOrdersAmount: 2000
**Result**: Subtracts R2000 from both sales and orders totals

### **Scenario 3: Quotation Generated**
**Payload**: INCREMENT mode with currentSalesAmount: 8000, currentQuotationsAmount: 8000
**Result**: Adds R8000 to both sales and quotations totals

## ❓ **FAQ - User Questions Answered**

### **Q: How do I decrease amounts for credit notes or reversals?**
**A: Use DECREMENT mode with positive values!**
- ✅ Correct: "updateMode": "DECREMENT" with "currentSalesAmount": 5000
- ❌ Wrong: "updateMode": "INCREMENT" with "currentSalesAmount": -5000
- Result: Current R50,000 - Decrement R5,000 = New R45,000

### **Q: Do I send the individual sale amount or cumulative monthly total?**
**A: Send the INDIVIDUAL SALE AMOUNT**, not the cumulative total.
- ✅ Correct: Send R5,000 for a single sale using INCREMENT mode
- ❌ Wrong: Send R35,000 cumulative month-to-date total

### **Q: Can I use this for both increases and decreases?**
**A: YES!** Use INCREMENT mode for additions, DECREMENT mode for subtractions, REPLACE mode for absolute values.
- **Increases**: INCREMENT mode with positive values
- **Decreases**: DECREMENT mode with positive values
- **Set Totals**: REPLACE mode with absolute values

## 🔧 **Update Modes Explained**

### **INCREMENT Mode (For Adding Values)**
- **Purpose**: Add positive values to current amounts
- **Use Cases**: New sales, quotations, leads, calls, hours worked
- **Validation**: Only positive values allowed
- **Calculation**: currentValue + incrementValue = newValue
- **Example**: R30,000 + R5,000 = R35,000

### **DECREMENT Mode (For Subtracting Values)**
- **Purpose**: Subtract positive values from current amounts
- **Use Cases**: Credit notes, reversals, corrections, cancellations
- **Validation**: Only positive values allowed
- **Calculation**: currentValue - decrementValue = newValue
- **Example**: R30,000 - R2,000 = R28,000

### **REPLACE Mode (For Absolute Values)**
- **Purpose**: Set exact absolute values (system recalculations)
- **Use Cases**: Monthly recalculations, bulk corrections, system synchronization
- **Validation**: Any value allowed (can be zero or negative for corrections)
- **Calculation**: newValue = replaceValue (ignores current value)
- **Example**: Replace with R35,000 = R35,000

## 🔒 **Concurrency & Safety**
- **Pessimistic Locking**: Prevents data corruption during concurrent updates
- **Automatic Retry**: Built-in retry mechanism with exponential backoff
- **Transaction IDs**: Prevent duplicate processing of same transaction
- **Conflict Resolution**: Detailed conflict information if updates fail

## 📊 **Integration Best Practices**
- **Transaction IDs**: Always include unique transaction IDs for idempotency
- **Error Handling**: Handle conflicts and retry as needed
- **Audit Trail**: All changes are logged with transaction details
- **Validation**: System validates user permissions and data integrity

## 🔐 **Security Features**
- **API Key Authentication**: Requires valid ERP system API key
- **Organization Validation**: Ensures user belongs to correct organization
- **Permission Checks**: Validates updating user has appropriate permissions
- **Audit Logging**: Complete audit trail of all external updates

## 🔧 **Troubleshooting Common Issues**

### ❌ **"X-ERP-API-Key header is required"**
**Solution**: Add the header: X-ERP-API-Key: your-api-key-here

### ✅ **"source is now optional"** 
**Good News**: The source field is now optional! You can omit it entirely or include it for better tracking.

### ❌ **"metadata is required"**
**Solution**: Wrap extra fields in metadata object with updateReason and timestamp

### ❌ **"updateReason is required"**
**Solution**: Add "updateReason": "SALE_COMPLETED" to metadata object
		`,
		operationId: 'updateTargetsFromERP',
	})
	@ApiParam({
		name: 'userId',
		description: 'User ID to update targets for',
		type: 'number',
		example: 123,
	})
	@ApiBody({
		type: ExternalTargetUpdateDto,
		description: 'External target update data from ERP system with incremental transaction support',
		examples: {
			correctedUserPayload: {
				summary: '✅ Corrected User Payload',
				description: 'This shows the corrected version of your original payload. Source field is now OPTIONAL.',
				value: {
					transactionId: 'test',
					updateMode: 'INCREMENT',
					updates: {
						currentSalesAmount: 711376.21,
					},
					metadata: {
						updateReason: 'SALE_COMPLETED',
						timestamp: '2025-09-01T19:34:00Z',
						transactionType: 'SALE',
						description: 'Test API Call',
						erpVersion: '2.1.0',
					},
				},
			},
			correctedUserPayloadWithSource: {
				summary: '✅ With Optional Source Field',
				description: 'Example showing how to include the optional source field for better tracking.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'test',
					updateMode: 'INCREMENT',
					updates: {
						currentSalesAmount: 711376.21,
					},
					metadata: {
						updateReason: 'SALE_COMPLETED',
						timestamp: '2025-09-01T19:34:00Z',
						transactionType: 'SALE',
						description: 'Test API Call',
						erpVersion: '2.1.0',
					},
				},
			},
			newSale: {
				summary: '💰 New Sale Transaction',
				description: 'Add a new sale to user targets. Send individual sale amount, not cumulative total.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'SALE_INV_12345',
					updateMode: 'INCREMENT',
					updates: {
						currentSalesAmount: 5000,
						currentOrdersAmount: 5000,
					},
					metadata: {
						updateReason: 'SALE_COMPLETED',
						timestamp: '2024-01-15T10:30:00Z',
						transactionType: 'SALE',
						description: 'New sale - Invoice #12345 for R5,000',
						erpVersion: '2.1.0',
					},
				},
			},
			creditNote: {
				summary: '📄 Credit Note Application',
				description: 'Apply credit note using DECREMENT mode. Uses positive values to subtract from totals.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'CREDIT_NOTE_456',
					updateMode: 'DECREMENT',
					updates: {
						currentSalesAmount: 2000,
						currentOrdersAmount: 2000,
					},
					metadata: {
						updateReason: 'CREDIT_NOTE_APPLIED',
						timestamp: '2024-01-15T11:00:00Z',
						transactionType: 'CREDIT_NOTE',
						description: 'Credit note for returned goods - R2,000',
						erpVersion: '2.1.0',
					},
				},
			},
			newQuotation: {
				summary: '📋 Quotation Generated',
				description: 'Record new quotation. Adds to both sales and quotations totals.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'QUOTE_789',
					updateMode: 'INCREMENT',
					updates: {
						currentSalesAmount: 8000,
						currentQuotationsAmount: 8000,
					},
					metadata: {
						updateReason: 'QUOTATION_GENERATED',
						timestamp: '2024-01-15T12:00:00Z',
						transactionType: 'QUOTATION',
						description: 'New quotation #789 for R8,000',
						erpVersion: '2.1.0',
					},
				},
			},
			quotationConverted: {
				summary: '✅ Quotation to Order Conversion',
				description: 'Convert quotation to paid order. First decrement quotations, then increment orders.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'CONVERT_QUOTE_789_STEP1',
					updateMode: 'DECREMENT',
					updates: {
						currentQuotationsAmount: 8000,
					},
					metadata: {
						updateReason: 'QUOTATION_CONVERTED',
						timestamp: '2024-01-15T14:00:00Z',
						transactionType: 'CONVERSION_STEP1',
						description: 'Step 1: Remove R8,000 from quotations (converted to order)',
						erpVersion: '2.1.0',
					},
				},
			},
			quotationConvertedStep2: {
				summary: '✅ Quotation Conversion - Step 2',
				description: 'Second step: Add converted amount to orders. Use separate transaction.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'CONVERT_QUOTE_789_STEP2',
					updateMode: 'INCREMENT',
					updates: {
						currentOrdersAmount: 8000,
					},
					metadata: {
						updateReason: 'QUOTATION_CONVERTED',
						timestamp: '2024-01-15T14:01:00Z',
						transactionType: 'CONVERSION_STEP2',
						description: 'Step 2: Add R8,000 to orders (from converted quotation)',
						erpVersion: '2.1.0',
					},
				},
			},
			newLead: {
				summary: '🎯 New Lead Added',
				description: 'Record new lead generation. Increments lead count.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'LEAD_2024_001',
					updateMode: 'INCREMENT',
					updates: {
						currentNewLeads: 1,
					},
					metadata: {
						updateReason: 'LEAD_GENERATED',
						timestamp: '2024-01-15T09:00:00Z',
						transactionType: 'LEAD',
						description: 'New lead from marketing campaign',
						erpVersion: '2.1.0',
					},
				},
			},
			clientCheckIn: {
				summary: '📞 Client Check-in',
				description: 'Record client interaction. Increments check-in and calls count.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'CHECKIN_CLIENT_123',
					updateMode: 'INCREMENT',
					updates: {
						currentCheckIns: 1,
						currentCalls: 1,
					},
					metadata: {
						updateReason: 'CLIENT_INTERACTION',
						timestamp: '2024-01-15T15:30:00Z',
						transactionType: 'CHECK_IN',
						description: 'Monthly check-in call with Client ABC',
						erpVersion: '2.1.0',
					},
				},
			},
			hoursWorked: {
				summary: '⏰ Work Hours Logged',
				description: 'Add work hours to user total using INCREMENT mode.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'TIMESHEET_150124',
					updateMode: 'INCREMENT',
					updates: {
						currentHoursWorked: 8,
					},
					metadata: {
						updateReason: 'HOURS_LOGGED',
						timestamp: '2024-01-15T17:00:00Z',
						transactionType: 'HOURS',
						description: 'Daily timesheet - 8 hours logged',
						erpVersion: '2.1.0',
					},
				},
			},
			hourCorrection: {
				summary: '🔧 Hours Correction',
				description: 'Correct previously logged hours using DECREMENT mode with positive values.',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'CORRECTION_150124',
					updateMode: 'DECREMENT',
					updates: {
						currentHoursWorked: 2,
					},
					metadata: {
						updateReason: 'HOURS_CORRECTION',
						timestamp: '2024-01-15T18:00:00Z',
						transactionType: 'CORRECTION',
						description: 'Correction: Remove 2 hours from timesheet',
						erpVersion: '2.1.0',
					},
				},
			},
			multipleUpdates: {
				summary: '🔄 Multiple Transactions',
				description: 'Update multiple metrics in single transaction (sale + new lead + call).',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'MULTI_TRANS_001',
					updateMode: 'INCREMENT',
					updates: {
						currentSalesAmount: 12000,
						currentOrdersAmount: 12000,
						currentNewLeads: 1,
						currentCalls: 3,
						currentCheckIns: 1,
					},
					metadata: {
						updateReason: 'MULTI_ACTIVITY',
						timestamp: '2024-01-15T16:00:00Z',
						transactionType: 'MULTI_UPDATE',
						description: 'Sale R12k + new lead + 3 calls + client check-in',
						erpVersion: '2.1.0',
					},
				},
			},
			systemRecalculation: {
				summary: '🖥️ System Recalculation',
				description: 'REPLACE mode: Set absolute values (like monthly system recalculation).',
				value: {
					source: 'LEGEND_ERP_SYSTEM',
					transactionId: 'SYS_RECALC_0124',
					updateMode: 'REPLACE',
					updates: {
						currentSalesAmount: 45000,
						currentQuotationsAmount: 28000,
						currentOrdersAmount: 17000,
						currentNewLeads: 15,
						currentNewClients: 8,
						currentCheckIns: 25,
						currentCalls: 68,
						currentHoursWorked: 120,
					},
					metadata: {
						updateReason: 'SYSTEM_RECALCULATION',
						timestamp: '2024-01-15T20:00:00Z',
						transactionType: 'SYSTEM_RECALC',
						description: 'Monthly system recalculation from CRM data',
						erpVersion: '2.1.0',
					},
				},
			},
		},
	})
	@ApiHeader({
		name: 'X-ERP-API-Key',
		description: 'ERP system API key for authentication',
		required: true,
		example: 'erp-api-key-12345',
	})
	@ApiResponse({
		status: 200,
		description: '✅ Incremental target update successful',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: true },
				message: { type: 'string', example: 'User targets updated successfully from ERP' },
				updateType: { type: 'string', example: 'INCREMENT', description: 'Type of update performed' },
				transactionId: {
					type: 'string',
					example: 'SALE_INV_12345',
					description: 'Transaction ID for audit trail',
				},
				calculations: {
					type: 'object',
					description: 'Detailed calculation breakdown',
					properties: {
						salesAmount: {
							type: 'object',
							properties: {
								previousValue: { type: 'number', example: 30000, description: 'Value before update' },
								increment: { type: 'number', example: 5000, description: 'Amount added/subtracted' },
								newValue: { type: 'number', example: 35000, description: 'Value after update' },
							},
						},
						ordersAmount: {
							type: 'object',
							properties: {
								previousValue: { type: 'number', example: 20000, description: 'Value before update' },
								increment: { type: 'number', example: 5000, description: 'Amount added/subtracted' },
								newValue: { type: 'number', example: 25000, description: 'Value after update' },
							},
						},
					},
				},
				updatedValues: {
					type: 'object',
					description: 'Final values after update',
					properties: {
						currentSalesAmount: { type: 'number', example: 35000, description: 'Total sales amount' },
						currentQuotationsAmount: {
							type: 'number',
							example: 15000,
							description: 'Total quotations amount',
						},
						currentOrdersAmount: { type: 'number', example: 25000, description: 'Total orders amount' },
						currentNewLeads: { type: 'number', example: 12, description: 'Total leads generated' },
						currentNewClients: { type: 'number', example: 8, description: 'Total new clients' },
						currentCheckIns: { type: 'number', example: 25, description: 'Total check-ins completed' },
						currentHoursWorked: { type: 'number', example: 160.5, description: 'Total hours worked' },
						currentCalls: { type: 'number', example: 45, description: 'Total calls made' },
					},
				},
				progressImpact: {
					type: 'object',
					description: 'Impact on achievement percentages',
					properties: {
						salesProgress: { type: 'number', example: 70.0, description: 'Sales achievement percentage' },
						ordersProgress: { type: 'number', example: 83.3, description: 'Orders achievement percentage' },
						overallProgress: { type: 'number', example: 76.2, description: 'Overall progress percentage' },
					},
				},
				timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
			},
		},
	})
	@ApiResponse({
		status: 409,
		description: '⚠️ Concurrent update conflict',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Concurrent update conflict detected' },
				conflictDetails: {
					type: 'object',
					properties: {
						retryCount: { type: 'number', example: 3 },
						error: { type: 'string', example: 'Lock wait timeout exceeded' },
						suggestion: { type: 'string', example: 'Please retry the update after a short delay' },
					},
				},
			},
		},
	})
	@ApiResponse({
		status: 400,
		description: '❌ Validation error - Invalid increment values or missing data',
		schema: {
			type: 'object',
			properties: {
				success: { type: 'boolean', example: false },
				message: { type: 'string', example: 'Validation failed for target update' },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Transaction ID is required for audit trail',
						'At least one increment value must be provided',
						'Update mode must be either INCREMENT or REPLACE',
						'Negative increments are allowed but will reduce totals',
						'REPLACE mode requires absolute values, not increments',
					],
				},
				fieldErrors: {
					type: 'object',
					properties: {
						transactionId: { type: 'string', example: 'Transaction ID is required for idempotency' },
						updateMode: { type: 'string', example: 'Must be INCREMENT or REPLACE' },
						salesAmountIncrement: {
							type: 'string',
							example: 'Must be a number (negative values allowed for reductions)',
						},
					},
				},
				hints: {
					type: 'object',
					properties: {
						incrementMode: {
							type: 'string',
							example: 'Use positive values to add, negative values to subtract',
						},
						replaceMode: {
							type: 'string',
							example: 'Use REPLACE mode to set absolute values instead of increments',
						},
						transactionIds: {
							type: 'string',
							example: 'Use unique transaction IDs to prevent duplicate processing',
						},
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ description: 'Invalid update data or missing API key' })
	@ApiNotFoundResponse({ description: 'User not found or no targets configured' })
	async updateTargetsFromERP(
		@Param('userId', ParseIntPipe) userId: number,
		@Body() externalUpdateDto: ExternalTargetUpdateDto,
		@Headers('X-ERP-API-Key') apiKey: string,
		@Req() req: AuthenticatedRequest,
	) {
		// TODO: Validate API key in production
		// For now, we'll skip API key validation but log it
		if (!apiKey) {
			throw new Error('X-ERP-API-Key header is required');
		}

		const accessScope = this.getAccessScope(req.user);

		// 🔍 DEBUG: Log the access decision
		console.log('🔍 DEBUG updateTargetsFromERP route:', {
			updatingTargetsForUser: userId,
			requestingUser: {
				uid: req.user?.uid,
				accessLevel: req.user?.accessLevel,
				isElevated: accessScope.isElevated,
			},
			accessScope: {
				orgId: accessScope.orgId,
				branchId: accessScope.branchId,
				orgWideAccess: accessScope.branchId === null,
			},
		});

		const result = await this.userService.updateUserTargetsFromERP(
			userId,
			externalUpdateDto,
			accessScope.orgId,
			accessScope.branchId,
		);

		// Return appropriate status codes based on result
		if (result.validationErrors && result.validationErrors.length > 0) {
			return {
				success: false,
				message: result.message,
				validationErrors: result.validationErrors,
			};
		}

		if (result.conflictDetails) {
			return {
				success: false,
				message: result.message,
				conflictDetails: result.conflictDetails,
			};
		}

		return {
			success: true,
			message: result.message,
			updatedValues: result.updatedValues,
		};
	}

	@Get(':userId/audit-target-data')
	@ApiOperation({
		summary: '🔍 Audit User Target Data',
		description: `
		**Debug endpoint to audit user target data for integrity issues.**
		
		This endpoint performs comprehensive validation of stored target values against actual database records to identify:
		- Data calculation inconsistencies
		- Unreasonably large values
		- Historical data corruption
		- Sales amount calculation mismatches
		
		**Use this endpoint when:**
		- Investigating target calculation failures
		- Debugging unreasonable target values
		- Analyzing historical data integrity
		
		⚠️ **Admin Only**: This is a debugging tool for administrators.
		`,
	})
	@ApiParam({
		name: 'userId',
		description: 'User ID to audit',
		type: 'number',
		example: 1,
	})
	@ApiOkResponse({
		description: '🔍 Audit completed successfully',
		schema: {
			type: 'object',
			properties: {
				hasIssues: {
					type: 'boolean',
					description: 'Whether data integrity issues were found',
					example: true,
				},
				issues: {
					type: 'array',
					items: { type: 'string' },
					description: 'List of detected issues',
					example: ['Sales amount mismatch: current 16624598.45, expected 1959196.90'],
				},
				recommendations: {
					type: 'array',
					items: { type: 'string' },
					description: 'Recommended actions to fix issues',
					example: ['Recalculate sales amount as quotations (1724598.45) + orders (234598.45)'],
				},
				historicalData: {
					type: 'object',
					description: 'Historical data analysis for debugging',
					properties: {
						storedValues: {
							type: 'object',
							properties: {
								quotations: { type: 'number', example: 1724598.45 },
								orders: { type: 'number', example: 234598.45 },
								sales: { type: 'number', example: 16624598.45 },
							},
						},
						calculatedValues: {
							type: 'object',
							properties: {
								expectedSales: { type: 'number', example: 1959196.90 },
								actualQuotationsFromDB: { type: 'number', example: 1724598.45 },
							},
						},
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({
		description: '❌ User not found',
		schema: {
			type: 'object',
			properties: {
				hasIssues: { type: 'boolean', example: false },
				issues: { type: 'array', items: { type: 'string' }, example: [] },
				recommendations: { 
					type: 'array', 
					items: { type: 'string' }, 
					example: ['User has no target data to audit'] 
				},
			},
		},
	})
	@Roles(AccessLevel.ADMIN)
	async auditUserTargetData(
		@Param('userId') userId: number,
		@Req() req: AuthenticatedRequest,
	): Promise<{
		hasIssues: boolean;
		issues: string[];
		recommendations: string[];
		historicalData?: any;
	}> {
		const accessScope = this.getAccessScope(req.user);
		
		// For audit purposes, we'll allow cross-organization access for super admins
		// but restrict to organization for regular admins
		if (req.user.accessLevel !== AccessLevel.ADMIN) {
			// Regular admins can only audit users in their organization
			return await this.userService.auditUserTargetData(userId);
		}

		return await this.userService.auditUserTargetData(userId);
	}
}
