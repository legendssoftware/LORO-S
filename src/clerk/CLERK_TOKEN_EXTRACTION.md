# Clerk Token Extraction and Authentication Guide

## Overview
This document explains how Clerk tokens are extracted and used for authentication in the server.

## Token Flow

### 1. Mobile App → Server
- Mobile app sends token in **both** headers:
  - `Authorization: Bearer <token>` (REQUIRED by Clerk)
  - `token: <token>` (backward compatibility)

### 2. Server Extraction Priority
The server extracts tokens in this order:
1. `Authorization` header: `Bearer <token>` → extracts token after "Bearer "
2. `token` header: Direct token value
3. If `Authorization` missing but `token` exists, automatically adds `Authorization: Bearer <token>`

### 3. Clerk Authentication
- Uses Clerk's `authenticateRequest()` which expects `Authorization: Bearer <token>`
- Validates token signature, expiration, and authorized parties (CSRF protection)
- Returns `userId` and `sessionId` if valid

## Key Files

### Mobile: `mobile/lib/utils/axios-interceptor.ts`
- **Always** adds both `Authorization` and `token` headers
- Token retrieved from Clerk via `getClerkToken()`

### Server: `server/src/clerk/clerk.service.ts`
- Extracts token from headers
- **Automatically adds Authorization header** if missing but token header exists
- Calls Clerk's `authenticateRequest()` with proper headers

### Server: `server/src/clerk/clerk.guard.ts`
- Runs BEFORE RoleGuard
- Validates token via ClerkService
- Attaches user object to `request['user']`
- Must succeed for RoleGuard to work

## Common Issues

### Issue 1: Missing Authorization Header
**Symptoms**: RoleGuard logs show "No user object found"
**Cause**: Mobile app only sending `token` header, not `Authorization`
**Fix**: Axios interceptor now always adds both headers

### Issue 2: Token Expired
**Symptoms**: "Token expired" errors
**Cause**: Clerk session token has expired
**Fix**: Mobile app should refresh token or re-authenticate

### Issue 3: ClerkAuthGuard Not Running
**Symptoms**: Only RoleGuard logs appear, no ClerkAuthGuard logs
**Cause**: ClerkAuthGuard failing silently or exception being caught
**Fix**: Enhanced error logging in ClerkAuthGuard

## Best Practices

1. **Always use Authorization header**: Clerk requires `Authorization: Bearer <token>`
2. **Keep token header for compatibility**: Some legacy code may use it
3. **Handle token expiration**: Implement token refresh in mobile app
4. **Log at each stage**: Use operation IDs to trace requests through the chain
5. **Never log full tokens**: Only log first 20-30 characters for debugging

## Debugging

When debugging 401 errors, check logs in this order:
1. `[axios-interceptor]` - Token retrieved and headers set?
2. `[ClerkAuthGuard]` - Token received and authenticated?
3. `[ClerkService]` - Token extraction and Clerk validation?
4. `[RoleGuard]` - User object and role available?
5. `[LeadsController]` - User context in controller?

Each stage logs operation IDs that can be used to trace a specific request.
