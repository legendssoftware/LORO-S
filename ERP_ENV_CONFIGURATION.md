# ERP Database Environment Configuration

## Quick Start

Add these environment variables to your `.env` file to optimize ERP database connections:

```bash
# ============================================
# ERP DATABASE CONFIGURATION
# ============================================

# ERP Database Connection Details
ERP_DATABASE_HOST=your-erp-host.com
ERP_DATABASE_PORT=3306
ERP_DATABASE_NAME=erp_database_name
ERP_DATABASE_USER=erp_user
ERP_DATABASE_PASSWORD=your_secure_password

# ============================================
# ERP CONNECTION POOL CONFIGURATION
# ============================================

# ERP Connection Pool Size (Default: 30)
ERP_DB_CONNECTION_LIMIT=30

# ERP Idle Connection Timeout in ms (Default: 600000 = 10 minutes)
ERP_DB_IDLE_TIMEOUT=600000

# ERP Connection Acquisition Timeout in ms (Default: 30000 = 30 seconds)
ERP_DB_ACQUIRE_TIMEOUT=30000
```

---

## Configuration Details

### `ERP_DB_CONNECTION_LIMIT`

**Purpose:** Controls the size of the connection pool for the ERP database.

**Default:** `30`

**Recommended Values:**

| Load Type | User Count | Recommended Value |
|-----------|------------|-------------------|
| Light     | < 10       | `20`              |
| Medium    | 10-50      | `30` *(default)*  |
| Heavy     | 50+        | `50`              |

**Important Notes:**
- Each cache warming batch uses up to 8 connections
- Main queries can use 4 connections in parallel
- Ensure your MySQL server's `max_connections` can handle this

**Check MySQL max_connections:**
```sql
SHOW VARIABLES LIKE 'max_connections';
```

---

### `ERP_DB_IDLE_TIMEOUT`

**Purpose:** How long idle connections remain in the pool before being closed.

**Default:** `600000` (10 minutes)

**When to Adjust:**
- **Increase** if you run long aggregation queries
- **Decrease** if you want to free up connections faster
- **Typical Range:** 300000 - 900000 (5-15 minutes)

---

### `ERP_DB_ACQUIRE_TIMEOUT`

**Purpose:** Maximum time to wait when requesting a connection from the pool.

**Default:** `30000` (30 seconds)

**When to Adjust:**
- **Increase** if you see "Connection acquisition timeout" errors
- **Decrease** if you want queries to fail faster
- **Typical Range:** 15000 - 60000 (15-60 seconds)

---

## Monitoring Connection Pool Health

### API Endpoint

```bash
GET /erp/connection/pool
Authorization: Bearer YOUR_TOKEN
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "poolSize": 30,
    "activeConnections": 8,
    "idleConnections": 22
  },
  "timestamp": "2025-10-31T11:00:00.000Z"
}
```

### Health Indicators

✅ **Healthy Pool:**
- `activeConnections` < 70% of `poolSize`
- `idleConnections` > 5
- No acquisition timeout errors

⚠️ **Warning Signs:**
- `activeConnections` > 80% of `poolSize`
- `idleConnections` < 3
- Slow query response times

🚨 **Critical:**
- `activeConnections` = `poolSize` (pool exhausted)
- ECONNRESET errors in logs
- Connection acquisition timeouts

---

## Cache Warming Configuration

The cache warming service now uses **batched processing** to avoid overwhelming the connection pool:

| Setting | Value | Impact |
|---------|-------|--------|
| Batch Size | 2 date ranges | Max 8 concurrent queries |
| Retry Attempts | 3 | Automatic retry on failure |
| Backoff Strategy | 1s, 2s, 4s | Exponential with 5s cap |
| Batch Delay | 100ms | Recovery time between batches |

**Total Connection Usage:**
- Cache Warming: Up to 8 concurrent connections
- API Requests: Up to 4 concurrent connections per request
- Buffer: Remaining connections for other operations

---

## Troubleshooting

### Problem: Still seeing ECONNRESET errors

**Solutions:**

1. **Increase connection pool:**
   ```bash
   ERP_DB_CONNECTION_LIMIT=50
   ```

2. **Check MySQL server connections:**
   ```sql
   SHOW STATUS LIKE 'Threads_connected';
   SHOW STATUS LIKE 'Max_used_connections';
   ```

3. **Monitor connection pool:**
   ```bash
   curl http://localhost:3000/erp/connection/pool \
     -H "Authorization: Bearer TOKEN"
   ```

4. **Reduce batch size** in `erp-cache-warmer.service.ts`:
   ```typescript
   const BATCH_SIZE = 1; // More conservative
   ```

### Problem: Slow cache warming

**Solutions:**

1. **Increase batch size** (if connection pool is healthy):
   ```typescript
   const BATCH_SIZE = 3; // Process 3 date ranges at once
   ```

2. **Increase connection pool:**
   ```bash
   ERP_DB_CONNECTION_LIMIT=50
   ```

3. **Check database performance:**
   - Ensure indexes exist on `sale_date`, `doc_type`, `store`
   - Check for slow queries with MySQL slow query log

### Problem: Connection acquisition timeouts

**Solutions:**

1. **Increase timeout:**
   ```bash
   ERP_DB_ACQUIRE_TIMEOUT=60000
   ```

2. **Increase connection pool:**
   ```bash
   ERP_DB_CONNECTION_LIMIT=40
   ```

3. **Check for connection leaks:**
   - Monitor `activeConnections` over time
   - Should return to baseline after queries complete

---

## Performance Tuning

### MySQL Server Configuration

Ensure your MySQL server can handle the connection load:

```ini
# my.cnf or my.ini
[mysqld]
max_connections = 200
wait_timeout = 28800
interactive_timeout = 28800
max_allowed_packet = 64M
```

### Application Configuration

For optimal performance:

1. **Connection Pool:** Set to ~30-50 for production
2. **Cache TTL:** 1 hour (3600s) - already configured
3. **Batch Size:** 2 (default) - adjust based on monitoring

---

## Example Production Configuration

### Small Organization (< 10 concurrent users)
```bash
ERP_DB_CONNECTION_LIMIT=20
ERP_DB_IDLE_TIMEOUT=300000
ERP_DB_ACQUIRE_TIMEOUT=30000
```

### Medium Organization (10-50 concurrent users)
```bash
ERP_DB_CONNECTION_LIMIT=30
ERP_DB_IDLE_TIMEOUT=600000
ERP_DB_ACQUIRE_TIMEOUT=30000
```

### Large Organization (50+ concurrent users)
```bash
ERP_DB_CONNECTION_LIMIT=50
ERP_DB_IDLE_TIMEOUT=600000
ERP_DB_ACQUIRE_TIMEOUT=45000
```

---

## Verification Checklist

After updating configuration:

- [ ] Added environment variables to `.env`
- [ ] Restarted the server
- [ ] Checked startup logs for connection pool info
- [ ] Monitored first cache warming cycle (should be 100% success)
- [ ] Verified connection pool endpoint works
- [ ] No ECONNRESET errors in logs
- [ ] Cache warming completes in 8-10 seconds

---

## Additional Resources

- **ERP Connection Fix Summary:** `ERP_CONNECTION_FIX_SUMMARY.md`
- **Monitoring Endpoint:** `GET /erp/connection/pool`
- **Cache Warming Endpoint:** `POST /erp/cache/warm`
- **Cache Stats Endpoint:** `GET /erp/cache/stats`
- **Health Check Endpoint:** `GET /erp/health`

---

## Questions?

If you continue to experience issues:

1. Enable debug logging:
   ```typescript
   logging: true,  // in app.module.ts ERP connection
   ```

2. Monitor MySQL processlist:
   ```sql
   SHOW FULL PROCESSLIST;
   ```

3. Check application logs for:
   - Connection pool statistics
   - Cache warming success rates
   - Query execution times
   - ECONNRESET or timeout errors





