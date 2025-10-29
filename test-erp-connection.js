#!/usr/bin/env node

/**
 * ERP Database Connection Test Script
 * 
 * This script tests the connection to the ERP database independently
 * of the main application to help diagnose connection issues.
 * 
 * Usage:
 *   node test-erp-connection.js
 * 
 * Requirements:
 *   npm install mysql2 dotenv
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(message) {
  log('\n' + '='.repeat(60), 'cyan');
  log(message, 'bright');
  log('='.repeat(60), 'cyan');
}

async function testErpConnection() {
  header('ERP Database Connection Test');
  
  // Read configuration from .env
  const config = {
    host: process.env.ERP_DATABASE_HOST,
    port: parseInt(process.env.ERP_DATABASE_PORT || '3306', 10),
    user: process.env.ERP_DATABASE_USER,
    password: process.env.ERP_DATABASE_PASSWORD,
    database: process.env.ERP_DATABASE_NAME,
  };

  log('\n📋 Configuration:', 'bright');
  log(`  Host: ${config.host || 'NOT SET'}`, config.host ? 'green' : 'red');
  log(`  Port: ${config.port}`, 'green');
  log(`  Database: ${config.database || 'NOT SET'}`, config.database ? 'green' : 'red');
  log(`  User: ${config.user || 'NOT SET'}`, config.user ? 'green' : 'red');
  log(`  Password: ${'*'.repeat((config.password || '').length)}`, config.password ? 'green' : 'red');

  // Validate configuration
  if (!config.host || !config.database || !config.user || !config.password) {
    log('\n❌ CONFIGURATION ERROR: Missing required environment variables', 'red');
    log('\nRequired variables in .env file:', 'yellow');
    log('  - ERP_DATABASE_HOST', 'yellow');
    log('  - ERP_DATABASE_PORT', 'yellow');
    log('  - ERP_DATABASE_NAME', 'yellow');
    log('  - ERP_DATABASE_USER', 'yellow');
    log('  - ERP_DATABASE_PASSWORD', 'yellow');
    process.exit(1);
  }

  log('\n✅ Configuration validated', 'green');

  // Test 1: Network connectivity (TCP handshake)
  header('Test 1: Network Connectivity');
  log('Testing TCP connection to MySQL server...', 'cyan');
  
  const net = require('net');
  const socket = new net.Socket();
  
  const networkTest = await new Promise((resolve) => {
    socket.setTimeout(5000);
    
    socket.on('connect', () => {
      log('✅ TCP connection successful', 'green');
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      log('❌ Connection timeout', 'red');
      log('   Possible causes:', 'yellow');
      log('   - Server is not accessible from this network', 'yellow');
      log('   - Firewall is blocking the connection', 'yellow');
      log('   - VPN connection required', 'yellow');
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', (err) => {
      log(`❌ Connection error: ${err.message}`, 'red');
      log(`   Error code: ${err.code || 'N/A'}`, 'yellow');
      
      if (err.code === 'ENETUNREACH') {
        log('\n   ENETUNREACH means:', 'yellow');
        log('   - The network route to the host does not exist', 'yellow');
        log('   - You may need to connect to VPN', 'yellow');
        log('   - The IP address may be incorrect', 'yellow');
        log('   - The host may be on a different network segment', 'yellow');
      } else if (err.code === 'ECONNREFUSED') {
        log('\n   ECONNREFUSED means:', 'yellow');
        log('   - The server is accessible but MySQL is not running', 'yellow');
        log('   - MySQL is running on a different port', 'yellow');
        log('   - The server is refusing connections', 'yellow');
      } else if (err.code === 'EHOSTUNREACH') {
        log('\n   EHOSTUNREACH means:', 'yellow');
        log('   - No route to the host', 'yellow');
        log('   - The host is down or unreachable', 'yellow');
      }
      
      resolve(false);
    });
    
    socket.connect(config.port, config.host);
  });

  if (!networkTest) {
    log('\n🛑 Cannot proceed: Network connectivity test failed', 'red');
    log('\nTroubleshooting steps:', 'yellow');
    log('1. Verify the IP address is correct', 'yellow');
    log('2. Check if you need to be on VPN', 'yellow');
    log('3. Try pinging the server: ping ' + config.host, 'yellow');
    log('4. Check firewall rules', 'yellow');
    log('5. Contact your network administrator', 'yellow');
    process.exit(1);
  }

  // Test 2: MySQL authentication
  header('Test 2: MySQL Authentication');
  log('Attempting MySQL authentication...', 'cyan');
  
  let connection;
  try {
    const startTime = Date.now();
    connection = await mysql.createConnection(config);
    const duration = Date.now() - startTime;
    
    log(`✅ MySQL authentication successful (${duration}ms)`, 'green');
    log(`   Connected as: ${config.user}@${config.host}`, 'green');
  } catch (error) {
    log(`❌ MySQL authentication failed: ${error.message}`, 'red');
    log(`   Error code: ${error.code || 'N/A'}`, 'yellow');
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      log('\n   ACCESS DENIED means:', 'yellow');
      log('   - Username or password is incorrect', 'yellow');
      log('   - User does not have access from this host', 'yellow');
      log('   - Check ERP_DATABASE_USER and ERP_DATABASE_PASSWORD', 'yellow');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      log('\n   BAD DATABASE means:', 'yellow');
      log('   - The database name is incorrect', 'yellow');
      log('   - The database does not exist', 'yellow');
      log('   - Check ERP_DATABASE_NAME', 'yellow');
    }
    
    process.exit(1);
  }

  // Test 3: Database and table access
  header('Test 3: Database and Table Access');
  log('Checking database and tables...', 'cyan');
  
  try {
    // Check database
    const [databases] = await connection.query('SHOW DATABASES');
    const dbExists = databases.some(db => db.Database === config.database);
    
    if (dbExists) {
      log(`✅ Database '${config.database}' exists`, 'green');
    } else {
      log(`❌ Database '${config.database}' not found`, 'red');
      log('\n   Available databases:', 'yellow');
      databases.forEach(db => log(`   - ${db.Database}`, 'yellow'));
      await connection.end();
      process.exit(1);
    }

    // Switch to the database
    await connection.query(`USE \`${config.database}\``);
    log(`✅ Successfully switched to database '${config.database}'`, 'green');

    // Check for required tables
    const [tables] = await connection.query('SHOW TABLES');
    const tableList = tables.map(t => Object.values(t)[0]);
    
    log(`\n   Found ${tableList.length} tables:`, 'green');
    
    const requiredTables = ['tblsalesheader', 'tblsaleslines'];
    const missingTables = [];
    
    requiredTables.forEach(tableName => {
      const exists = tableList.some(t => t.toLowerCase() === tableName.toLowerCase());
      if (exists) {
        log(`   ✅ ${tableName}`, 'green');
      } else {
        log(`   ❌ ${tableName} (MISSING)`, 'red');
        missingTables.push(tableName);
      }
    });

    if (missingTables.length > 0) {
      log(`\n⚠️  WARNING: Missing required tables: ${missingTables.join(', ')}`, 'yellow');
    }

  } catch (error) {
    log(`❌ Database access failed: ${error.message}`, 'red');
    await connection.end();
    process.exit(1);
  }

  // Test 4: Query execution
  header('Test 4: Query Execution');
  log('Testing query execution on tblsaleslines...', 'cyan');
  
  try {
    const startTime = Date.now();
    const [rows] = await connection.query('SELECT COUNT(*) as count FROM tblsaleslines LIMIT 1');
    const duration = Date.now() - startTime;
    
    const count = rows[0].count;
    log(`✅ Query executed successfully (${duration}ms)`, 'green');
    log(`   Total records in tblsaleslines: ${count.toLocaleString()}`, 'green');

    // Check for recent data
    log('\n   Checking data freshness...', 'cyan');
    const [recentData] = await connection.query(`
      SELECT 
        MAX(sale_date) as last_sale_date,
        MIN(sale_date) as first_sale_date,
        COUNT(DISTINCT store) as store_count
      FROM tblsaleslines
    `);
    
    if (recentData[0].last_sale_date) {
      const lastDate = new Date(recentData[0].last_sale_date);
      const firstDate = new Date(recentData[0].first_sale_date);
      const today = new Date();
      const daysOld = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
      
      log(`   Latest sale date: ${lastDate.toISOString().split('T')[0]}`, 'green');
      log(`   Earliest sale date: ${firstDate.toISOString().split('T')[0]}`, 'green');
      log(`   Data age: ${daysOld} days old`, daysOld <= 7 ? 'green' : 'yellow');
      log(`   Number of stores: ${recentData[0].store_count}`, 'green');
      
      if (daysOld > 7) {
        log(`   ⚠️  WARNING: Data is more than 7 days old`, 'yellow');
      }
    }

  } catch (error) {
    log(`❌ Query execution failed: ${error.message}`, 'red');
    await connection.end();
    process.exit(1);
  }

  // Test 5: Performance check
  header('Test 5: Performance Check');
  log('Running performance test query...', 'cyan');
  
  try {
    const startTime = Date.now();
    const [rows] = await connection.query(`
      SELECT 
        store,
        COUNT(*) as transaction_count,
        SUM(incl_line_total) as total_revenue
      FROM tblsaleslines
      WHERE sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY store
      ORDER BY total_revenue DESC
      LIMIT 10
    `);
    const duration = Date.now() - startTime;
    
    log(`✅ Performance query executed (${duration}ms)`, duration < 5000 ? 'green' : 'yellow');
    log(`   Retrieved ${rows.length} stores`, 'green');
    
    if (duration > 5000) {
      log(`   ⚠️  WARNING: Query took longer than 5 seconds`, 'yellow');
      log(`   Consider adding database indexes (see DATABASE_INDEXES.md)`, 'yellow');
    }

  } catch (error) {
    log(`❌ Performance query failed: ${error.message}`, 'red');
  }

  // Cleanup
  await connection.end();

  // Final summary
  header('🎉 All Tests Passed!');
  log('The ERP database connection is working correctly.', 'green');
  log('\nYou can now start the application:', 'cyan');
  log('  npm run start:dev', 'bright');
  log('\nThe application should connect successfully to the ERP database.', 'green');
}

// Run the tests
testErpConnection().catch((error) => {
  log(`\n\n❌ UNEXPECTED ERROR: ${error.message}`, 'red');
  log(error.stack, 'red');
  process.exit(1);
});

