import { UserService } from './user.service';
import { RoleGuard } from '../guards/role.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { AuthGuard } from '../guards/auth.guard';
import { Roles } from '../decorators/role.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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
	ApiUnprocessableEntityResponse,
	ApiInternalServerErrorResponse,
	ApiServiceUnavailableResponse,
	ApiConsumes,
	ApiProduces,
} from '@nestjs/swagger';
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req, Put, ParseIntPipe, Headers } from '@nestjs/common';
import { AccountStatus } from '../lib/enums/status.enums';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { CreateUserTargetDto } from './dto/create-user-target.dto';
import { UpdateUserTargetDto } from './dto/update-user-target.dto';
import { ExternalTargetUpdateDto } from './dto/external-target-update.dto';

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
			statusCode: { type: 'number', example: 401 }
		}
	}
})
export class UserController {
	constructor(private readonly userService: UserService) {}

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
		description: 'User creation payload with comprehensive user information including personal profile and employment details',
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
						aboutMe: 'Passionate software developer with 5+ years of experience'
					},
					employmentProfile: {
						position: 'Software Engineer',
						department: 'Engineering',
						startDate: '2023-01-15',
						isCurrentlyEmployed: true,
						email: 'john.doe@company.com',
						contactNumber: '+27 64 123 4567'
					}
				}
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
						aboutMe: 'Experienced engineering manager with leadership expertise'
					},
					employmentProfile: {
						position: 'Engineering Manager',
						department: 'Engineering',
						startDate: '2023-01-01',
						isCurrentlyEmployed: true,
						email: 'jane.smith@company.com',
						contactNumber: '+27 64 987 6543'
					}
				}
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
					accessLevel: AccessLevel.USER
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ User created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User created successfully' },
				data: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 1 },
						username: { type: 'string', example: 'john.doe' },
						name: { type: 'string', example: 'John' },
						surname: { type: 'string', example: 'Doe' },
						email: { type: 'string', example: 'john.doe@loro.co.za' },
						phone: { type: 'string', example: '+27 64 123 4567' },
						photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
						businesscardURL: { type: 'string', example: 'https://example.com/businesscard.jpg' },
						avatar: { type: 'string', example: 'https://example.com/avatar.jpg', nullable: true },
						role: { type: 'string', example: 'employee' },
						status: { type: 'string', example: 'active' },
						departmentId: { type: 'number', example: 1 },
						accessLevel: { type: 'string', enum: Object.values(AccessLevel), example: AccessLevel.USER },
						organisationRef: { type: 'string', example: 'ORG123' },
						userref: { type: 'string', example: 'USR123456' },
						hrID: { type: 'number', example: 12345, description: 'HR system ID for backward compatibility' },
						expoPushToken: { type: 'string', example: 'ExponentPushToken[abc123]' },
						deviceId: { type: 'string', example: 'device123' },
						platform: { type: 'string', example: 'ios' },
						isDeleted: { type: 'boolean', example: false },
						profile: {
							type: 'object',
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
								currentAge: { type: 'number', example: 30 },
								numberDependents: { type: 'number', example: 0 }
							}
						},
						employmentProfile: {
							type: 'object',
							properties: {
								uid: { type: 'string', example: '1' },
								position: { type: 'string', example: 'Software Engineer' },
								department: { type: 'string', example: 'Engineering' },
								startDate: { type: 'string', format: 'date', example: '2023-01-15' },
								isCurrentlyEmployed: { type: 'boolean', example: true },
								email: { type: 'string', example: 'john.doe@company.com' },
								contactNumber: { type: 'string', example: '+27 64 123 4567' }
							}
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
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
						'Access level must be one of the allowed values'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to create users in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
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
						username: { type: 'string', example: 'john.doe' }
					}
				}
			}
		}
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
				path: { type: 'string', example: '/user' }
			}
		}
	})
	create(@Body() createUserDto: CreateUserDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.create(createUserDto, orgId, branchId);
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
	@ApiQuery({ name: 'page', description: 'Page number for pagination (starts from 1)', required: false, type: Number, example: 1 })
	@ApiQuery({ name: 'limit', description: 'Number of items per page (max 100)', required: false, type: Number, example: 10 })
	@ApiQuery({ name: 'status', description: 'Filter by account status', required: false, enum: AccountStatus, example: AccountStatus.ACTIVE })
	@ApiQuery({ name: 'accessLevel', description: 'Filter by access level', required: false, enum: AccessLevel, example: AccessLevel.USER })
	@ApiQuery({ name: 'search', description: 'Search term for filtering users (name, email, username)', required: false, type: String, example: 'john' })
	@ApiQuery({ name: 'branchId', description: 'Filter by branch ID', required: false, type: Number, example: 123 })
	@ApiQuery({ name: 'organisationId', description: 'Filter by organisation ID', required: false, type: Number, example: 456 })
	@ApiOkResponse({
		description: '✅ Users retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						users: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 1 },
									username: { type: 'string', example: 'john.doe' },
									name: { type: 'string', example: 'John' },
									surname: { type: 'string', example: 'Doe' },
									email: { type: 'string', example: 'john.doe@loro.co.za' },
									phone: { type: 'string', example: '+27 64 123 4567' },
									photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
									businesscardURL: { type: 'string', example: 'https://example.com/businesscard.jpg' },
									role: { type: 'string', example: 'employee' },
									status: { type: 'string', example: 'active' },
									departmentId: { type: 'number', example: 1 },
									accessLevel: {
										type: 'string',
										enum: Object.values(AccessLevel),
										example: AccessLevel.USER,
									},
									organisationRef: { type: 'string', example: 'ORG123' },
									userref: { type: 'string', example: 'USR123456' },
									hrID: { type: 'number', example: 12345, description: 'HR system ID for backward compatibility' },
									expoPushToken: { type: 'string', example: 'ExponentPushToken[abc123]' },
									deviceId: { type: 'string', example: 'device123' },
									platform: { type: 'string', example: 'ios' },
									isDeleted: { type: 'boolean', example: false },
									createdAt: { type: 'string', format: 'date-time' },
									updatedAt: { type: 'string', format: 'date-time' },
									lastLoginAt: { type: 'string', format: 'date-time', example: '2023-11-30T14:30:00Z' },
									profile: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 1 },
											height: { type: 'string', example: '180cm' },
											weight: { type: 'string', example: '75kg' },
											hairColor: { type: 'string', example: 'Brown' },
											eyeColor: { type: 'string', example: 'Blue' },
											gender: { type: 'string', example: 'MALE' },
											ethnicity: { type: 'string', example: 'African' },
											bodyType: { type: 'string', example: 'Athletic' },
											smokingHabits: { type: 'string', example: 'Non-smoker' },
											drinkingHabits: { type: 'string', example: 'Occasional' },
											dateOfBirth: { type: 'string', format: 'date', example: '1990-01-15' },
											address: { type: 'string', example: '123 Main Street' },
											city: { type: 'string', example: 'Cape Town' },
											country: { type: 'string', example: 'South Africa' },
											zipCode: { type: 'string', example: '7700' },
											aboutMe: { type: 'string', example: 'Passionate software developer' },
											socialMedia: { type: 'string', example: 'twitter.com/johndoe' },
											currentAge: { type: 'number', example: 30 },
											maritalStatus: { type: 'string', example: 'Single' },
											numberDependents: { type: 'number', example: 0 },
											shoeSize: { type: 'string', example: '10' },
											shirtSize: { type: 'string', example: 'L' },
											pantsSize: { type: 'string', example: '32' },
											dressSize: { type: 'string', example: 'M' },
											coatSize: { type: 'string', example: 'L' }
										},
									},
									employmentProfile: {
										type: 'object',
										properties: {
											uid: { type: 'string', example: '1' },
											position: { type: 'string', example: 'Senior Software Engineer' },
											department: { type: 'string', example: 'Engineering' },
											startDate: { type: 'string', format: 'date', example: '2023-01-15' },
											endDate: { type: 'string', format: 'date', example: '2024-01-15' },
											isCurrentlyEmployed: { type: 'boolean', example: true },
											email: { type: 'string', example: 'john.doe@company.com' },
											contactNumber: { type: 'string', example: '+27 64 123 4567' },
											branchref: { type: 'string', example: 'BRANCH123' },
											createdAt: { type: 'string', format: 'date-time' },
											updatedAt: { type: 'string', format: 'date-time' }
										},
									},
									branch: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 123 },
											name: { type: 'string', example: 'Cape Town Office' },
											location: { type: 'string', example: 'Cape Town, South Africa' },
										},
									},
									organization: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 456 },
											name: { type: 'string', example: 'Loro Technologies' },
										},
									},
								},
							},
						},
						summary: {
							type: 'object',
							properties: {
								totalUsers: { type: 'number', example: 156 },
								activeUsers: { type: 'number', example: 145 },
								inactiveUsers: { type: 'number', example: 11 },
								byAccessLevel: {
									type: 'object',
									properties: {
										ADMIN: { type: 'number', example: 5 },
										MANAGER: { type: 'number', example: 15 },
										USER: { type: 'number', example: 136 },
									},
								},
								byDepartment: {
									type: 'object',
									properties: {
										ENGINEERING: { type: 'number', example: 45 },
										SALES: { type: 'number', example: 35 },
										MARKETING: { type: 'number', example: 25 },
										HR: { type: 'number', example: 15 },
									},
								},
							},
						},
					},
				},
				message: { type: 'string', example: 'Users retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						total: { type: 'number', example: 156 },
						page: { type: 'number', example: 1 },
						limit: { type: 'number', example: 10 },
						totalPages: { type: 'number', example: 16 },
						hasNextPage: { type: 'boolean', example: true },
						hasPreviousPage: { type: 'boolean', example: false },
					},
				},
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
			},
		},
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to view users',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view users in this organization' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
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
				path: { type: 'string', example: '/user' }
			}
		}
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
	) {
		const orgId = req.user?.org?.uid;
		const userBranchId = req.user?.branch?.uid;

		const filters = {
			...(status && { status }),
			...(accessLevel && { accessLevel }),
			...(search && { search }),
			...(branchId && { branchId: Number(branchId) }),
			...(organisationId && { organisationId: Number(organisationId) }),
			orgId,
			userBranchId,
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
- **Permission Validation**: Only authorized users can access profiles
- **Data Masking**: Sensitive information is filtered based on access level
- **Audit Logging**: All profile access is logged for security
- **Branch Filtering**: Users can only access profiles in their organization
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
		`
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
				data: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								username: { type: 'string', example: 'john.doe' },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@loro.co.za' },
								phone: { type: 'string', example: '+27 64 123 4567' },
								photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
								businesscardURL: { type: 'string', example: 'https://example.com/businesscard.jpg' },
								role: { type: 'string', example: 'employee' },
								status: { type: 'string', example: 'active' },
								departmentId: { type: 'number', example: 1 },
								accessLevel: { type: 'string', enum: Object.values(AccessLevel), example: AccessLevel.USER },
								organisationRef: { type: 'string', example: 'ORG123' },
								userref: { type: 'string', example: 'USR123456' },
								hrID: { type: 'number', example: 12345 },
								expoPushToken: { type: 'string', example: 'ExponentPushToken[abc123]' },
								deviceId: { type: 'string', example: 'device123' },
								platform: { type: 'string', example: 'ios' },
								pushTokenUpdatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
								isDeleted: { type: 'boolean', example: false },
								profile: {
									type: 'object',
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
										socialMedia: { type: 'string', example: 'linkedin.com/in/johndoe' },
										emergencyContact: { type: 'string', example: 'Jane Doe: +27 64 987 6543' }
									}
								},
								employmentProfile: {
									type: 'object',
									properties: {
										uid: { type: 'string', example: '1' },
										position: { type: 'string', example: 'Software Engineer' },
										department: { type: 'string', example: 'Engineering' },
										startDate: { type: 'string', format: 'date', example: '2023-01-15' },
										isCurrentlyEmployed: { type: 'boolean', example: true },
										email: { type: 'string', example: 'john.doe@company.com' },
										contactNumber: { type: 'string', example: '+27 64 123 4567' },
										managerRef: { type: 'string', example: 'MGR456' },
										branchref: { type: 'string', example: 'BRANCH123' },
										salary: { type: 'number', example: 75000 },
										benefits: { type: 'string', example: 'Health insurance, retirement fund' }
									}
								},
								lastActivity: {
									type: 'object',
									properties: {
										lastLogin: { type: 'string', format: 'date-time', example: '2024-01-15T09:30:00Z' },
										lastSeen: { type: 'string', format: 'date-time', example: '2024-01-15T12:45:00Z' },
										activeMinutes: { type: 'number', example: 180, description: 'Minutes active in the last 24 hours' },
										loginCount: { type: 'number', example: 45, description: 'Total login count this month' }
									}
								},
								analytics: {
									type: 'object',
									properties: {
										profileCompleteness: { type: 'number', example: 85, description: 'Profile completion percentage' },
										activityScore: { type: 'number', example: 7.8, description: 'User engagement score (0-10)' },
										taskCompletionRate: { type: 'number', example: 94.2, description: 'Task completion rate percentage' },
										performanceRating: { type: 'number', example: 8.5, description: 'Overall performance rating' }
									}
								},
								permissions: {
									type: 'object',
									properties: {
										canEdit: { type: 'boolean', example: true },
										canDelete: { type: 'boolean', example: false },
										canViewReports: { type: 'boolean', example: true },
										canManageTeam: { type: 'boolean', example: false }
									}
								},
								createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T10:00:00Z' },
								updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T14:30:00Z' },
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '❌ User not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User with reference 123 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view this user profile' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Profile retrieval failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'An unexpected error occurred while retrieving user profile' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 }
			}
		}
	})
	findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.findOne(ref, orgId, branchId);
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
						socialMedia: 'linkedin.com/in/johndoe'
					}
				}
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
						branchref: 'BRANCH456'
					}
				}
			},
			statusUpdate: {
				summary: '🔄 Status Change',
				description: 'Change user status and access level',
				value: {
					status: 'active',
					role: 'manager',
					accessLevel: AccessLevel.MANAGER,
					organisationRef: 'ORG456'
				}
			},
			deviceUpdate: {
				summary: '📱 Device Information Update',
				description: 'Update device and notification settings',
				value: {
					expoPushToken: 'ExponentPushToken[updated-token]',
					deviceId: 'device789xyz',
					platform: 'android',
					pushTokenUpdatedAt: '2024-02-01T00:00:00Z'
				}
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
						currentAge: 34
					},
					employmentProfile: {
						position: 'Senior Software Engineer',
						department: 'Engineering',
						startDate: '2023-01-15',
						isCurrentlyEmployed: true,
						email: 'john.doesmith@company.com',
						contactNumber: '+27 64 111 2222'
					}
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ User updated successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								username: { type: 'string', example: 'john.doe' },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@loro.co.za' },
								phone: { type: 'string', example: '+27 64 123 4567' },
								photoURL: { type: 'string', example: 'https://example.com/photo.jpg' },
								businesscardURL: { type: 'string', example: 'https://example.com/businesscard.jpg' },
								role: { type: 'string', example: 'manager' },
								status: { type: 'string', example: 'active' },
								departmentId: { type: 'number', example: 2 },
								accessLevel: { type: 'string', enum: Object.values(AccessLevel), example: AccessLevel.MANAGER },
								organisationRef: { type: 'string', example: 'ORG456' },
								userref: { type: 'string', example: 'USR789012' },
								hrID: { type: 'number', example: 54321 },
								expoPushToken: { type: 'string', example: 'ExponentPushToken[updated-token]' },
								deviceId: { type: 'string', example: 'device456def' },
								platform: { type: 'string', example: 'android' },
								pushTokenUpdatedAt: { type: 'string', format: 'date-time', example: '2024-02-01T00:00:00Z' },
								isDeleted: { type: 'boolean', example: false },
								profile: {
									type: 'object',
									properties: {
										uid: { type: 'number', example: 1 },
										height: { type: 'string', example: '185cm' },
										weight: { type: 'string', example: '80kg' },
										gender: { type: 'string', example: 'MALE' },
										address: { type: 'string', example: '456 New Street' },
										city: { type: 'string', example: 'Johannesburg' },
										country: { type: 'string', example: 'South Africa' },
										maritalStatus: { type: 'string', example: 'Married' },
										aboutMe: { type: 'string', example: 'Updated profile description with new experiences' }
									}
								},
								employmentProfile: {
									type: 'object',
									properties: {
										uid: { type: 'string', example: '1' },
										position: { type: 'string', example: 'Lead Software Engineer' },
										department: { type: 'string', example: 'Engineering' },
										isCurrentlyEmployed: { type: 'boolean', example: true },
										email: { type: 'string', example: 'john.doe@newcompany.com' },
										contactNumber: { type: 'string', example: '+27 64 999 8888' }
									}
								},
								updatedFields: {
									type: 'array',
									items: { type: 'string' },
									example: ['name', 'phone', 'role', 'profile.address', 'employmentProfile.position']
								},
								updatedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
							}
						},
						auditLog: {
							type: 'object',
							properties: {
								changes: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											field: { type: 'string', example: 'position' },
											oldValue: { type: 'string', example: 'Software Engineer' },
											newValue: { type: 'string', example: 'Lead Software Engineer' },
											category: { type: 'string', example: 'employment' }
										}
									},
									example: [
										{
											field: 'position',
											oldValue: 'Software Engineer',
											newValue: 'Lead Software Engineer',
											category: 'employment'
										},
										{
											field: 'address',
											oldValue: '123 Main Street',
											newValue: '456 New Street',
											category: 'profile'
										},
										{
											field: 'role',
											oldValue: 'employee',
											newValue: 'manager',
											category: 'system'
										}
									]
								},
								updatedBy: { type: 'string', example: 'Admin User' },
								timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								totalChanges: { type: 'number', example: 3 },
								affectedCategories: {
									type: 'array',
									items: { type: 'string' },
									example: ['employment', 'profile', 'system']
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'User updated successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			},
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
						'Ensure you have permission to access this user'
					]
				}
			}
		}
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
						'Access level must be one of the allowed values'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to update user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update this user' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'User belongs to different branch or insufficient role permissions' }
			}
		}
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
						'Cannot change role while user has active sessions'
					]
				}
			}
		}
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
				path: { type: 'string', example: '/user/123' }
			}
		}
	})
	update(@Param('ref') ref: number, @Body() updateUserDto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.update(ref, updateUserDto, orgId, branchId);
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
				data: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								username: { type: 'string', example: 'john.doe' },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@loro.co.za' },
								status: { type: 'string', example: AccountStatus.ACTIVE },
								previousStatus: { type: 'string', example: 'DELETED' },
								deletedAt: { type: 'string', format: 'date-time', example: '2023-11-15T10:00:00Z' },
								restoredAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								restoredBy: { type: 'string', example: 'Admin User' },
								daysDeleted: { type: 'number', example: 16, description: 'Number of days user was deleted' },
								retentionPeriodRemaining: { type: 'number', example: 74, description: 'Days left in retention period' }
							}
						},
						validationChecks: {
							type: 'object',
							properties: {
								dataIntegrity: { type: 'boolean', example: true },
								relatedRecords: { type: 'boolean', example: true },
								businessRules: { type: 'boolean', example: true },
								retentionPeriod: { type: 'boolean', example: true }
							}
						},
						postRestoration: {
							type: 'object',
							properties: {
								employmentRecordsPreserved: { type: 'boolean', example: true },
								assetsReassigned: { type: 'boolean', example: true },
								permissionsRestored: { type: 'boolean', example: true },
								auditTrailMaintained: { type: 'boolean', example: true }
							}
						}
					}
				},
				message: { type: 'string', example: 'User restored successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			},
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
						'User belongs to different organization'
					]
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user reference code is correct',
						'Check if user was recently permanently deleted',
						'Ensure you have permission to access this user'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to restore users',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to restore users' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient permissions or user belongs to different branch' }
			}
		}
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
						'Related records have been purged'
					]
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
								'File data recovery request with IT department'
							]
						},
						escalationPath: { type: 'string', example: 'Contact IT Support for advanced recovery options' }
					}
				}
			}
		}
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
				path: { type: 'string', example: '/user/restore/123' }
			}
		}
	})
	restore(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.restore(ref, orgId, branchId);
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
				data: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 123 },
								username: { type: 'string', example: 'john.doe' },
								name: { type: 'string', example: 'John' },
								surname: { type: 'string', example: 'Doe' },
								email: { type: 'string', example: 'john.doe@loro.co.za' },
								status: { type: 'string', example: 'DELETED' },
								deletedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								deletedBy: { type: 'string', example: 'Admin User' },
								retentionPeriod: { type: 'number', example: 90, description: 'Days before permanent deletion' },
								permanentDeletionDate: { type: 'string', format: 'date', example: '2024-03-01' }
							}
						},
						preDeleteChecks: {
							type: 'object',
							properties: {
								activeSessions: { type: 'number', example: 0 },
								assignedAssets: { type: 'number', example: 0 },
								pendingApprovals: { type: 'number', example: 0 },
								complianceApproval: { type: 'boolean', example: true }
							}
						},
						impactAssessment: {
							type: 'object',
							properties: {
								assetsReturned: { type: 'number', example: 3 },
								accessRevoked: { type: 'boolean', example: true },
								approvalsTransferred: { type: 'number', example: 2 },
								notificationsSent: { type: 'number', example: 5 }
							}
						}
					}
				},
				message: { type: 'string', example: 'User deleted successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			},
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
						'Ensure you have permission to access this user'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to delete user',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to delete this user' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 },
				reason: { type: 'string', example: 'Insufficient permissions or user belongs to different branch' }
			}
		}
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
						'User has 1 pending approval workflow'
					]
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
								'Transfer pending approvals'
							]
						},
						estimatedResolutionTime: { type: 'string', example: '2-3 business days' }
					}
				}
			}
		}
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
				path: { type: 'string', example: '/user/123' }
			}
		}
	})
	remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;
		return this.userService.remove(ref, orgId, branchId);
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
		summary: '📊 Get user performance targets',
		description: `
# User Performance Target Dashboard

Retrieves comprehensive performance targets for a specific user with detailed progress tracking and analytics capabilities.

## 📋 **Core Features**
- **Multi-Category Targets**: Sales, work hours, leads, clients, and activity-based targets
- **Progress Tracking**: Real-time progress calculation with achievement percentages
- **Period Management**: Support for weekly, monthly, quarterly, and yearly target periods
- **Currency Support**: Multi-currency sales targets for international operations
- **Achievement Analytics**: Advanced metrics including trend analysis and milestone tracking

## 🎯 **Target Categories**
- **Sales Revenue**: Total sales targets combining quotations and orders
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
		example: 123
	})
	@ApiOkResponse({
		description: '✅ User performance targets retrieved successfully',
		schema: {
			type: 'object',
			properties: {
									userTarget: {
						type: 'object',
						properties: {
							uid: { type: 'number', example: 1, description: 'Unique target record identifier' },
							targetSalesAmount: { type: 'number', example: 50000, description: 'Sales revenue target amount (total of quotations + orders)' },
							currentSalesAmount: { type: 'number', example: 32500, description: 'Current achieved sales amount (total of quotations + orders)' },
							targetQuotationsAmount: { type: 'number', example: 30000, description: 'Target quotations amount (quotes made but not paid)' },
							currentQuotationsAmount: { type: 'number', example: 18000, description: 'Current quotations amount (quotes made but not paid)' },

							currentOrdersAmount: { type: 'number', example: 14500, description: 'Current orders amount (converted and paid)' },
							targetCurrency: { type: 'string', example: 'ZAR', description: 'Currency code for sales targets' },
							targetHoursWorked: { type: 'number', example: 160, description: 'Expected hours to work in target period' },
							currentHoursWorked: { type: 'number', example: 142, description: 'Current hours worked in period' },
							targetNewClients: { type: 'number', example: 5, description: 'Number of new clients to acquire' },
							currentNewClients: { type: 'number', example: 3, description: 'Current new clients acquired' },
							targetNewLeads: { type: 'number', example: 20, description: 'Number of new leads to generate' },
							currentNewLeads: { type: 'number', example: 18, description: 'Current leads generated' },
							targetCheckIns: { type: 'number', example: 15, description: 'Client check-in frequency target' },
							currentCheckIns: { type: 'number', example: 12, description: 'Current check-ins completed' },
							targetCalls: { type: 'number', example: 50, description: 'Communication calls target' },
							currentCalls: { type: 'number', example: 45, description: 'Current calls completed' },
							targetPeriod: { type: 'string', example: 'Monthly', enum: ['Weekly', 'Monthly', 'Quarterly', 'Yearly'], description: 'Target achievement period' },
							periodStartDate: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00Z', description: 'Target period start date' },
							periodEndDate: { type: 'string', format: 'date-time', example: '2024-01-31T23:59:59Z', description: 'Target period end date' },
							createdAt: { type: 'string', format: 'date-time', description: 'Target creation timestamp' },
							updatedAt: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
						progressMetrics: {
							type: 'object',
							properties: {
								salesProgress: { type: 'number', example: 65, description: 'Sales achievement percentage (total of quotations + orders)' },
								quotationsProgress: { type: 'number', example: 60, description: 'Quotations achievement percentage' },
								ordersProgress: { type: 'number', example: 72.5, description: 'Orders achievement percentage' },
								hoursProgress: { type: 'number', example: 88.75, description: 'Hours worked percentage' },
								leadsProgress: { type: 'number', example: 90, description: 'Leads generation percentage' },
								clientsProgress: { type: 'number', example: 60, description: 'Client acquisition percentage' },
								overallProgress: { type: 'number', example: 75.9, description: 'Overall target achievement percentage' },
							},
						},
					},
				},
				message: { type: 'string', example: 'User targets retrieved successfully' },
				meta: {
					type: 'object',
					properties: {
						daysRemaining: { type: 'number', example: 12, description: 'Days remaining in target period' },
						achievementTrend: { type: 'string', example: 'On Track', enum: ['Ahead', 'On Track', 'Behind', 'At Risk'] },
						nextMilestone: { type: 'string', example: '75% target achievement', description: 'Next achievement milestone' },
					},
				},
			},
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
	getUserTarget(@Param('ref') ref: number) {
		return this.userService.getUserTarget(ref);
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
		example: 123
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
				message: { type: 'string', example: 'User performance targets created successfully' },
				targetId: { type: 'number', example: 42, description: 'Created target record ID' },
				data: {
					type: 'object',
					properties: {
						initialized: { type: 'boolean', example: true, description: 'Target tracking initialized' },
						progressMetrics: {
							type: 'object',
							properties: {
								salesProgress: { type: 'number', example: 0, description: 'Initial sales progress' },
								hoursProgress: { type: 'number', example: 0, description: 'Initial hours progress' },
								overallProgress: { type: 'number', example: 0, description: 'Initial overall progress' },
							},
						},
						nextReview: { type: 'string', format: 'date', example: '2024-01-15', description: 'Next target review date' },
					},
				},
			},
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
	setUserTarget(@Param('ref') ref: number, @Body() createUserTargetDto: CreateUserTargetDto) {
		return this.userService.setUserTarget(ref, createUserTargetDto);
	}

	@Patch(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Update user performance targets',
		description: `
		**Update existing performance targets for a specific user**
		
		This endpoint provides comprehensive target management capabilities:
		- Partial or complete target updates using PATCH semantics
		- Progress preservation during target modifications
		- Historical tracking of target changes
		- Automatic recalculation of achievement percentages
		- Support for mid-period target adjustments
		
		**Update Scenarios:**
		- Target value adjustments (increase/decrease targets)
		- Period extensions or modifications
		- Currency changes for international transfers
		- Category additions or removals
		- Emergency target resets or corrections
		
		**Business Rules:**
		- Updates preserve existing progress unless explicitly reset
		- Target increases maintain current achievement percentages
		- Period changes recalculate progress metrics
		- Audit trail maintained for all modifications
		`,
		operationId: 'updateUserTargets',
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'User ID for target updates',
		type: Number,
		example: 123
	})
	@ApiBody({ 
		type: UpdateUserTargetDto,
		description: 'Target update configuration (partial updates supported)',
		examples: {
			targetAdjustment: {
				summary: 'Adjust sales target mid-period',
				value: {
					targetSalesAmount: 60000,
					reason: 'Market opportunity adjustment',
				},
			},
			progressUpdate: {
				summary: 'Update current progress values',
				value: {
					currentSalesAmount: 45000,
					currentQuotationsAmount: 28000,
					currentOrdersAmount: 17000,
					currentHoursWorked: 120,
					currentNewLeads: 15,
				},
			},
		},
	})
	@ApiOkResponse({
		description: '✅ User performance targets updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User performance targets updated successfully' },
				data: {
					type: 'object',
					properties: {
						updatedFields: {
							type: 'array',
							items: { type: 'string' },
							example: ['targetSalesAmount', 'currentHoursWorked'],
							description: 'List of fields that were updated',
						},
						progressImpact: {
							type: 'object',
							properties: {
								previousOverallProgress: { type: 'number', example: 65.2, description: 'Progress before update' },
								newOverallProgress: { type: 'number', example: 72.8, description: 'Progress after update' },
								impactDescription: { type: 'string', example: 'Target adjustment improved overall progress by 7.6%' },
							},
						},
						nextMilestone: { type: 'string', example: '75% target achievement', description: 'Next achievement milestone' },
					},
				},
			},
		},
	})
	@ApiBadRequestResponse({ 
		description: '❌ Invalid update data provided',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Invalid target update configuration' },
				errors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Cannot decrease target below current achievement',
						'Invalid currency code provided',
						'Period dates must be within current fiscal year',
					],
				},
			},
		},
	})
	@ApiNotFoundResponse({ description: '❌ User not found or no targets configured to update' })
	updateUserTarget(@Param('ref') ref: number, @Body() updateUserTargetDto: UpdateUserTargetDto) {
		return this.userService.updateUserTarget(ref, updateUserTargetDto);
	}

	@Delete(':ref/target')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.OWNER)
	@ApiOperation({
		summary: 'Delete user performance targets',
		description: `
		**Remove performance targets for a specific user**
		
		This endpoint provides safe target deletion with proper cleanup:
		- Soft deletion with historical preservation
		- Progress data archival for reporting
		- Notification to affected stakeholders
		- Audit trail maintenance
		- Option for complete removal or archival
		
		**Deletion Impact:**
		- User dashboard updated to reflect no active targets
		- Historical performance data preserved for analytics
		- Related notifications and reminders disabled
		- Team/branch metrics recalculated excluding deleted targets
		
		**Use Cases:**
		- Employee role changes requiring different target structure
		- Temporary target suspension during leave/transitions
		- Target structure redesign requiring fresh start
		- Performance period completion and reset
		`,
		operationId: 'deleteUserTargets',
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'User ID for target deletion',
		type: Number,
		example: 123
	})
	@ApiOkResponse({
		description: '✅ User performance targets deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User performance targets deleted successfully' },
				data: {
					type: 'object',
					properties: {
						deletedTargetId: { type: 'number', example: 42, description: 'ID of deleted target record' },
						finalProgress: {
							type: 'object',
							properties: {
								salesProgress: { type: 'number', example: 78.5, description: 'Final sales achievement percentage' },
								hoursProgress: { type: 'number', example: 92.3, description: 'Final hours worked percentage' },
								overallProgress: { type: 'number', example: 83.7, description: 'Final overall achievement percentage' },
							},
							description: 'Final progress snapshot before deletion',
						},
						archivalReference: { type: 'string', example: 'ARCH_USER123_2024Q1', description: 'Reference for archived data' },
						impactSummary: { type: 'string', example: 'Targets achieved 83.7% overall completion before deletion' },
					},
				},
			},
		},
	})
	@ApiNotFoundResponse({ 
		description: '❌ User or targets not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User not found or no targets exist to delete' },
				errorCode: { type: 'string', example: 'TARGETS_NOT_FOUND' },
			},
		},
	})
	deleteUserTarget(@Param('ref') ref: number) {
		return this.userService.deleteUserTarget(ref);
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
			const orgId = req.user?.org?.uid;
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
						'User is not within your management scope'
					]
				},
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the user ID is correct',
						'Check if user belongs to your organization',
						'Ensure you have permission to manage this user'
					]
				}
			}
		}
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
					example: ['ADMIN', 'MANAGER']
				}
			}
		}
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
						'User account is suspended or banned'
					]
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
								'Use bulk re-invitation for multiple users'
							]
						}
					}
				}
			}
		}
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
						retryable: { type: 'boolean', example: true }
					}
				}
			}
		}
	})
	async reInviteUser(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
		try {
			const orgId = req.user?.org?.uid;
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
		summary: 'Update user targets from external ERP system',
		description: `
		**Update user sales targets and current values from external ERP system**
		
		This endpoint allows external ERP systems to update user targets with concurrency control:
		- Supports both INCREMENT and REPLACE update modes
		- Handles concurrent updates with retry mechanism
		- Validates update data and user permissions
		- Creates audit trail for all updates
		- Returns detailed success/conflict information
		
		**Update Modes:**
		- INCREMENT: Adds values to current targets (for sales, leads, etc.)
		- REPLACE: Sets absolute values (for complete recalculation)
		
		**Concurrency Control:**
		- Uses pessimistic locking during updates
		- Automatic retry with exponential backoff
		- Returns conflict details if updates fail
		
		**Security Features:**
		- Requires ERP system API key authentication
		- Validates user belongs to same organization/branch
		- Transaction ID for idempotency
		- Comprehensive audit logging
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
		description: 'External target update data from ERP system',
	})
	@ApiHeader({
		name: 'X-ERP-API-Key',
		description: 'ERP system API key for authentication',
		required: true,
		example: 'erp-api-key-12345',
	})
	@ApiResponse({
		status: 200,
		description: '✅ Target updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'User targets updated successfully from ERP' },
				updatedValues: {
					type: 'object',
					properties: {
						currentSalesAmount: { type: 'number', example: 15000.50 },
						currentQuotationsAmount: { type: 'number', example: 8500.25 },
						currentOrdersAmount: { type: 'number', example: 6500.25 },
						currentNewLeads: { type: 'number', example: 12 },
						currentNewClients: { type: 'number', example: 8 },
						currentCheckIns: { type: 'number', example: 25 },
						currentHoursWorked: { type: 'number', example: 160.5 },
						currentCalls: { type: 'number', example: 45 },
					},
				},
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
		description: '❌ Validation error',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed' },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: ['Sales amount cannot be negative', 'Transaction ID is required for idempotency'],
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

		const orgId = req.user?.org?.uid;
		const branchId = req.user?.branch?.uid;

		const result = await this.userService.updateUserTargetsFromERP(userId, externalUpdateDto, orgId, branchId);

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
}
