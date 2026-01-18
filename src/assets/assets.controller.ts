import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AuthenticatedRequest } from '../lib/interfaces/authenticated-request.interface';
import { 
  ApiBearerAuth, 
  ApiOperation, 
  ApiTags, 
  ApiParam, 
  ApiBody, 
  ApiOkResponse, 
  ApiCreatedResponse, 
  ApiBadRequestResponse, 
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiUnprocessableEntityResponse,
  ApiInternalServerErrorResponse,
  ApiServiceUnavailableResponse,
  ApiConsumes,
  ApiProduces
} from '@nestjs/swagger';
import { getDynamicDate, getDynamicDateTime, getFutureDate, getPastDate, createApiDescription } from '../lib/utils/swagger-helpers';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { AccessLevel } from '../lib/enums/user.enums';
import { Roles } from '../decorators/role.decorator';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { Asset } from './entities/asset.entity';

@ApiBearerAuth('JWT-auth')
@ApiTags('📦 Assets')
@Controller('assets')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('assets')
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
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService
  ) { }

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
    summary: '➕ Create a new asset',
    description: createApiDescription(
      'Creates a new asset in the system with comprehensive tracking capabilities.',
      'The service method `AssetsService.create()` processes the asset creation, generates a unique asset reference, validates asset data, assigns the asset if specified, and returns the created asset with its reference number.',
      'AssetsService',
      'create',
      'creates a new asset, generates asset reference, validates data, and handles assignment',
      'an object containing the created asset data, asset reference, and status',
      ['Asset reference generation', 'Data validation', 'Assignment handling', 'Location tracking'],
    ) + `

# Create Asset

Creates a new asset in the system with comprehensive tracking capabilities.

## 📋 **Use Cases**
- **IT Equipment**: Add laptops, servers, networking equipment
- **Office Assets**: Track furniture, printers, office supplies
- **Vehicle Fleet**: Register company vehicles with GPS tracking
- **Construction Equipment**: Monitor heavy machinery and tools
- **Medical Equipment**: Track medical devices and instruments

## 🔧 **Features**
- Automatic asset tagging and reference generation
- Location-based asset tracking
- Depreciation calculation support
- Asset assignment to users or departments
- Maintenance scheduling integration

## 📝 **Required Fields**
- Asset name and description
- Category and type classification
- Purchase/acquisition details
- Current location and status
    `
  })
  @ApiBody({ 
    type: CreateAssetDto,
    description: 'Asset creation payload with all required information',
    examples: {
      laptop: {
        summary: '💻 IT Equipment - Laptop',
        description: 'Example of creating a laptop asset',
        value: {
          name: 'Dell Latitude 7420',
          description: 'Business laptop for software development',
          category: 'IT_EQUIPMENT',
          type: 'LAPTOP',
          brand: 'Dell',
          model: 'Latitude 7420',
          serialNumber: `DL7420-${new Date().getFullYear()}-001`,
          purchaseDate: getPastDate(30),
          purchasePrice: 1299.99,
          warrantyExpiry: getFutureDate(1095),
          condition: 'NEW',
          location: 'IT Department',
          assignedToUserId: 42
        }
      },
      vehicle: {
        summary: '🚗 Vehicle Fleet - Company Car',
        description: 'Example of creating a company vehicle asset',
        value: {
          name: `Toyota Camry ${new Date().getFullYear()}`,
          description: 'Company sedan for sales team',
          category: 'VEHICLE',
          type: 'SEDAN',
          brand: 'Toyota',
          model: 'Camry',
          serialNumber: `TC${new Date().getFullYear()}-VIN123456`,
          registrationNumber: 'ABC-123-GP',
          purchaseDate: getPastDate(90),
          purchasePrice: 35000.00,
          warrantyExpiry: getFutureDate(1095),
          condition: 'EXCELLENT',
          location: 'Main Office Parking',
          assignedToUserId: 15
        }
      }
    }
  })
  @ApiCreatedResponse({ 
    description: '✅ Asset created successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset created successfully' },
        data: {
          type: 'object',
          properties: {
            uid: { type: 'number', example: 12345 },
            assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
            name: { type: 'string', example: 'Dell Latitude 7420' },
            category: { type: 'string', example: 'IT_EQUIPMENT' },
            status: { type: 'string', example: 'ACTIVE' },
            createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ 
    description: '❌ Bad Request - Invalid or missing required data',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Validation failed: Asset name is required' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
        details: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Asset name must be between 3 and 100 characters',
            'Serial number must be unique',
            'Purchase price must be a positive number'
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
        message: { type: 'string', example: 'You do not have permission to create assets in this branch' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 }
      }
    }
  })
  @ApiConflictResponse({
    description: '⚠️ Conflict - Asset already exists',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset with serial number DL7420-2023-001 already exists' },
        error: { type: 'string', example: 'Conflict' },
        statusCode: { type: 'number', example: 409 },
        conflictingAsset: {
          type: 'object',
          properties: {
            uid: { type: 'number', example: 9876 },
            name: { type: 'string', example: 'Dell Latitude 7420' },
            serialNumber: { type: 'string', example: 'DL7420-2023-001' }
          }
        }
      }
    }
  })
  @ApiUnprocessableEntityResponse({
    description: '📝 Unprocessable Entity - Business logic validation failed',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Cannot assign asset to inactive user' },
        error: { type: 'string', example: 'Unprocessable Entity' },
        statusCode: { type: 'number', example: 422 },
        validationErrors: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Assigned user must be active',
            'Asset category does not support GPS tracking',
            'Warranty expiry date cannot be in the past'
          ]
        }
      }
    }
  })
  @ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - System malfunction',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to create asset due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets' }
      }
    }
  })
  @ApiServiceUnavailableResponse({
    description: '🔧 Service Unavailable - System maintenance or overload',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset service is temporarily unavailable' },
        error: { type: 'string', example: 'Service Unavailable' },
        statusCode: { type: 'number', example: 503 },
        retryAfter: { type: 'number', example: 300 }
      }
    }
  })
  create(@Body() createAssetDto: CreateAssetDto, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.create(createAssetDto, orgId, branchId);
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
    summary: '📋 Get all assets',
    description: `
# List All Assets

Retrieves a comprehensive list of all active assets in your organization.

## 📊 **Response Features**
- **Real-time Status**: Current location and assignment status
- **Financial Data**: Purchase price, depreciation, current value
- **Maintenance Info**: Warranty status, service history
- **Usage Analytics**: Assignment history, utilization metrics

## 🔍 **Filtering Options**
- Filter by category (IT, Vehicle, Office, etc.)
- Filter by condition (New, Good, Fair, Poor)
- Filter by assignment status (Assigned, Available, Maintenance)
- Filter by location or branch

## 📈 **Business Intelligence**
- Asset utilization rates
- Depreciation tracking
- Maintenance cost analysis
- Replacement planning insights
    `
  })
  @ApiOkResponse({
    description: '✅ Assets retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            assets: {
              type: 'array',
              items: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 12345 },
                  assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                  name: { type: 'string', example: 'Dell Latitude 7420' },
                  description: { type: 'string', example: 'Business laptop for software development' },
                  category: { type: 'string', example: 'IT_EQUIPMENT' },
                  type: { type: 'string', example: 'LAPTOP' },
                  brand: { type: 'string', example: 'Dell' },
                  model: { type: 'string', example: 'Latitude 7420' },
                  serialNumber: { type: 'string', example: `DL7420-${new Date().getFullYear()}-001` },
                  condition: { type: 'string', example: 'EXCELLENT' },
                  status: { type: 'string', example: 'ASSIGNED' },
                  location: { type: 'string', example: 'IT Department' },
                  purchasePrice: { type: 'number', example: 1299.99 },
                  currentValue: { type: 'number', example: 899.99 },
                  warrantyExpiry: { type: 'string', format: 'date', example: '2026-01-15' },
                  assignedUser: {
                    type: 'object',
                    properties: {
                      uid: { type: 'number', example: 42 },
                      name: { type: 'string', example: 'John Doe' },
                      email: { type: 'string', example: 'john.doe@loro.co.za' }
                    }
                  },
                  createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                  lastServiceDate: { type: 'string', format: 'date', example: '2023-11-15' }
                }
              }
            },
            summary: {
              type: 'object',
              properties: {
                totalAssets: { type: 'number', example: 156 },
                totalValue: { type: 'number', example: 125000.00 },
                byCategory: {
                  type: 'object',
                  properties: {
                    IT_EQUIPMENT: { type: 'number', example: 45 },
                    VEHICLES: { type: 'number', example: 12 },
                    OFFICE_FURNITURE: { type: 'number', example: 89 },
                    MACHINERY: { type: 'number', example: 10 }
                  }
                },
                byStatus: {
                  type: 'object',
                  properties: {
                    ASSIGNED: { type: 'number', example: 120 },
                    AVAILABLE: { type: 'number', example: 25 },
                    MAINTENANCE: { type: 'number', example: 8 },
                    RETIRED: { type: 'number', example: 3 }
                  }
                }
              }
            }
          }
        },
        message: { type: 'string', example: 'Assets retrieved successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - Insufficient permissions to view assets',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to view assets in this organization' },
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
        message: { type: 'string', example: 'Failed to retrieve assets due to database error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets' }
      }
    }
  })
  @ApiServiceUnavailableResponse({
    description: '🔧 Service Unavailable - Asset service temporarily down',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset service is temporarily unavailable for maintenance' },
        error: { type: 'string', example: 'Service Unavailable' },
        statusCode: { type: 'number', example: 503 },
        retryAfter: { type: 'number', example: 300 }
      }
    }
  })
  findAll(@Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.findAll(orgId, branchId);
  }

  @Get(':ref')
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
    summary: '🔍 Get asset by reference code',
    description: `
# Get Asset Details

Retrieves comprehensive information about a specific asset including its complete history and current status.

## 📊 **Detailed Information**
- **Asset Specifications**: Complete technical details and specifications
- **Financial Tracking**: Purchase price, depreciation, current market value
- **Assignment History**: Complete record of all assignments and transfers
- **Maintenance Records**: Service history, warranties, and upcoming maintenance
- **Location Tracking**: Current location and movement history
- **Usage Analytics**: Utilization metrics and performance data

## 🔧 **Use Cases**
- **Asset Auditing**: Verify asset details for compliance audits
- **Maintenance Planning**: Check warranty status and service history
- **Financial Reporting**: Get current asset value for financial statements
- **Assignment Planning**: Check availability and current assignment status
- **Insurance Claims**: Retrieve detailed asset information for claims processing

## 📱 **Mobile Integration**
- QR code scanning for quick asset lookup
- GPS location verification
- Photo capture for condition assessment
    `
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Asset reference code or unique identifier',
    type: 'number',
    example: 12345
  })
  @ApiOkResponse({ 
    description: '✅ Asset details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            asset: { 
              type: 'object',
              properties: {
                uid: { type: 'number', example: 12345 },
                assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                name: { type: 'string', example: 'Dell Latitude 7420' },
                description: { type: 'string', example: 'Business laptop for software development' },
                category: { type: 'string', example: 'IT_EQUIPMENT' },
                type: { type: 'string', example: 'LAPTOP' },
                brand: { type: 'string', example: 'Dell' },
                model: { type: 'string', example: 'Latitude 7420' },
                serialNumber: { type: 'string', example: `DL7420-${new Date().getFullYear()}-001` },
                condition: { type: 'string', example: 'EXCELLENT' },
                status: { type: 'string', example: 'ASSIGNED' },
                location: { type: 'string', example: 'IT Department' },
                purchaseDate: { type: 'string', format: 'date', example: '2023-01-15' },
                purchasePrice: { type: 'number', example: 1299.99 },
                currentValue: { type: 'number', example: 899.99 },
                depreciationRate: { type: 'number', example: 0.20 },
                warrantyExpiry: { type: 'string', format: 'date', example: '2026-01-15' },
                lastServiceDate: { type: 'string', format: 'date', example: '2023-11-15' },
                nextServiceDue: { type: 'string', format: 'date', example: '2024-05-15' },
                assignedUser: {
                  type: 'object',
                  properties: {
                    uid: { type: 'number', example: 42 },
                    name: { type: 'string', example: 'John Doe' },
                    email: { type: 'string', example: 'john.doe@loro.co.za' },
                    department: { type: 'string', example: 'Engineering' },
                    assignedDate: { type: 'string', format: 'date', example: '2023-01-20' }
                  }
                },
                specifications: {
                  type: 'object',
                  properties: {
                    processor: { type: 'string', example: 'Intel Core i7-1185G7' },
                    memory: { type: 'string', example: '16GB DDR4' },
                    storage: { type: 'string', example: '512GB SSD' },
                    display: { type: 'string', example: '14" FHD' },
                    os: { type: 'string', example: 'Windows 11 Pro' }
                  }
                },
                maintenanceHistory: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string', format: 'date', example: '2023-11-15' },
                      type: { type: 'string', example: 'ROUTINE_MAINTENANCE' },
                      description: { type: 'string', example: 'Software updates and system cleanup' },
                      cost: { type: 'number', example: 0.00 },
                      technician: { type: 'string', example: 'IT Support Team' }
                    }
                  }
                },
                assignmentHistory: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      userId: { type: 'number', example: 42 },
                      userName: { type: 'string', example: 'John Doe' },
                      assignedDate: { type: 'string', format: 'date', example: '2023-01-20' },
                      returnedDate: { type: 'string', format: 'date', example: null },
                      reason: { type: 'string', example: 'New employee setup' }
                    }
                  }
                },
                createdAt: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
                updatedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
              }
            }
          }
        },
        message: { type: 'string', example: 'Asset details retrieved successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: '🔍 Asset not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset with reference code 12345 not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Verify the asset reference code is correct',
            'Check if the asset has been deleted or archived',
            'Ensure you have permission to access this asset'
          ]
        }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - No access to this asset',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to view this asset' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 },
        reason: { type: 'string', example: 'Asset belongs to different branch/organization' }
      }
    }
  })
  @ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - Failed to retrieve asset',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to retrieve asset details due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets/12345' }
      }
    }
  })
  findOne(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.findOne(ref, orgId, branchId);
  }

  @Get('/search/:query')
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
    summary: '🔍 Search assets by term',
    description: `
# Asset Search Engine

Advanced search functionality to quickly locate assets using various criteria.

## 🔍 **Search Capabilities**
- **Brand Search**: Find assets by manufacturer (Dell, HP, Toyota, etc.)
- **Model Search**: Search by specific model numbers and variants
- **Serial Number**: Exact match search for serial numbers
- **Asset Name**: Partial matching on asset names and descriptions
- **Category Filter**: Filter by asset categories (IT, Vehicle, Office, etc.)
- **Location Search**: Find assets by current location or branch

## 🚀 **Advanced Features**
- **Fuzzy Matching**: Intelligent search that handles typos and variations
- **Partial Matching**: Search with incomplete information
- **Wildcard Support**: Use * and ? for pattern matching
- **Search History**: Recent searches for quick access
- **Smart Suggestions**: Auto-complete based on existing assets

## 📊 **Search Analytics**
- **Popular Searches**: Most frequently searched terms
- **Search Performance**: Response time and result relevance
- **Usage Patterns**: Peak search times and user behavior

## 🔧 **Use Cases**
- **Inventory Audits**: Quickly locate specific assets during audits
- **Maintenance Planning**: Find assets due for service
- **Asset Recovery**: Locate missing or misplaced assets
- **Purchasing Decisions**: Check existing inventory before new purchases
- **Compliance Reports**: Generate reports for regulatory compliance
    `
  })
  @ApiParam({ 
    name: 'query', 
    description: 'Search term - can be brand, model, serial number, or asset name',
    type: 'string',
    example: 'Dell Latitude'
  })
  @ApiOkResponse({ 
    description: '✅ Search results retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            assets: {
              type: 'array',
              items: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 12345 },
                  assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                  name: { type: 'string', example: 'Dell Latitude 7420' },
                  description: { type: 'string', example: 'Business laptop for software development' },
                  category: { type: 'string', example: 'IT_EQUIPMENT' },
                  brand: { type: 'string', example: 'Dell' },
                  model: { type: 'string', example: 'Latitude 7420' },
                  serialNumber: { type: 'string', example: `DL7420-${new Date().getFullYear()}-001` },
                  condition: { type: 'string', example: 'EXCELLENT' },
                  status: { type: 'string', example: 'ASSIGNED' },
                  location: { type: 'string', example: 'IT Department' },
                  purchasePrice: { type: 'number', example: 1299.99 },
                  matchScore: { type: 'number', example: 0.95, description: 'Search relevance score (0-1)' },
                  matchReasons: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['Brand match: Dell', 'Model match: Latitude']
                  },
                  assignedUser: {
                    type: 'object',
                    properties: {
                      uid: { type: 'number', example: 42 },
                      name: { type: 'string', example: 'John Doe' }
                    }
                  }
                }
              }
            },
            searchMetadata: {
              type: 'object',
              properties: {
                query: { type: 'string', example: 'Dell Latitude' },
                totalResults: { type: 'number', example: 15 },
                searchTime: { type: 'number', example: 0.045, description: 'Search execution time in seconds' },
                suggestions: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['Dell Inspiron', 'HP Latitude', 'Dell Precision']
                },
                filters: {
                  type: 'object',
                  properties: {
                    availableCategories: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['IT_EQUIPMENT', 'OFFICE_FURNITURE']
                    },
                    availableLocations: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['IT Department', 'Marketing Office']
                    }
                  }
                }
              }
            }
          }
        },
        message: { type: 'string', example: 'Search completed successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiBadRequestResponse({
    description: '❌ Bad Request - Invalid search query',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Search query must be at least 2 characters long' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
        constraints: {
          type: 'object',
          properties: {
            minLength: { type: 'number', example: 2 },
            maxLength: { type: 'number', example: 100 },
            allowedCharacters: { type: 'string', example: 'Letters, numbers, spaces, and common symbols' }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: '🔍 No assets found matching search criteria',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'No assets found matching "Dell Latitude XYZ"' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Try a broader search term',
            'Check for typos in your search',
            'Use partial model numbers',
            'Search by category instead'
          ]
        },
        alternativeResults: {
          type: 'array',
          items: { type: 'string' },
          example: ['Dell Inspiron', 'HP Latitude', 'Dell Precision']
        }
      }
    }
  })
  @ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - Search service failure',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Search service temporarily unavailable' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets/search/Dell+Latitude' }
      }
    }
  })
  findBySearchTerm(@Param('query') query: string, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.findBySearchTerm(query, orgId, branchId);
  }

  @Get('for/:ref')
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
    summary: '👤 Get assets by user',
    description: `
# User Asset Portfolio

Retrieves all assets currently assigned to a specific user, providing a comprehensive view of their asset portfolio.

## 📊 **Portfolio Overview**
- **Current Assignments**: All assets currently assigned to the user
- **Assignment History**: Complete history of past asset assignments
- **Responsibility Status**: Current responsibility and accountability details
- **Usage Analytics**: Asset utilization and performance metrics
- **Compliance Status**: Asset compliance and policy adherence

## 🔧 **Asset Categories**
- **IT Equipment**: Laptops, desktops, mobile devices, accessories
- **Office Assets**: Furniture, equipment, supplies assigned to workspace
- **Vehicle Fleet**: Company vehicles assigned for business use
- **Tools & Equipment**: Specialized tools and machinery
- **Safety Equipment**: PPE and safety-related assets

## 📋 **Management Features**
- **Assignment Tracking**: When assets were assigned and by whom
- **Condition Monitoring**: Current condition and maintenance status
- **Value Tracking**: Total asset value under user's responsibility
- **Return Scheduling**: Upcoming return dates and requirements
- **Compliance Alerts**: Policy violations or required actions

## 🎯 **Use Cases**
- **Employee Onboarding**: Set up new employee with required assets
- **Asset Audits**: Verify assets assigned to specific employees
- **Responsibility Tracking**: Monitor asset custody and accountability
- **Offboarding**: Ensure all assets are returned when employees leave
- **Expense Management**: Track asset-related costs per employee
    `
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'User reference code or unique identifier',
    type: 'number',
    example: 42
  })
  @ApiOkResponse({ 
    description: '✅ User assets retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                uid: { type: 'number', example: 42 },
                name: { type: 'string', example: 'John Doe' },
                email: { type: 'string', example: 'john.doe@loro.co.za' },
                department: { type: 'string', example: 'Engineering' },
                employeeId: { type: 'string', example: 'EMP-2023-042' }
              }
            },
            assets: {
              type: 'array',
              items: { 
                type: 'object',
                properties: {
                  uid: { type: 'number', example: 12345 },
                  assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                  name: { type: 'string', example: 'Dell Latitude 7420' },
                  description: { type: 'string', example: 'Business laptop for software development' },
                  category: { type: 'string', example: 'IT_EQUIPMENT' },
                  brand: { type: 'string', example: 'Dell' },
                  model: { type: 'string', example: 'Latitude 7420' },
                  serialNumber: { type: 'string', example: `DL7420-${new Date().getFullYear()}-001` },
                  condition: { type: 'string', example: 'EXCELLENT' },
                  status: { type: 'string', example: 'ASSIGNED' },
                  location: { type: 'string', example: 'IT Department' },
                  purchasePrice: { type: 'number', example: 1299.99 },
                  currentValue: { type: 'number', example: 899.99 },
                  assignedDate: { type: 'string', format: 'date', example: '2023-01-20' },
                  assignedBy: { type: 'string', example: 'IT Administrator' },
                  assignmentReason: { type: 'string', example: 'New employee setup' },
                  returnDueDate: { type: 'string', format: 'date', example: null },
                  lastServiceDate: { type: 'string', format: 'date', example: '2023-11-15' },
                  nextServiceDue: { type: 'string', format: 'date', example: '2024-05-15' },
                  warrantyExpiry: { type: 'string', format: 'date', example: '2026-01-15' },
                  usageMetrics: {
                    type: 'object',
                    properties: {
                      dailyUsageHours: { type: 'number', example: 8.5 },
                      utilizationRate: { type: 'number', example: 0.85 },
                      lastActiveDate: { type: 'string', format: 'date', example: '2023-11-30' }
                    }
                  },
                  complianceStatus: {
                    type: 'object',
                    properties: {
                      policyCompliant: { type: 'boolean', example: true },
                      securityCompliant: { type: 'boolean', example: true },
                      maintenanceCompliant: { type: 'boolean', example: true },
                      lastComplianceCheck: { type: 'string', format: 'date', example: '2023-11-15' }
                    }
                  }
                }
              }
            },
            portfolio: {
              type: 'object',
              properties: {
                totalAssets: { type: 'number', example: 5 },
                totalValue: { type: 'number', example: 15299.95 },
                byCategory: {
                  type: 'object',
                  properties: {
                    IT_EQUIPMENT: { type: 'number', example: 3 },
                    OFFICE_FURNITURE: { type: 'number', example: 2 }
                  }
                },
                byCondition: {
                  type: 'object',
                  properties: {
                    EXCELLENT: { type: 'number', example: 3 },
                    GOOD: { type: 'number', example: 2 }
                  }
                },
                upcomingReturns: { type: 'number', example: 0 },
                maintenanceDue: { type: 'number', example: 1 }
              }
            }
          }
        },
        message: { type: 'string', example: 'User assets retrieved successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiNotFoundResponse({
    description: '🔍 User not found or no assets assigned',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'User with reference code 42 not found or has no assets assigned' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Verify the user reference code is correct',
            'Check if the user exists in the system',
            'Confirm the user has assets assigned to them'
          ]
        }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - No permission to view user assets',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to view assets for this user' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 },
        reason: { type: 'string', example: 'User belongs to different branch or insufficient permissions' }
      }
    }
  })
  @ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - Failed to retrieve user assets',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to retrieve user assets due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets/for/42' }
      }
    }
  })
  assetsByUser(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.assetsByUser(ref, orgId, branchId);
  }

  @Patch(':ref')
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
    summary: '✏️ Update an asset',
    description: `
# Update Asset Information

Updates an existing asset with new information while maintaining complete audit trail.

## 🔄 **Supported Updates**
- **Basic Information**: Name, description, category, type
- **Technical Details**: Specifications, model, serial number
- **Financial Data**: Purchase price, depreciation, current value
- **Assignment**: Change user assignment or location
- **Maintenance**: Update service records and warranty information
- **Status Changes**: Active, maintenance, retired, etc.

## 🔒 **Security Features**
- **Audit Trail**: All changes are logged with user and timestamp
- **Permission Checks**: Updates require appropriate access levels
- **Validation**: Business rules prevent invalid state changes
- **Rollback**: Previous versions are preserved for recovery

## 📋 **Common Use Cases**
- **Asset Reassignment**: Transfer asset to different user/department
- **Condition Updates**: Update asset condition after inspection
- **Location Changes**: Update asset location or branch
- **Maintenance Records**: Add service history and warranty updates
- **Value Adjustments**: Update depreciation or market value
    `
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Asset reference code or unique identifier',
    type: 'number',
    example: 12345
  })
  @ApiBody({ 
    type: UpdateAssetDto,
    description: 'Asset update payload with fields to modify',
    examples: {
      reassignment: {
        summary: '👤 User Reassignment',
        description: 'Transfer asset to different user',
        value: {
          assignedToUserId: 87,
          location: 'Marketing Department',
          notes: 'Transferred from IT to Marketing team'
        }
      },
      maintenance: {
        summary: '🔧 Maintenance Update',
        description: 'Update after maintenance service',
        value: {
          condition: 'GOOD',
          lastServiceDate: '2023-12-01',
          nextServiceDue: '2024-06-01',
          maintenanceNotes: 'Routine maintenance completed - battery replaced'
        }
      },
      depreciation: {
        summary: '💰 Value Adjustment',
        description: 'Update asset value and depreciation',
        value: {
          currentValue: 799.99,
          depreciationRate: 0.25,
          marketValue: 750.00,
          valuationDate: '2023-12-01'
        }
      }
    }
  })
  @ApiOkResponse({ 
    description: '✅ Asset updated successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            asset: {
              type: 'object',
              properties: {
                uid: { type: 'number', example: 12345 },
                assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                name: { type: 'string', example: 'Dell Latitude 7420' },
                updatedFields: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['assignedToUserId', 'location', 'lastServiceDate']
                },
                previousValues: {
                  type: 'object',
                  properties: {
                    assignedToUserId: { type: 'number', example: 42 },
                    location: { type: 'string', example: 'IT Department' }
                  }
                },
                updatedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
              }
            }
          }
        },
        message: { type: 'string', example: 'Asset updated successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: '🔍 Asset not found for update',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset with reference code 12345 not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Verify the asset reference code is correct',
            'Check if the asset has been deleted',
            'Ensure you have permission to access this asset'
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
        message: { type: 'string', example: 'Validation failed for asset update' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
        validationErrors: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Current value must be a positive number',
            'Assigned user ID does not exist',
            'Asset condition must be one of: NEW, EXCELLENT, GOOD, FAIR, POOR'
          ]
        }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - No permission to update asset',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to update this asset' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 },
        reason: { type: 'string', example: 'Asset belongs to different branch or insufficient role permissions' }
      }
    }
  })
  @ApiConflictResponse({
    description: '⚠️ Conflict - Update conflicts with current state',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Cannot update asset - asset is currently checked out for maintenance' },
        error: { type: 'string', example: 'Conflict' },
        statusCode: { type: 'number', example: 409 },
        currentState: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'MAINTENANCE' },
            assignedUser: { type: 'string', example: 'Maintenance Team' },
            expectedReturn: { type: 'string', format: 'date', example: '2023-12-15' }
          }
        }
      }
    }
  })
  @ApiInternalServerErrorResponse({
    description: '💥 Internal Server Error - Update failed',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Failed to update asset due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets/12345' }
      }
    }
  })
  update(@Param('ref') ref: number, @Body() updateAssetDto: UpdateAssetDto, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.update(ref, updateAssetDto, orgId, branchId);
  }

  @Patch('restore/:ref')
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
    summary: '🔄 Restore a deleted asset',
    description: `
# Asset Recovery System

Restores a previously deleted asset back to active status, maintaining data integrity and audit trails.

## 🔄 **Recovery Process**
- **Validation Checks**: Ensures asset is eligible for restoration
- **Data Integrity**: Validates all related records are consistent
- **Status Reset**: Returns asset to appropriate active status
- **Audit Trail**: Logs restoration action with user and timestamp
- **Notification System**: Alerts relevant stakeholders of restoration

## ⚠️ **Recovery Requirements**
- **Retention Period**: Asset must be within retention period (90 days default)
- **Data Consistency**: All related records must be intact
- **Permission Checks**: User must have restoration permissions
- **Business Rules**: Asset must meet business criteria for restoration

## 🔒 **Security Features**
- **Authorization**: Only authorized users can restore assets
- **Audit Logging**: Complete audit trail of restoration activity
- **Data Validation**: Ensures restored asset data is valid and consistent
- **Rollback Protection**: Prevents restoration if data integrity is compromised

## 📋 **Common Use Cases**
- **Accidental Deletion**: Recover assets deleted by mistake
- **Process Errors**: Restore assets deleted due to workflow errors
- **Data Recovery**: Recover assets lost during system issues
- **Compliance Needs**: Restore assets required for regulatory compliance
- **Business Continuity**: Quick recovery during critical business operations

## 🎯 **Post-Restoration**
- Asset returns to previous status (if valid) or default active status
- All assignments and maintenance records are preserved
- Financial records remain intact for continuity
- Location and ownership history is maintained
    `
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Asset reference code or unique identifier of deleted asset',
    type: 'number',
    example: 12345
  })
  @ApiOkResponse({ 
    description: '✅ Asset restored successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            asset: {
              type: 'object',
              properties: {
                uid: { type: 'number', example: 12345 },
                assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                name: { type: 'string', example: 'Dell Latitude 7420' },
                status: { type: 'string', example: 'AVAILABLE' },
                previousStatus: { type: 'string', example: 'DELETED' },
                deletedAt: { type: 'string', format: 'date-time', example: '2023-11-15T10:00:00Z' },
                restoredAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
                restoredBy: { type: 'string', example: 'Admin User' },
                daysDeleted: { type: 'number', example: 16, description: 'Number of days asset was deleted' },
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
                assignmentsPreserved: { type: 'number', example: 3 },
                maintenanceRecordsIntact: { type: 'boolean', example: true },
                financialDataConsistent: { type: 'boolean', example: true },
                locationHistoryMaintained: { type: 'boolean', example: true }
              }
            }
          }
        },
        message: { type: 'string', example: 'Asset restored successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: '🔍 Deleted asset not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Deleted asset with reference code 12345 not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
        reasons: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Asset was never deleted',
            'Asset has been permanently deleted',
            'Asset reference code is incorrect',
            'Asset belongs to different organization'
          ]
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Verify the asset reference code is correct',
            'Check if asset was recently permanently deleted',
            'Ensure you have permission to access this asset'
          ]
        }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - No permission to restore assets',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to restore assets' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 },
        reason: { type: 'string', example: 'Insufficient permissions or asset belongs to different branch' }
      }
    }
  })
  @ApiConflictResponse({
    description: '⚠️ Conflict - Asset cannot be restored',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Cannot restore asset - retention period has expired' },
        error: { type: 'string', example: 'Conflict' },
        statusCode: { type: 'number', example: 409 },
        conflicts: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Retention period expired 15 days ago',
            'Asset data has been archived',
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
        message: { type: 'string', example: 'Failed to restore asset due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets/restore/12345' }
      }
    }
  })
  restore(@Param('ref') ref: number) {
    return this.assetsService.restore(ref);
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
    summary: '🗑️ Soft delete an asset',
    description: `
# Soft Delete Asset

Marks an asset as deleted without permanently removing it from the database. This ensures data integrity and maintains audit trails.

## 🔒 **Safety Features**
- **Soft Delete**: Asset is marked as deleted but remains in database
- **Audit Trail**: Deletion is logged with user and timestamp
- **Recovery**: Deleted assets can be restored using restore endpoint
- **Data Integrity**: Related records (assignments, maintenance) are preserved

## ⚠️ **Pre-Delete Checks**
- **Assignment Status**: Cannot delete assigned assets (must be returned first)
- **Active Maintenance**: Cannot delete assets currently under maintenance
- **Financial Records**: Ensures all financial reconciliation is complete
- **Compliance**: Checks regulatory requirements for asset disposal

## 📋 **Common Use Cases**
- **Asset Retirement**: End-of-life asset disposal
- **Damage/Loss**: Asset lost or damaged beyond repair
- **Obsolete Equipment**: Technology refresh and equipment upgrades
- **Data Cleanup**: Archive old or unused assets
- **Compliance**: Regulatory requirement for asset disposal

## 🔄 **Recovery Process**
Use the restore endpoint to recover accidentally deleted assets within the retention period.
    `
  })
  @ApiParam({ 
    name: 'ref', 
    description: 'Asset reference code or unique identifier',
    type: 'number',
    example: 12345
  })
  @ApiOkResponse({ 
    description: '✅ Asset deleted successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            asset: {
              type: 'object',
              properties: {
                uid: { type: 'number', example: 12345 },
                assetRef: { type: 'string', example: `AST-${new Date().getFullYear()}-001` },
                name: { type: 'string', example: 'Dell Latitude 7420' },
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
                assignmentStatus: { type: 'string', example: 'AVAILABLE' },
                maintenanceStatus: { type: 'string', example: 'NONE' },
                financialReconciliation: { type: 'boolean', example: true },
                complianceApproval: { type: 'boolean', example: true }
              }
            }
          }
        },
        message: { type: 'string', example: 'Asset deleted successfully' },
        timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
      }
    }
  })
  @ApiNotFoundResponse({ 
    description: '🔍 Asset not found for deletion',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Asset with reference code 12345 not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Verify the asset reference code is correct',
            'Check if the asset has already been deleted',
            'Ensure you have permission to access this asset'
          ]
        }
      }
    }
  })
  @ApiForbiddenResponse({
    description: '🚫 Forbidden - No permission to delete asset',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'You do not have permission to delete this asset' },
        error: { type: 'string', example: 'Forbidden' },
        statusCode: { type: 'number', example: 403 },
        reason: { type: 'string', example: 'Insufficient permissions or asset belongs to different branch' }
      }
    }
  })
  @ApiConflictResponse({
    description: '⚠️ Conflict - Asset cannot be deleted',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Cannot delete asset - asset is currently assigned to user' },
        error: { type: 'string', example: 'Conflict' },
        statusCode: { type: 'number', example: 409 },
        blockingFactors: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'Asset is currently assigned to John Doe',
            'Active maintenance contract until 2024-06-01',
            'Pending financial reconciliation'
          ]
        },
        resolution: {
          type: 'object',
          properties: {
            requiredActions: {
              type: 'array',
              items: { type: 'string' },
              example: [
                'Return asset from current user',
                'Complete maintenance contract',
                'Finalize financial reconciliation'
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
        message: { type: 'string', example: 'Failed to delete asset due to system error' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 },
        timestamp: { type: 'string', format: 'date-time', example: getDynamicDateTime() },
        path: { type: 'string', example: '/assets/12345' }
      }
    }
  })
  remove(@Param('ref') ref: number, @Req() req: AuthenticatedRequest) {
    const orgId = req.user?.org?.uid;
    const branchId = req.user?.branch?.uid;
    return this.assetsService.remove(ref, orgId, branchId);
  }
}
