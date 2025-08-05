import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	Query,
	UseGuards,
	Request,
	DefaultValuePipe,
	ParseIntPipe,
	BadRequestException,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOperation,
	ApiTags,
	ApiQuery,
	ApiParam,
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
	ApiProduces,
	ApiBody,
} from '@nestjs/swagger';
import { CompetitorsService } from './competitors.service';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';
import { FilterCompetitorDto } from './dto/filter-competitor.dto';
import { Competitor } from './entities/competitor.entity';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';
import { PaginatedResponse } from '../lib/interfaces/paginated-response.interface';
import { CompetitorStatus } from '../lib/enums/competitor.enums';

@ApiBearerAuth('JWT-auth')
@ApiTags('⚡ Competitors')
@UseGuards(AuthGuard, RoleGuard)
@Controller('competitors')
@ApiConsumes('application/json')
@ApiProduces('application/json')
// @EnterpriseOnly('competitors')
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
export class CompetitorsController {
	constructor(private readonly competitorsService: CompetitorsService) {}

	// Helper method to safely extract and validate numeric values
	private safeNumericExtraction(value: any): number | undefined {
		if (value === undefined || value === null || value === '') {
			return undefined;
		}

		const numValue = Number(value);
		
		if (isNaN(numValue) || !isFinite(numValue)) {
			return undefined;
		}

		return numValue;
	}

	// Helper method to safely extract org and branch IDs from JWT
	private extractOrgAndBranchIds(req: any): { orgId?: number; branchId?: number } {
		const orgIdRaw = req.user?.org?.uid || req.user?.organisation?.uid || req.organization?.ref;
		const branchIdRaw = req.user?.branch?.uid || req.branch?.uid;

		return {
			orgId: this.safeNumericExtraction(orgIdRaw),
			branchId: this.safeNumericExtraction(branchIdRaw),
		};
	}

	@Post()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: '➕ Create a new competitor',
		description: `
# Create Competitor Profile

Creates a comprehensive competitor profile with detailed intelligence tracking capabilities.

## 📋 **Use Cases**
- **Market Intelligence**: Track direct and indirect competitors
- **Competitive Analysis**: Monitor competitor strategies and positioning
- **Threat Assessment**: Evaluate competitive threats and market position
- **Sales Strategy**: Develop counter-strategies and competitive responses
- **Market Research**: Build comprehensive competitor database

## 🔧 **Features**
- Automatic competitor reference generation
- Threat level assessment (1-5 scale)
- Geographic location tracking with address validation
- Industry classification and market segment analysis
- Contact information and website monitoring
- Direct vs indirect competitor classification

## 📝 **Required Fields**
- Competitor name and description
- Industry classification
- Contact information (website, email)
- Business address with geographic coordinates
- Threat level assessment (1=Low, 5=Critical)

## 🎯 **Strategic Benefits**
- Enhanced competitive positioning
- Improved market intelligence
- Better sales strategy development
- Proactive threat monitoring
- Market opportunity identification
		`
	})
	@ApiBody({ 
		type: CreateCompetitorDto,
		description: 'Competitor creation payload with comprehensive business intelligence data',
		examples: {
			directCompetitor: {
				summary: '🎯 Direct Competitor - Hardware Store',
				description: 'Example of creating a direct competitor in hardware retail',
				value: {
					name: "BuildCorp Hardware",
					description: "Large retail hardware chain with 50+ locations nationwide",
					website: "https://buildcorp.co.za",
					contactEmail: "info@buildcorp.co.za",
					address: {
						street: "123 Industrial Avenue",
						suburb: "Midrand",
						city: "Johannesburg",
						state: "Gauteng",
						country: "South Africa",
						postalCode: "1685",
						latitude: -25.9985,
						longitude: 28.1288
					},
					industry: "Hardware & Building Supplies",
					threatLevel: 4,
					isDirect: true,
					notes: "Major competitor with strong DIY market presence and competitive pricing"
				}
			},
			indirectCompetitor: {
				summary: '🔄 Indirect Competitor - E-commerce Platform',
				description: 'Example of creating an indirect competitor in online retail',
				value: {
					name: "ToolMart Online",
					description: "E-commerce platform specializing in professional tools and equipment",
					website: "https://toolmart.co.za",
					contactEmail: "sales@toolmart.co.za",
					address: {
						street: "456 Tech Park Drive",
						suburb: "Sandton",
						city: "Johannesburg",
						state: "Gauteng",
						country: "South Africa",
						postalCode: "2196",
						latitude: -26.1076,
						longitude: 28.0567
					},
					industry: "E-commerce & Online Retail",
					threatLevel: 3,
					isDirect: false,
					notes: "Growing online presence affecting our professional tools segment"
				}
			},
			internationalCompetitor: {
				summary: '🌍 International Competitor - Global Brand',
				description: 'Example of creating an international competitor profile',
				value: {
					name: "Global Tools International",
					description: "Multinational tool manufacturer with local distribution network",
					website: "https://globaltools.com",
					contactEmail: "africa@globaltools.com",
					address: {
						street: "789 Corporate Boulevard",
						suburb: "Century City",
						city: "Cape Town",
						state: "Western Cape",
						country: "South Africa",
						postalCode: "7441",
						latitude: -33.8886,
						longitude: 18.5122
					},
					industry: "Manufacturing & Distribution",
					threatLevel: 5,
					isDirect: true,
					notes: "International brand with significant market share and brand recognition"
				}
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Competitor profile created successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor created successfully' },
				data: {
					type: 'object',
					properties: {
						competitor: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								competitorRef: { type: 'string', example: 'COMP-2023-001' },
								name: { type: 'string', example: 'BuildCorp Hardware' },
								description: { type: 'string', example: 'Large retail hardware chain with 50+ locations nationwide' },
								industry: { type: 'string', example: 'Hardware & Building Supplies' },
								threatLevel: { type: 'number', example: 4 },
								isDirect: { type: 'boolean', example: true },
								status: { type: 'string', example: 'ACTIVE' },
								website: { type: 'string', example: 'https://buildcorp.co.za' },
								contactEmail: { type: 'string', example: 'info@buildcorp.co.za' },
								address: {
									type: 'object',
									properties: {
										street: { type: 'string', example: '123 Industrial Avenue' },
										city: { type: 'string', example: 'Johannesburg' },
										state: { type: 'string', example: 'Gauteng' },
										country: { type: 'string', example: 'South Africa' },
										postalCode: { type: 'string', example: '1685' }
									}
								},
								createdAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
							}
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid or missing competitor data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed: Competitor name is required' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				details: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Competitor name must be between 3 and 100 characters',
						'Threat level must be between 1 and 5',
						'Valid email address is required',
						'Industry classification is required'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to create competitors',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to create competitor profiles' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiConflictResponse({
		description: '⚠️ Conflict - Competitor already exists',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor with name "BuildCorp Hardware" already exists' },
				error: { type: 'string', example: 'Conflict' },
				statusCode: { type: 'number', example: 409 },
				conflictingCompetitor: {
					type: 'object',
					properties: {
						uid: { type: 'number', example: 9876 },
						name: { type: 'string', example: 'BuildCorp Hardware' },
						competitorRef: { type: 'string', example: 'COMP-2023-001' }
					}
				}
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Competitor creation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to create competitor due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/competitors' }
			}
		}
	})
	create(@Body() createCompetitorDto: CreateCompetitorDto, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.create(createCompetitorDto, req.user, orgId, branchId);
	}

	@Post('batch')
	// @Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: '📦 Create multiple competitors in batch',
		description: `
# Batch Competitor Import

Creates multiple competitor profiles simultaneously with transaction safety and comprehensive validation.

## 🚀 **Bulk Import Features**
- **Transaction Safety**: All-or-nothing approach - either all succeed or all fail
- **Validation Pipeline**: Each competitor validated before batch processing
- **Duplicate Detection**: Automatic detection and handling of duplicate entries
- **Progress Tracking**: Real-time progress updates for large imports
- **Error Reporting**: Detailed error reports for failed entries

## 📊 **Use Cases**
- **Market Research Import**: Import competitor data from market research reports
- **CRM Migration**: Transfer competitor data from legacy systems
- **Industry Analysis**: Bulk import industry competitor lists
- **Merger & Acquisition**: Import competitor databases during M&A activities
- **Territory Expansion**: Add regional competitors when expanding markets

## 🔧 **Batch Processing Features**
- Maximum 1000 competitors per batch
- Automatic reference code generation for all entries
- Intelligent duplicate handling with merge options
- Rollback capability for failed transactions
- Detailed success/failure reporting

## 📈 **Performance Optimization**
- Optimized database transactions
- Parallel validation processing
- Memory-efficient batch handling
- Progress indicators for large datasets
		`
	})
	@ApiBody({
		description: 'Array of competitor data for batch creation with comprehensive validation',
		type: [CreateCompetitorDto],
		examples: {
			marketResearchImport: {
				summary: '📊 Market Research Import',
				description: 'Batch import from market research data',
				value: [
					{
						name: "RetailPro Hardware",
						description: "Regional hardware chain with 25 locations",
						website: "https://retailpro.co.za",
						contactEmail: "info@retailpro.co.za",
						address: {
							street: "100 Commerce Street",
							suburb: "Boksburg",
							city: "Johannesburg",
							state: "Gauteng",
							country: "South Africa",
							postalCode: "1459",
							latitude: -26.2041,
							longitude: 28.2502
						},
						industry: "Hardware & Building Supplies",
						threatLevel: 3,
						isDirect: true
					},
					{
						name: "ToolZone Distribution",
						description: "Wholesale tool distributor serving trade customers",
						website: "https://toolzone.co.za",
						contactEmail: "sales@toolzone.co.za",
						address: {
							street: "250 Industrial Park Road",
							suburb: "Alrode",
							city: "Alberton",
							state: "Gauteng",
							country: "South Africa",
							postalCode: "1449",
							latitude: -26.2832,
							longitude: 28.1251
						},
						industry: "Wholesale & Distribution",
						threatLevel: 2,
						isDirect: false
					}
				]
			}
		}
	})
	@ApiCreatedResponse({
		description: '✅ Batch competitor creation completed successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Batch competitor creation completed successfully' },
				data: {
					type: 'object',
					properties: {
						summary: {
							type: 'object',
							properties: {
								totalProcessed: { type: 'number', example: 100 },
								successful: { type: 'number', example: 95 },
								failed: { type: 'number', example: 5 },
								duplicatesFound: { type: 'number', example: 3 },
								processingTime: { type: 'number', example: 12.5, description: 'Processing time in seconds' }
							}
						},
						results: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									index: { type: 'number', example: 0 },
									success: { type: 'boolean', example: true },
									competitor: { 
										type: 'object',
										description: 'Created competitor object (if successful)',
										properties: {
											uid: { type: 'number', example: 12345 },
											competitorRef: { type: 'string', example: 'COMP-2023-001' },
											name: { type: 'string', example: 'RetailPro Hardware' }
										}
									},
									error: { 
										type: 'string', 
										example: null,
										description: 'Error message (if failed)'
									},
									warnings: {
										type: 'array',
										items: { type: 'string' },
										example: ['Similar competitor name found', 'Address coordinates approximated']
									}
								}
							}
						},
						duplicates: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									inputIndex: { type: 'number', example: 5 },
									existingCompetitor: {
										type: 'object',
										properties: {
											uid: { type: 'number', example: 9876 },
											name: { type: 'string', example: 'Similar Company Name' }
										}
									},
									action: { type: 'string', example: 'SKIPPED' }
								}
							}
						}
					}
				}
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid batch data or size limit exceeded',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Batch size cannot exceed 1000 competitors' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				constraints: {
					type: 'object',
					properties: {
						maxBatchSize: { type: 'number', example: 1000 },
						minBatchSize: { type: 'number', example: 1 },
						requiredFormat: { type: 'string', example: 'Array of competitor objects' }
					}
				}
			}
		}
	})
	@ApiUnprocessableEntityResponse({
		description: '📝 Unprocessable Entity - Validation errors in batch data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation errors found in batch data' },
				error: { type: 'string', example: 'Unprocessable Entity' },
				statusCode: { type: 'number', example: 422 },
				validationErrors: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							index: { type: 'number', example: 5 },
							errors: {
								type: 'array',
								items: { type: 'string' },
								example: ['Name is required', 'Invalid email format', 'Threat level must be 1-5']
							}
						}
					}
				}
			}
		}
	})
	createBatch(@Body() createCompetitorDtos: CreateCompetitorDto[], @Request() req) {
		if (!Array.isArray(createCompetitorDtos)) {
			throw new BadRequestException('Request body must be an array of competitor objects');
		}

		if (createCompetitorDtos.length === 0) {
			throw new BadRequestException('Array cannot be empty');
		}

		if (createCompetitorDtos.length > 1000) {
			throw new BadRequestException('Batch size cannot exceed 1000 competitors');
		}

		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.createBatch(createCompetitorDtos, req.user, orgId, branchId);
	}

	@Get()
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({
		summary: '📋 Get all competitors',
		description: `
# Comprehensive Competitor Intelligence

Retrieves a complete competitive landscape overview with advanced filtering and analytics capabilities.

## 📊 **Intelligence Features**
- **Threat Assessment**: Real-time threat level analysis across all competitors
- **Market Positioning**: Direct vs indirect competitor classification
- **Geographic Distribution**: Location-based competitor mapping
- **Industry Analysis**: Competitor segmentation by industry verticals
- **Status Monitoring**: Active, inactive, and archived competitor tracking

## 🔍 **Advanced Filtering**
- Filter by threat level (1-5 scale)
- Filter by competitor type (direct/indirect)
- Geographic radius filtering
- Industry and market segment filters
- Status-based filtering (active, monitoring, archived)

## 📈 **Competitive Intelligence**
- Market share analysis
- Threat level trending
- Geographic concentration mapping
- Competitive gap analysis
- Industry penetration metrics

## 🎯 **Strategic Applications**
- **Sales Strategy**: Identify key competitive threats in target markets
- **Market Entry**: Analyze competitive landscape before market expansion
- **Product Positioning**: Understand competitor positioning strategies
- **Pricing Strategy**: Competitive pricing intelligence and analysis
- **Partnership Opportunities**: Identify potential strategic partnerships
		`,
	})
	@ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number for pagination (default: 1)' })
	@ApiQuery({
		name: 'limit',
		type: Number,
		required: false,
		description: 'Number of competitors per page (default: 10, max: 100)',
	})
	@ApiQuery({ name: 'status', enum: CompetitorStatus, required: false, description: 'Filter by competitor status (ACTIVE, MONITORING, ARCHIVED)' })
	@ApiQuery({ name: 'isDirect', type: Boolean, required: false, description: 'Filter by direct competitor classification' })
	@ApiQuery({ name: 'industry', type: String, required: false, description: 'Filter by industry vertical or market segment' })
	@ApiQuery({ name: 'name', type: String, required: false, description: 'Search by competitor name (partial matching supported)' })
	@ApiQuery({
		name: 'minThreatLevel',
		type: Number,
		required: false,
		description: 'Filter by minimum threat level (1=Low, 5=Critical)',
	})
	@ApiOkResponse({
		description: '✅ Competitor intelligence retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						competitors: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12345 },
									competitorRef: { type: 'string', example: 'COMP-2023-001' },
									name: { type: 'string', example: 'BuildCorp Hardware' },
									description: { type: 'string', example: 'Large retail hardware chain with 50+ locations' },
									industry: { type: 'string', example: 'Hardware & Building Supplies' },
									threatLevel: { type: 'number', example: 4 },
									isDirect: { type: 'boolean', example: true },
									status: { type: 'string', example: 'ACTIVE' },
									website: { type: 'string', example: 'https://buildcorp.co.za' },
									contactEmail: { type: 'string', example: 'info@buildcorp.co.za' },
									address: {
										type: 'object',
										properties: {
											city: { type: 'string', example: 'Johannesburg' },
											state: { type: 'string', example: 'Gauteng' },
											country: { type: 'string', example: 'South Africa' }
										}
									},
									lastUpdated: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
									createdAt: { type: 'string', format: 'date-time', example: '2023-11-01T10:00:00Z' }
								}
							}
						},
						pagination: {
							type: 'object',
							properties: {
								currentPage: { type: 'number', example: 1 },
								totalPages: { type: 'number', example: 5 },
								totalItems: { type: 'number', example: 47 },
								itemsPerPage: { type: 'number', example: 10 }
							}
						},
						analytics: {
							type: 'object',
							properties: {
								totalCompetitors: { type: 'number', example: 47 },
								directCompetitors: { type: 'number', example: 23 },
								indirectCompetitors: { type: 'number', example: 24 },
								averageThreatLevel: { type: 'number', example: 3.2 },
								byThreatLevel: {
									type: 'object',
									properties: {
										'1': { type: 'number', example: 5 },
										'2': { type: 'number', example: 8 },
										'3': { type: 'number', example: 15 },
										'4': { type: 'number', example: 12 },
										'5': { type: 'number', example: 7 }
									}
								},
								byIndustry: {
									type: 'object',
									additionalProperties: { type: 'number' },
									example: {
										'Hardware & Building Supplies': 15,
										'E-commerce & Online Retail': 8,
										'Manufacturing & Distribution': 12,
										'Professional Services': 7,
										'Technology & Software': 5
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Competitor intelligence retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Insufficient permissions to view competitor intelligence',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to access competitor intelligence' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Failed to retrieve competitor data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to retrieve competitor intelligence due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/competitors' }
			}
		}
	})
	findAll(
		@Query() filterDto: FilterCompetitorDto,
		@Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
		@Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
		@Request() req?: any,
	): Promise<PaginatedResponse<Competitor>> {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findAll(filterDto, page, limit, orgId, branchId);
	}

	@Get('analytics')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: '📊 Get comprehensive competitor analytics',
		description: `
# Advanced Competitive Intelligence Dashboard

Provides deep analytical insights into your competitive landscape with actionable intelligence.

## 📈 **Analytics Categories**
- **Threat Assessment**: Real-time threat level analysis and trending
- **Market Positioning**: Direct vs indirect competitor distribution
- **Geographic Intelligence**: Location-based competitive mapping
- **Industry Analysis**: Vertical market penetration and concentration
- **Competitive Gaps**: Market opportunities and white space identification

## 🎯 **Strategic Insights**
- **Top Threats**: Highest threat competitors requiring immediate attention
- **Market Concentration**: Industry concentration and competitive density
- **Geographic Hotspots**: Areas with highest competitive activity
- **Threat Trending**: Historical threat level changes and patterns
- **Competitive Benchmarking**: Performance metrics vs competitor landscape

## 📊 **Key Metrics**
- Total competitor count and classification
- Average threat level across all competitors
- Industry distribution and market share analysis
- Geographic spread and concentration mapping
- Status distribution (active, monitoring, archived)

## 🔍 **Business Applications**
- **Strategic Planning**: Data-driven competitive strategy development
- **Market Entry**: Risk assessment for new market opportunities
- **Resource Allocation**: Priority targeting based on threat levels
- **Performance Monitoring**: Track competitive position over time
		`
	})
	@ApiOkResponse({
		description: '✅ Comprehensive competitor analytics retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						overview: {
							type: 'object',
							properties: {
								totalCompetitors: { type: 'number', example: 47 },
								directCompetitors: { type: 'number', example: 23 },
								indirectCompetitors: { type: 'number', example: 24 },
								averageThreatLevel: { type: 'number', example: 3.2 },
								highThreatCompetitors: { type: 'number', example: 7, description: 'Competitors with threat level 4-5' },
								activeCompetitors: { type: 'number', example: 42 },
								monitoringCompetitors: { type: 'number', example: 5 }
							}
						},
						topThreats: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12345 },
									name: { type: 'string', example: 'Global Tools International' },
									threatLevel: { type: 'number', example: 5 },
									industry: { type: 'string', example: 'Manufacturing & Distribution' },
									isDirect: { type: 'boolean', example: true },
									lastThreatUpdate: { type: 'string', format: 'date', example: '2023-11-15' },
									keyThreats: {
										type: 'array',
										items: { type: 'string' },
										example: ['Market share leadership', 'Brand recognition', 'Pricing pressure']
									}
								}
							}
						},
						threatDistribution: {
							type: 'object',
							properties: {
								level1: { type: 'number', example: 5, description: 'Low threat competitors' },
								level2: { type: 'number', example: 8, description: 'Moderate threat competitors' },
								level3: { type: 'number', example: 15, description: 'Medium threat competitors' },
								level4: { type: 'number', example: 12, description: 'High threat competitors' },
								level5: { type: 'number', example: 7, description: 'Critical threat competitors' }
							}
						},
						industryAnalysis: {
							type: 'object',
							additionalProperties: {
								type: 'object',
								properties: {
									count: { type: 'number' },
									averageThreatLevel: { type: 'number' },
									directCompetitors: { type: 'number' },
									marketShare: { type: 'number', description: 'Estimated market share percentage' }
								}
							},
							example: {
								'Hardware & Building Supplies': {
									count: 15,
									averageThreatLevel: 3.8,
									directCompetitors: 12,
									marketShare: 45.2
								},
								'E-commerce & Online Retail': {
									count: 8,
									averageThreatLevel: 3.1,
									directCompetitors: 3,
									marketShare: 18.7
								}
							}
						},
						geographicDistribution: {
							type: 'object',
							properties: {
								byProvince: {
									type: 'object',
									additionalProperties: { type: 'number' },
									example: {
										'Gauteng': 23,
										'Western Cape': 12,
										'KwaZulu-Natal': 8,
										'Eastern Cape': 4
									}
								},
								competitiveHotspots: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											city: { type: 'string', example: 'Johannesburg' },
											competitorCount: { type: 'number', example: 15 },
											averageThreatLevel: { type: 'number', example: 3.7 },
											keyCompetitors: {
												type: 'array',
												items: { type: 'string' },
												example: ['BuildCorp Hardware', 'ToolZone Distribution']
											}
										}
									}
								}
							}
						},
						trends: {
							type: 'object',
							properties: {
								monthlyGrowth: { type: 'number', example: 2.3, description: 'New competitors added this month' },
								threatLevelTrends: {
									type: 'object',
									properties: {
										increasing: { type: 'number', example: 5 },
										decreasing: { type: 'number', example: 2 },
										stable: { type: 'number', example: 40 }
									}
								},
								recentChanges: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											competitorName: { type: 'string', example: 'TechTools Pro' },
											changeType: { type: 'string', example: 'THREAT_LEVEL_INCREASE' },
											oldValue: { type: 'number', example: 3 },
											newValue: { type: 'number', example: 4 },
											changeDate: { type: 'string', format: 'date', example: '2023-11-28' }
										}
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Competitor analytics retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Analytics access restricted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Analytics access requires manager-level permissions or above' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Analytics processing failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to generate competitor analytics due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/competitors/analytics' }
			}
		}
	})
	getCompetitorAnalytics(@Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.getCompetitorAnalytics(orgId, branchId);
	}

	@Get('by-industry')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: '🏭 Get competitors grouped by industry',
		description: `
# Industry-Based Competitive Analysis

Provides detailed breakdown of competitors organized by industry verticals and market segments.

## 📊 **Industry Intelligence**
- **Market Segmentation**: Competitors grouped by primary industry classification
- **Industry Penetration**: Competitive density across different market segments
- **Vertical Analysis**: Deep dive into specific industry competitive landscapes
- **Cross-Industry Threats**: Competitors operating across multiple industries

## 🎯 **Strategic Applications**
- **Market Entry Strategy**: Analyze competitive landscape before entering new industries
- **Industry Positioning**: Understand competitive positioning within specific verticals
- **Resource Allocation**: Prioritize industries based on competitive intensity
- **Partnership Opportunities**: Identify potential partners in complementary industries

## 📈 **Key Metrics**
- Competitor count per industry
- Average threat level by industry vertical
- Market concentration analysis
- Industry growth potential assessment
		`
	})
	@ApiOkResponse({
		description: '✅ Industry-based competitor analysis retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						industryBreakdown: {
							type: 'object',
							additionalProperties: {
								type: 'object',
								properties: {
									competitorCount: { type: 'number' },
									averageThreatLevel: { type: 'number' },
									directCompetitors: { type: 'number' },
									indirectCompetitors: { type: 'number' },
									marketShare: { type: 'number', description: 'Estimated combined market share' },
									topCompetitors: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												name: { type: 'string' },
												threatLevel: { type: 'number' },
												isDirect: { type: 'boolean' }
											}
										}
									}
								}
							},
							example: {
								'Hardware & Building Supplies': {
									competitorCount: 15,
									averageThreatLevel: 3.8,
									directCompetitors: 12,
									indirectCompetitors: 3,
									marketShare: 67.5,
									topCompetitors: [
										{ name: 'BuildCorp Hardware', threatLevel: 4, isDirect: true },
										{ name: 'MegaTools Retail', threatLevel: 5, isDirect: true }
									]
								},
								'E-commerce & Online Retail': {
									competitorCount: 8,
									averageThreatLevel: 3.1,
									directCompetitors: 3,
									indirectCompetitors: 5,
									marketShare: 23.4,
									topCompetitors: [
										{ name: 'ToolMart Online', threatLevel: 3, isDirect: false }
									]
								}
							}
						},
						competitiveIntensity: {
							type: 'object',
							properties: {
								mostCompetitive: {
									type: 'object',
									properties: {
										industry: { type: 'string', example: 'Hardware & Building Supplies' },
										competitorCount: { type: 'number', example: 15 },
										intensityScore: { type: 'number', example: 8.7 }
									}
								},
								leastCompetitive: {
									type: 'object',
									properties: {
										industry: { type: 'string', example: 'Specialized Manufacturing' },
										competitorCount: { type: 'number', example: 2 },
										intensityScore: { type: 'number', example: 2.1 }
									}
								},
								emergingThreat: {
									type: 'object',
									properties: {
										industry: { type: 'string', example: 'Technology & Software' },
										competitorCount: { type: 'number', example: 5 },
										growthRate: { type: 'number', example: 40.0, description: 'Percentage growth in last 6 months' }
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Industry competitor analysis retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Industry analysis access restricted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Industry analysis requires manager-level permissions or above' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	getCompetitorsByIndustry(@Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.getCompetitorsByIndustry(orgId, branchId);
	}

	@Get('by-threat')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: '⚠️ Get competitors by threat level',
		description: `
# Threat-Based Competitor Prioritization

Retrieves competitors organized by threat level assessment for strategic priority management.

## 🚨 **Threat Level Classification**
- **Level 5 (Critical)**: Immediate competitive threats requiring urgent attention
- **Level 4 (High)**: Significant threats with major market impact potential
- **Level 3 (Medium)**: Moderate threats requiring ongoing monitoring
- **Level 2 (Low)**: Minor threats with limited immediate impact
- **Level 1 (Minimal)**: Peripheral competitors with minimal direct impact

## 🎯 **Strategic Applications**
- **Priority Setting**: Focus resources on highest threat competitors
- **Response Planning**: Develop targeted strategies for different threat levels
- **Resource Allocation**: Distribute competitive intelligence efforts effectively
- **Risk Management**: Identify and mitigate competitive risks proactively

## 📊 **Intelligence Features**
- Real-time threat level assessment
- Historical threat level trending
- Threat escalation monitoring
- Competitive response tracking
		`
	})
	@ApiQuery({ 
		name: 'minThreatLevel', 
		required: false, 
		type: Number, 
		description: 'Minimum threat level filter (1-5). Returns competitors with threat level >= specified value',
		example: 3
	})
	@ApiOkResponse({
		description: '✅ Threat-based competitor analysis retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						competitors: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12345 },
									competitorRef: { type: 'string', example: 'COMP-2023-001' },
									name: { type: 'string', example: 'Global Tools International' },
									description: { type: 'string', example: 'Multinational tool manufacturer with local distribution' },
									threatLevel: { type: 'number', example: 5 },
									industry: { type: 'string', example: 'Manufacturing & Distribution' },
									isDirect: { type: 'boolean', example: true },
									status: { type: 'string', example: 'ACTIVE' },
									keyThreats: {
										type: 'array',
										items: { type: 'string' },
										example: ['Market share leadership', 'Brand recognition', 'Pricing pressure', 'Distribution network']
									},
									competitiveAdvantages: {
										type: 'array',
										items: { type: 'string' },
										example: ['Global brand recognition', 'Extensive product range', 'Strong R&D capabilities']
									},
									lastThreatAssessment: { type: 'string', format: 'date', example: '2023-11-15' },
									threatTrend: { type: 'string', example: 'INCREASING', enum: ['INCREASING', 'STABLE', 'DECREASING'] }
								}
							}
						},
						threatSummary: {
							type: 'object',
							properties: {
								filteredCount: { type: 'number', example: 19, description: 'Competitors matching threat level filter' },
								totalCount: { type: 'number', example: 47, description: 'Total competitors in database' },
								averageThreatLevel: { type: 'number', example: 4.1 },
								criticalThreats: { type: 'number', example: 7, description: 'Level 5 threats' },
								highThreats: { type: 'number', example: 12, description: 'Level 4 threats' },
								immediateActionRequired: { type: 'number', example: 3, description: 'Threats with recent escalation' }
							}
						},
						recommendedActions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									competitorName: { type: 'string', example: 'Global Tools International' },
									threatLevel: { type: 'number', example: 5 },
									recommendedAction: { type: 'string', example: 'Immediate competitive response required' },
									priority: { type: 'string', example: 'URGENT', enum: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] },
									suggestedStrategies: {
										type: 'array',
										items: { type: 'string' },
										example: ['Pricing strategy review', 'Product differentiation', 'Market positioning']
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Threat-based competitor analysis retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid threat level parameter',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Threat level must be between 1 and 5' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validRange: { type: 'string', example: '1 (Minimal) to 5 (Critical)' }
			}
		}
	})
	findByThreatLevel(
		@Query('minThreatLevel', new DefaultValuePipe(0), ParseIntPipe) minThreatLevel = 0,
		@Request() req,
	) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findByThreatLevel(minThreatLevel, orgId, branchId);
	}

	@Get('by-name')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ 
		summary: '🔍 Find competitors by name',
		description: `
# Smart Competitor Search

Advanced search functionality to quickly locate competitors using intelligent name matching.

## 🔍 **Search Capabilities**
- **Partial Matching**: Find competitors with incomplete name information
- **Fuzzy Search**: Intelligent matching that handles typos and variations
- **Alias Recognition**: Search by known aliases and alternative names
- **Brand Name Search**: Find competitors by brand or trading names
- **Phonetic Matching**: Sound-alike name matching for verbal searches

## 🚀 **Search Features**
- Real-time search suggestions
- Search result ranking by relevance
- Historical search patterns
- Related competitor suggestions
- Search performance optimization

## 📊 **Business Applications**
- **Quick Lookup**: Rapid competitor identification during meetings
- **Due Diligence**: Verify competitor information during research
- **Sales Support**: Instant competitive intelligence for sales teams
- **Market Research**: Competitor identification for analysis projects
		`
	})
	@ApiQuery({ 
		name: 'name', 
		required: true, 
		type: String, 
		description: 'Competitor name or partial name to search for. Supports partial matching and fuzzy search.',
		example: 'BuildCorp'
	})
	@ApiOkResponse({
		description: '✅ Competitor search results retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						competitors: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									uid: { type: 'number', example: 12345 },
									competitorRef: { type: 'string', example: 'COMP-2023-001' },
									name: { type: 'string', example: 'BuildCorp Hardware' },
									description: { type: 'string', example: 'Large retail hardware chain with 50+ locations' },
									industry: { type: 'string', example: 'Hardware & Building Supplies' },
									threatLevel: { type: 'number', example: 4 },
									isDirect: { type: 'boolean', example: true },
									status: { type: 'string', example: 'ACTIVE' },
									matchScore: { type: 'number', example: 0.95, description: 'Search relevance score (0-1)' },
									matchType: { type: 'string', example: 'EXACT_MATCH', enum: ['EXACT_MATCH', 'PARTIAL_MATCH', 'FUZZY_MATCH', 'ALIAS_MATCH'] },
									website: { type: 'string', example: 'https://buildcorp.co.za' },
									location: {
										type: 'object',
										properties: {
											city: { type: 'string', example: 'Johannesburg' },
											state: { type: 'string', example: 'Gauteng' }
										}
									}
								}
							}
						},
						searchMetadata: {
							type: 'object',
							properties: {
								searchTerm: { type: 'string', example: 'BuildCorp' },
								totalResults: { type: 'number', example: 3 },
								searchTime: { type: 'number', example: 0.025, description: 'Search execution time in seconds' },
								suggestions: {
									type: 'array',
									items: { type: 'string' },
									example: ['BuildMax', 'ConstructCorp', 'Hardware Direct']
								},
								relatedSearches: {
									type: 'array',
									items: { type: 'string' },
									example: ['hardware stores', 'building supplies', 'construction retailers']
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Competitor search completed successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiBadRequestResponse({
		description: '❌ Bad Request - Invalid search parameters',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Search term must be at least 2 characters long' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				constraints: {
					type: 'object',
					properties: {
						minLength: { type: 'number', example: 2 },
						maxLength: { type: 'number', example: 100 }
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({
		description: '🔍 No competitors found matching search criteria',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'No competitors found matching "NonExistentCorp"' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Try a broader search term',
						'Check spelling and try again',
						'Use partial company names',
						'Search by industry instead'
					]
				}
			}
		}
	})
	findByName(@Query('name') name: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findByName(name, orgId, branchId);
	}

	@Get(':id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ 
		summary: '🔍 Get competitor details by ID',
		description: `
# Comprehensive Competitor Profile

Retrieves complete competitor intelligence profile with detailed analysis and actionable insights.

## 📊 **Profile Components**
- **Basic Information**: Name, description, contact details, industry classification
- **Threat Assessment**: Current threat level with historical analysis
- **Geographic Intelligence**: Location data with market coverage analysis
- **Competitive Positioning**: Direct vs indirect classification with rationale
- **Market Intelligence**: Market share, positioning, and competitive advantages

## 🔍 **Intelligence Features**
- **Threat Trending**: Historical threat level changes and analysis
- **Market Position**: Competitive positioning and market share data
- **Strategic Insights**: Key competitive advantages and vulnerabilities
- **Action Recommendations**: Suggested competitive responses and strategies

## 🎯 **Business Applications**
- **Competitive Analysis**: Deep dive into specific competitor capabilities
- **Strategic Planning**: Inform competitive strategy development
- **Sales Intelligence**: Arm sales teams with competitive insights
- **Market Research**: Support market analysis and positioning decisions
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Competitor unique identifier (UID)',
		type: 'string',
		example: '12345'
	})
	@ApiOkResponse({
		description: '✅ Competitor profile retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						competitor: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								competitorRef: { type: 'string', example: 'COMP-2023-001' },
								name: { type: 'string', example: 'BuildCorp Hardware' },
								description: { type: 'string', example: 'Large retail hardware chain with 50+ locations nationwide' },
								industry: { type: 'string', example: 'Hardware & Building Supplies' },
								threatLevel: { type: 'number', example: 4 },
								isDirect: { type: 'boolean', example: true },
								status: { type: 'string', example: 'ACTIVE' },
								website: { type: 'string', example: 'https://buildcorp.co.za' },
								contactEmail: { type: 'string', example: 'info@buildcorp.co.za' },
								logoUrl: { type: 'string', example: 'https://cdn.buildcorp.co.za/logo.png' },
								address: {
									type: 'object',
									properties: {
										street: { type: 'string', example: '123 Industrial Avenue' },
										suburb: { type: 'string', example: 'Midrand' },
										city: { type: 'string', example: 'Johannesburg' },
										state: { type: 'string', example: 'Gauteng' },
										country: { type: 'string', example: 'South Africa' },
										postalCode: { type: 'string', example: '1685' },
										latitude: { type: 'number', example: -25.9985 },
										longitude: { type: 'number', example: 28.1288 }
									}
								},
								competitiveIntelligence: {
									type: 'object',
									properties: {
										marketShare: { type: 'number', example: 15.7, description: 'Estimated market share percentage' },
										employeeCount: { type: 'number', example: 2500 },
										annualRevenue: { type: 'number', example: 750000000 },
										keyProducts: {
											type: 'array',
											items: { type: 'string' },
											example: ['Power Tools', 'Building Materials', 'Hardware Supplies', 'Garden Equipment']
										},
										competitiveAdvantages: {
											type: 'array',
											items: { type: 'string' },
											example: ['Extensive retail network', 'Strong brand recognition', 'Competitive pricing', 'Wide product range']
										},
										vulnerabilities: {
											type: 'array',
											items: { type: 'string' },
											example: ['Limited online presence', 'Aging store formats', 'High operational costs']
										},
										recentDevelopments: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													date: { type: 'string', format: 'date', example: '2023-11-15' },
													type: { type: 'string', example: 'EXPANSION' },
													description: { type: 'string', example: 'Opened 5 new stores in Western Cape region' },
													impact: { type: 'string', example: 'HIGH', enum: ['LOW', 'MEDIUM', 'HIGH'] }
												}
											}
										}
									}
								},
								threatAnalysis: {
									type: 'object',
									properties: {
										currentThreatLevel: { type: 'number', example: 4 },
										threatTrend: { type: 'string', example: 'STABLE', enum: ['INCREASING', 'STABLE', 'DECREASING'] },
										lastAssessment: { type: 'string', format: 'date', example: '2023-11-15' },
										threatHistory: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													date: { type: 'string', format: 'date', example: '2023-09-01' },
													threatLevel: { type: 'number', example: 3 },
													reason: { type: 'string', example: 'Market expansion activities' }
												}
											}
										},
										keyThreats: {
											type: 'array',
											items: { type: 'string' },
											example: ['Aggressive pricing strategy', 'Market share growth', 'New store openings in our territories']
										}
									}
								},
								createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T10:00:00Z' },
								updatedAt: { type: 'string', format: 'date-time', example: '2023-11-15T14:30:00Z' }
							}
						},
						recommendedActions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									priority: { type: 'string', example: 'HIGH', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
									action: { type: 'string', example: 'Monitor pricing strategies closely' },
									reasoning: { type: 'string', example: 'Recent aggressive pricing moves in key markets' },
									timeframe: { type: 'string', example: 'Immediate' }
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Competitor profile retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Competitor not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 },
				suggestions: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Verify the competitor ID is correct',
						'Check if the competitor has been deleted or archived',
						'Ensure you have permission to access this competitor'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No access to competitor profile',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to view this competitor profile' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	findOne(@Param('id') id: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.findOne(competitorId, orgId, branchId);
	}

	@Get('ref/:ref')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ 
		summary: '🔍 Get competitor by reference code',
		description: `
# Competitor Lookup by Reference

Quick competitor profile retrieval using the system-generated reference code for efficient access.

## 🎯 **Reference Code System**
- **Standardized Format**: COMP-YYYY-XXX (e.g., COMP-2023-001)
- **Sequential Generation**: Automatic sequential numbering by year
- **Global Uniqueness**: Unique across all organizations and branches
- **Human Readable**: Easy to remember and communicate

## 📋 **Use Cases**
- **Quick Reference**: Instant competitor lookup during meetings
- **Documentation**: Reference competitors in reports and presentations
- **Integration**: API integration with external systems
- **Audit Trail**: Maintain clear references in audit logs
		`
	})
	@ApiParam({ 
		name: 'ref', 
		description: 'Competitor reference code (e.g., COMP-2023-001)',
		type: 'string',
		example: 'COMP-2023-001'
	})
	@ApiOkResponse({
		description: '✅ Competitor retrieved by reference code successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor retrieved successfully' },
				data: {
					type: 'object',
					properties: {
						competitor: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								competitorRef: { type: 'string', example: 'COMP-2023-001' },
								name: { type: 'string', example: 'BuildCorp Hardware' },
								description: { type: 'string', example: 'Large retail hardware chain' },
								threatLevel: { type: 'number', example: 4 },
								industry: { type: 'string', example: 'Hardware & Building Supplies' },
								status: { type: 'string', example: 'ACTIVE' }
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Competitor reference not found',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor with reference COMP-2023-001 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	findOneByRef(@Param('ref') ref: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		return this.competitorsService.findOneByRef(ref, orgId, branchId);
	}

	@Patch(':id')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER)
	@ApiOperation({ 
		summary: '✏️ Update competitor profile',
		description: `
# Comprehensive Competitor Profile Updates

Updates competitor information while maintaining complete audit trail and intelligence history.

## 🔄 **Updatable Information**
- **Basic Details**: Name, description, contact information
- **Threat Assessment**: Threat level adjustments with reasoning
- **Classification**: Direct vs indirect competitor status
- **Geographic Data**: Address and location information updates
- **Intelligence Notes**: Market intelligence and competitive insights
- **Status Changes**: Active, monitoring, archived status updates

## 🔒 **Security & Audit Features**
- **Change Tracking**: Complete audit trail of all modifications
- **User Attribution**: Track who made changes and when
- **Validation**: Business rule validation for all updates
- **Rollback**: Ability to view and restore previous versions

## 📈 **Intelligence Preservation**
- Historical data preservation
- Trend analysis maintenance
- Competitive intelligence continuity
- Strategic context retention
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Competitor unique identifier to update',
		type: 'string',
		example: '12345'
	})
	@ApiBody({ 
		type: UpdateCompetitorDto,
		description: 'Competitor update payload with modified fields',
		examples: {
			threatLevelUpdate: {
				summary: '⚠️ Threat Level Adjustment',
				description: 'Update competitor threat level with reasoning',
				value: {
					threatLevel: 5,
					notes: "Increased threat level due to aggressive market expansion and new distribution partnerships announced Q4 2023"
				}
			},
			contactUpdate: {
				summary: '📞 Contact Information Update',
				description: 'Update competitor contact details',
				value: {
					contactEmail: "newcontact@buildcorp.co.za",
					website: "https://new.buildcorp.co.za",
					notes: "Updated contact information following corporate restructuring"
				}
			},
			statusChange: {
				summary: '📊 Status Classification Change',
				description: 'Change competitor status and classification',
				value: {
					status: "MONITORING",
					isDirect: false,
					notes: "Reclassified as indirect competitor following pivot to B2B focus"
				}
			}
		}
	})
	@ApiOkResponse({
		description: '✅ Competitor profile updated successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor updated successfully' },
				data: {
					type: 'object',
					properties: {
						competitor: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								competitorRef: { type: 'string', example: 'COMP-2023-001' },
								name: { type: 'string', example: 'BuildCorp Hardware' },
								threatLevel: { type: 'number', example: 5 },
								updatedFields: {
									type: 'array',
									items: { type: 'string' },
									example: ['threatLevel', 'notes', 'lastUpdated']
								},
								previousValues: {
									type: 'object',
									properties: {
										threatLevel: { type: 'number', example: 4 }
									}
								},
								changeReason: { type: 'string', example: 'Threat escalation due to market expansion' },
								updatedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								updatedBy: { type: 'string', example: 'John Doe (Manager)' }
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Competitor not found for update',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiBadRequestResponse({ 
		description: '❌ Bad Request - Invalid update data',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Validation failed for competitor update' },
				error: { type: 'string', example: 'Bad Request' },
				statusCode: { type: 'number', example: 400 },
				validationErrors: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'Threat level must be between 1 and 5',
						'Email format is invalid',
						'Website URL format is invalid'
					]
				}
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - No permission to update competitor',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to update competitor profiles' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	update(@Param('id') id: string, @Body() updateCompetitorDto: UpdateCompetitorDto, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.update(competitorId, updateCompetitorDto, orgId, branchId);
	}

	@Delete(':id')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({ 
		summary: '🗑️ Soft delete competitor (reversible)',
		description: `
# Safe Competitor Removal

Safely removes competitor from active intelligence while preserving data for potential recovery.

## 🔒 **Soft Delete Process**
- **Data Preservation**: Competitor data remains in database
- **Status Change**: Marked as deleted but recoverable
- **Audit Trail**: Deletion logged with user and timestamp
- **Recovery Window**: 90-day recovery period before permanent deletion
- **Intelligence Retention**: Historical intelligence data preserved

## ⚠️ **Safety Features**
- **Reversible Process**: Can be undone within retention period
- **Data Integrity**: Related records and history preserved
- **Access Control**: Requires admin-level permissions
- **Confirmation Required**: Additional verification for critical competitors

## 📋 **Common Use Cases**
- **Outdated Competitors**: Remove competitors no longer relevant
- **Data Cleanup**: Archive old or inactive competitor profiles
- **Mistaken Entries**: Remove incorrectly added competitors
- **Compliance**: Meet data retention and privacy requirements
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Competitor unique identifier to delete',
		type: 'string',
		example: '12345'
	})
	@ApiOkResponse({
		description: '✅ Competitor soft deleted successfully',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor soft deleted successfully' },
				data: {
					type: 'object',
					properties: {
						competitor: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								competitorRef: { type: 'string', example: 'COMP-2023-001' },
								name: { type: 'string', example: 'BuildCorp Hardware' },
								status: { type: 'string', example: 'DELETED' },
								deletedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								deletedBy: { type: 'string', example: 'Admin User' },
								recoveryDeadline: { type: 'string', format: 'date', example: '2024-03-01' },
								retentionPeriod: { type: 'number', example: 90, description: 'Days before permanent deletion' }
							}
						}
					}
				}
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Competitor not found for deletion',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor with ID 12345 not found' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Admin permissions required',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Only administrators can delete competitor profiles' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	remove(@Param('id') id: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.remove(competitorId, orgId, branchId);
	}

	@Delete('hard/:id')
	@Roles(AccessLevel.ADMIN)
	@ApiOperation({ 
		summary: '💥 Permanently delete competitor (irreversible)',
		description: `
# Permanent Competitor Deletion

⚠️ **WARNING: This action is irreversible and permanently destroys all competitor data**

## 🚨 **Critical Notice**
- **Irreversible Action**: Cannot be undone once executed
- **Complete Data Loss**: All competitor intelligence permanently destroyed
- **Audit Impact**: Historical references may become invalid
- **Compliance Risk**: Ensure compliance with data retention policies

## 🔒 **Security Requirements**
- **Admin-Only Access**: Restricted to system administrators
- **Additional Verification**: May require secondary confirmation
- **Audit Logging**: Action logged for security and compliance
- **Impact Assessment**: Review related data before deletion

## 📋 **Valid Use Cases**
- **Legal Compliance**: GDPR or privacy law requirements
- **Data Purging**: System maintenance and storage optimization
- **Security Incidents**: Remove compromised or malicious data
- **End of Retention**: Automatic cleanup after retention period
		`
	})
	@ApiParam({ 
		name: 'id', 
		description: 'Competitor unique identifier to permanently delete',
		type: 'string',
		example: '12345'
	})
	@ApiOkResponse({
		description: '✅ Competitor permanently deleted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor permanently deleted' },
				data: {
					type: 'object',
					properties: {
						deletedCompetitor: {
							type: 'object',
							properties: {
								uid: { type: 'number', example: 12345 },
								competitorRef: { type: 'string', example: 'COMP-2023-001' },
								name: { type: 'string', example: 'BuildCorp Hardware' },
								permanentlyDeletedAt: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
								deletedBy: { type: 'string', example: 'System Administrator' }
							}
						},
						impactSummary: {
							type: 'object',
							properties: {
								referencesRemoved: { type: 'number', example: 15 },
								intelligenceDataDestroyed: { type: 'boolean', example: true },
								auditTrailPreserved: { type: 'boolean', example: true }
							}
						}
					}
				},
				warnings: {
					type: 'array',
					items: { type: 'string' },
					example: [
						'This action cannot be undone',
						'All competitor intelligence has been permanently destroyed',
						'Related reports may show broken references'
					]
				}
			}
		}
	})
	@ApiNotFoundResponse({ 
		description: '🔍 Competitor not found for permanent deletion',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Competitor with ID 12345 not found or already permanently deleted' },
				error: { type: 'string', example: 'Not Found' },
				statusCode: { type: 'number', example: 404 }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Permanent deletion restricted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Permanent deletion requires highest level administrator privileges' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	hardRemove(@Param('id') id: string, @Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);
		// Convert string to number - let service handle validation
		const competitorId = Number(id);
		return this.competitorsService.hardRemove(competitorId, orgId, branchId);
	}

	@Get('map-data')
	@Roles(AccessLevel.ADMIN, AccessLevel.MANAGER, AccessLevel.USER)
	@ApiOperation({ 
		summary: '🗺️ Get competitor map visualization data',
		description: `
# Geographic Competitor Intelligence Mapping

Provides competitor data optimized for geographic visualization and territorial analysis.

## 🗺️ **Mapping Features**
- **Geographic Distribution**: Visual representation of competitor locations
- **Threat Level Mapping**: Color-coded threat indicators on map
- **Territory Analysis**: Competitive density and coverage mapping
- **Market Penetration**: Geographic market share visualization
- **Strategic Positioning**: Location-based competitive advantages

## 📊 **Map Data Components**
- **Coordinates**: Precise latitude/longitude for accurate positioning
- **Threat Indicators**: Visual threat level representation
- **Information Overlays**: Quick competitor intelligence on hover/click
- **Clustering**: Intelligent grouping of nearby competitors
- **Territory Boundaries**: Market area and coverage visualization

## 🎯 **Strategic Applications**
- **Territory Planning**: Identify underserved or oversaturated markets
- **Expansion Strategy**: Analyze competitive landscape for new locations
- **Sales Route Optimization**: Plan sales territories around competitive threats
- **Market Analysis**: Understand geographic competitive dynamics
- **Risk Assessment**: Identify areas of high competitive concentration
		`
	})
	@ApiOkResponse({
		description: '✅ Map visualization data retrieved successfully',
		schema: {
			type: 'object',
			properties: {
				data: {
					type: 'object',
					properties: {
						competitors: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'number', example: 12345 },
									name: { type: 'string', example: 'BuildCorp Hardware' },
									position: {
										type: 'array',
										items: { type: 'number' },
										example: [-26.1278, 28.0582],
										description: 'Latitude, Longitude coordinates'
									},
									markerType: { type: 'string', example: 'competitor' },
									threatLevel: { type: 'number', example: 4 },
									isDirect: { type: 'boolean', example: true },
									industry: { type: 'string', example: 'Hardware & Building Supplies' },
									status: { type: 'string', example: 'ACTIVE' },
									website: { type: 'string', example: 'https://buildcorp.co.za' },
									logoUrl: { type: 'string', example: 'https://cdn.buildcorp.co.za/logo.png' },
									competitorRef: { type: 'string', example: 'COMP-2023-001' },
									address: {
										type: 'object',
										properties: {
											street: { type: 'string', example: '123 Industrial Avenue' },
											city: { type: 'string', example: 'Johannesburg' },
											state: { type: 'string', example: 'Gauteng' },
											country: { type: 'string', example: 'South Africa' }
										}
									},
									mapMetadata: {
										type: 'object',
										properties: {
											clusterGroup: { type: 'string', example: 'johannesburg-central' },
											zoomLevel: { type: 'number', example: 12 },
											showAtZoom: { type: 'number', example: 8 },
											markerSize: { type: 'string', example: 'large' },
											markerColor: { type: 'string', example: '#ff4444' }
										}
									}
								}
							}
						},
						mapConfig: {
							type: 'object',
							properties: {
								centerPosition: {
									type: 'array',
									items: { type: 'number' },
									example: [-26.1278, 28.0582],
									description: 'Default map center coordinates'
								},
								defaultZoom: { type: 'number', example: 10 },
								bounds: {
									type: 'object',
									properties: {
										north: { type: 'number', example: -25.5 },
										south: { type: 'number', example: -26.5 },
										east: { type: 'number', example: 28.5 },
										west: { type: 'number', example: 27.5 }
									}
								},
								clustersEnabled: { type: 'boolean', example: true },
								heatmapEnabled: { type: 'boolean', example: true }
							}
						},
						analytics: {
							type: 'object',
							properties: {
								totalMappedCompetitors: { type: 'number', example: 42 },
								competitorsWithCoordinates: { type: 'number', example: 39 },
								approximatedPositions: { type: 'number', example: 3 },
								competitiveHotspots: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											area: { type: 'string', example: 'Johannesburg CBD' },
											competitorCount: { type: 'number', example: 8 },
											averageThreatLevel: { type: 'number', example: 3.8 },
											dominantIndustry: { type: 'string', example: 'Hardware & Building Supplies' }
										}
									}
								}
							}
						}
					}
				},
				message: { type: 'string', example: 'Map visualization data retrieved successfully' },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' }
			}
		}
	})
	@ApiForbiddenResponse({
		description: '🚫 Forbidden - Map data access restricted',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'You do not have permission to access geographic competitor data' },
				error: { type: 'string', example: 'Forbidden' },
				statusCode: { type: 'number', example: 403 }
			}
		}
	})
	@ApiInternalServerErrorResponse({
		description: '💥 Internal Server Error - Map data generation failed',
		schema: {
			type: 'object',
			properties: {
				message: { type: 'string', example: 'Failed to generate map visualization data due to system error' },
				error: { type: 'string', example: 'Internal Server Error' },
				statusCode: { type: 'number', example: 500 },
				timestamp: { type: 'string', format: 'date-time', example: '2023-12-01T10:00:00Z' },
				path: { type: 'string', example: '/competitors/map-data' }
			}
		}
	})
	getCompetitorsForMap(@Request() req) {
		const { orgId, branchId } = this.extractOrgAndBranchIds(req);

		const filters = { isDeleted: false };
		return this.competitorsService.findAll(filters, 1, 1000, orgId, branchId)
			.then(({ data }) => {
				// Transform data into map-friendly format with mock positions
				return data.map(competitor => {
					// Create position (mock for now - would use geocoding in production)
					const position = this.createMockPosition();
					
					return {
						id: competitor.uid,
						name: competitor.name,
						position,
						markerType: 'competitor',
						threatLevel: competitor.threatLevel || 0,
						isDirect: competitor.isDirect || false,
						industry: competitor.industry || 'Unknown',
						status: competitor.status,
						website: competitor.website,
						logoUrl: competitor.logoUrl,
						competitorRef: competitor.competitorRef,
						address: competitor.address
					};
				});
			});
	}

	// Helper method to create mock positions
	private createMockPosition(): [number, number] {
		// Generate a position around Johannesburg
		const defaultLat = -26.1278;
		const defaultLng = 28.0582;
		
		// Generate a slight random offset (±0.05 degrees, roughly ±5km)
		const latOffset = (Math.random() - 0.5) * 0.1;
		const lngOffset = (Math.random() - 0.5) * 0.1;
		
		return [defaultLat + latOffset, defaultLng + lngOffset];
	}
}
