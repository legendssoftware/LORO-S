import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { TblSalesHeader } from '../entities/tblsalesheader.entity';
import { TblSalesLines } from '../entities/tblsaleslines.entity';
import { TblCustomers } from '../entities/tblcustomers.entity';
import { TblCustomerCategories } from '../entities/tblcustomercategories.entity';
import { TblSalesman } from '../entities/tblsalesman.entity';
import { TblMultistore } from '../entities/tblmultistore.entity';
import { TblForexHistory } from '../entities/tblforex-history.entity';

/**
 * Country to database name mapping
 */
const COUNTRY_DATABASE_MAP: Record<string, string> = {
	SA: 'bit_drywall',
	BOT: 'bit_botswana',
	ZW: 'bit_zimbabwe',
	ZAM: 'bit_zambia',
	MOZ: 'bit_mozambique',
};

/**
 * ERP Connection Manager Service
 * 
 * Manages multiple TypeORM DataSource connections (one per country).
 * - Initializes SA connection on module startup (default)
 * - Lazy-loads other country connections on first use
 * - Caches connections to avoid reconnection overhead
 * - Provides method to get DataSource for a given country code
 */
@Injectable()
export class ErpConnectionManagerService implements OnModuleInit {
	private readonly logger = new Logger(ErpConnectionManagerService.name);
	private readonly connections: Map<string, DataSource> = new Map();
	private readonly connectionPromises: Map<string, Promise<DataSource>> = new Map();
	private defaultConnection: DataSource | null = null;
	private consolidatedConnection: DataSource | null = null;
	private consolidatedConnectionPromise: Promise<DataSource> | null = null;
	private readonly DEFAULT_COUNTRY = 'SA';

	constructor(private readonly configService: ConfigService) {}

	/**
	 * Initialize default connection (SA) on module startup
	 */
	async onModuleInit() {
		const operationId = 'CONN-MGR-INIT';
		this.logger.log(`[${operationId}] Initializing ERP Connection Manager...`);

		try {
			// Initialize default SA connection immediately
			await this.initializeDefaultConnection();
			this.logger.log(`[${operationId}] ✅ ERP Connection Manager initialized successfully`);
		} catch (error) {
			this.logger.error(`[${operationId}] ❌ Failed to initialize ERP Connection Manager: ${error.message}`);
			this.logger.error(`[${operationId}] Stack: ${error.stack}`);
		}
	}

	/**
	 * Initialize default connection (SA) on startup
	 */
	private async initializeDefaultConnection(): Promise<void> {
		const operationId = 'INIT-DEFAULT';
		this.logger.log(`[${operationId}] Initializing default connection for country: ${this.DEFAULT_COUNTRY}`);

		try {
			const connection = await this.getConnection(this.DEFAULT_COUNTRY);
			this.defaultConnection = connection;
			this.logger.log(`[${operationId}] ✅ Default connection (${this.DEFAULT_COUNTRY}) initialized successfully`);
		} catch (error) {
			this.logger.error(`[${operationId}] ❌ Failed to initialize default connection: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get or create connection for country
	 * Returns cached connection if available, otherwise creates new one
	 */
	async getConnection(countryCode: string): Promise<DataSource> {
		// Normalize country code
		const normalizedCountry = this.normalizeCountryCode(countryCode);

		// Return cached connection if available
		if (this.connections.has(normalizedCountry)) {
			const connection = this.connections.get(normalizedCountry)!;
			if (connection.isInitialized) {
				return connection;
			} else {
				// Connection was closed, remove from cache and recreate
				this.connections.delete(normalizedCountry);
			}
		}

		// Check if connection is already being created
		if (this.connectionPromises.has(normalizedCountry)) {
			return this.connectionPromises.get(normalizedCountry)!;
		}

		// Create new connection promise
		const connectionPromise = this.createConnection(normalizedCountry);
		this.connectionPromises.set(normalizedCountry, connectionPromise);

		try {
			const connection = await connectionPromise;
			this.connections.set(normalizedCountry, connection);
			this.connectionPromises.delete(normalizedCountry);
			return connection;
		} catch (error) {
			this.connectionPromises.delete(normalizedCountry);
			throw error;
		}
	}

	/**
	 * Create a new DataSource connection for a country
	 */
	private async createConnection(countryCode: string): Promise<DataSource> {
		const operationId = `CREATE-${countryCode}`;
		const databaseName = this.getDatabaseName(countryCode);

		if (!databaseName) {
			throw new Error(`Invalid country code: ${countryCode}. Supported codes: ${Object.keys(COUNTRY_DATABASE_MAP).join(', ')}`);
		}

		this.logger.log(`[${operationId}] Creating connection for country: ${countryCode} → database: ${databaseName}`);

		const host = this.configService.get<string>('ERP_DATABASE_HOST') || '41.77.30.252';
		const port = parseInt(this.configService.get<string>('ERP_DATABASE_PORT') || '3306', 10);
		const username = this.configService.get<string>('ERP_DATABASE_USER') || 'root';
		const password = this.configService.get<string>('ERP_DATABASE_PASSWORD') || 'Legend1501';

		const options: DataSourceOptions = {
			type: 'mysql',
			host,
			port,
			username,
			password,
			database: databaseName,
			entities: [TblSalesHeader, TblSalesLines, TblCustomers, TblCustomerCategories, TblSalesman, TblMultistore],
			synchronize: false, // CRITICAL: Never sync with ERP database
			logging: false,
			extra: {
				connectionLimit: parseInt(this.configService.get<string>('ERP_DB_CONNECTION_LIMIT') || '75', 10),
				connectTimeout: parseInt(this.configService.get<string>('ERP_DB_CONNECT_TIMEOUT') || '10000', 10),
				acquireTimeout: parseInt(this.configService.get<string>('ERP_DB_ACQUIRE_TIMEOUT') || '30000', 10),
				timeout: parseInt(this.configService.get<string>('ERP_DB_QUERY_TIMEOUT') || '90000', 10),
				idleTimeout: parseInt(this.configService.get<string>('ERP_DB_IDLE_TIMEOUT') || '600000', 10),
				waitForConnections: true,
				queueLimit: 0,
				keepAliveInitialDelay: 0,
				enableKeepAlive: true,
				dateStrings: false,
				ssl: this.configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
				supportBigNumbers: true,
				bigNumberStrings: false,
				charset: 'utf8mb4',
				timezone: 'Z',
				multipleStatements: false,
				typeCast: true,
			},
		};

		const dataSource = new DataSource(options);

		try {
			await dataSource.initialize();
			this.logger.log(`[${operationId}] ✅ Connection created successfully for ${countryCode} → ${databaseName}`);
			return dataSource;
		} catch (error) {
			this.logger.error(`[${operationId}] ❌ Failed to create connection for ${countryCode}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Ensure connection exists for country (lazy-load if needed)
	 */
	async ensureConnection(countryCode: string): Promise<void> {
		await this.getConnection(countryCode);
	}

	/**
	 * Get default connection (SA) - fast path
	 */
	getDefaultConnection(): DataSource {
		if (!this.defaultConnection || !this.defaultConnection.isInitialized) {
			throw new Error('Default connection not initialized. Call getConnection("SA") first.');
		}
		return this.defaultConnection;
	}

	/**
	 * Get database name for country code
	 */
	private getDatabaseName(countryCode: string): string | null {
		const normalized = this.normalizeCountryCode(countryCode);
		return COUNTRY_DATABASE_MAP[normalized] || null;
	}

	/**
	 * Normalize country code (uppercase)
	 * 
	 * Each country has its own distinct code and database:
	 * - SA → bit_drywall (South Africa)
	 * - BOT → bit_botswana (Botswana)
	 * - ZW → bit_zimbabwe (Zimbabwe)
	 * - ZAM → bit_zambia (Zambia)
	 * - MOZ → bit_mozambique (Mozambique)
	 */
	private normalizeCountryCode(countryCode: string): string {
		if (!countryCode) {
			return this.DEFAULT_COUNTRY;
		}

		const upper = countryCode.toUpperCase().trim();

		// No normalization needed - each country has its own distinct code and database
		return upper;
	}

	/**
	 * Get consolidated database connection for forex/exchange rate queries
	 * Connects to bit_consolidated database
	 */
	async getConsolidatedConnection(): Promise<DataSource> {
		const operationId = 'GET-CONSOLIDATED';
		
		if (this.consolidatedConnection?.isInitialized) {
			return this.consolidatedConnection;
		}

		if (this.consolidatedConnectionPromise) {
			return this.consolidatedConnectionPromise;
		}

		this.consolidatedConnectionPromise = this.createConsolidatedConnection();
		
		try {
			const connection = await this.consolidatedConnectionPromise;
			this.consolidatedConnection = connection;
			this.consolidatedConnectionPromise = null;
			return connection;
		} catch (error) {
			this.consolidatedConnectionPromise = null;
			throw error;
		}
	}

	/**
	 * Create consolidated database connection
	 */
	private async createConsolidatedConnection(): Promise<DataSource> {
		const operationId = 'CREATE-CONSOLIDATED';
		const databaseName = 'bit_consolidated';

		this.logger.log(`[${operationId}] Creating consolidated database connection → ${databaseName}`);

		const host = this.configService.get<string>('ERP_DATABASE_HOST') || '41.77.30.252';
		const port = parseInt(this.configService.get<string>('ERP_DATABASE_PORT') || '3306', 10);
		const username = this.configService.get<string>('ERP_DATABASE_USER') || 'root';
		const password = this.configService.get<string>('ERP_DATABASE_PASSWORD') || 'Legend1501';

		const options: DataSourceOptions = {
			type: 'mysql',
			host,
			port,
			username,
			password,
			database: databaseName,
			entities: [TblForexHistory],
			synchronize: false,
			logging: false,
			extra: {
				connectionLimit: parseInt(this.configService.get<string>('ERP_DB_CONNECTION_LIMIT') || '75', 10),
				connectTimeout: parseInt(this.configService.get<string>('ERP_DB_CONNECT_TIMEOUT') || '10000', 10),
				acquireTimeout: parseInt(this.configService.get<string>('ERP_DB_ACQUIRE_TIMEOUT') || '30000', 10),
				timeout: parseInt(this.configService.get<string>('ERP_DB_QUERY_TIMEOUT') || '90000', 10),
				idleTimeout: parseInt(this.configService.get<string>('ERP_DB_IDLE_TIMEOUT') || '600000', 10),
				waitForConnections: true,
				queueLimit: 0,
				keepAliveInitialDelay: 0,
				enableKeepAlive: true,
				dateStrings: false,
				ssl: this.configService.get<string>('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
				supportBigNumbers: true,
				bigNumberStrings: false,
				charset: 'utf8mb4',
				timezone: 'Z',
				multipleStatements: false,
				typeCast: true,
			},
		};

		const dataSource = new DataSource(options);

		try {
			await dataSource.initialize();
			this.logger.log(`[${operationId}] ✅ Consolidated database connection created → ${databaseName}`);
			return dataSource;
		} catch (error) {
			this.logger.error(`[${operationId}] ❌ Failed to create consolidated connection: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Get all active connections
	 */
	getActiveConnections(): Map<string, DataSource> {
		return new Map(this.connections);
	}

	/**
	 * Close all connections (cleanup)
	 */
	async closeAllConnections(): Promise<void> {
		const operationId = 'CLOSE-ALL';
		this.logger.log(`[${operationId}] Closing all ERP connections...`);

		const closePromises = Array.from(this.connections.entries()).map(async ([country, connection]) => {
			try {
				if (connection.isInitialized) {
					await connection.destroy();
					this.logger.log(`[${operationId}] ✅ Closed connection for ${country}`);
				}
			} catch (error) {
				this.logger.error(`[${operationId}] ❌ Failed to close connection for ${country}: ${error.message}`);
			}
		});

		// Close consolidated connection
		if (this.consolidatedConnection?.isInitialized) {
			try {
				await this.consolidatedConnection.destroy();
				this.logger.log(`[${operationId}] ✅ Closed consolidated database connection`);
			} catch (error) {
				this.logger.error(`[${operationId}] ❌ Failed to close consolidated connection: ${error.message}`);
			}
		}

		await Promise.all(closePromises);
		this.connections.clear();
		this.defaultConnection = null;
		this.consolidatedConnection = null;
		this.logger.log(`[${operationId}] ✅ All connections closed`);
	}
}

