# PostgreSQL Relationship Fix Blueprint

## Overview
This blueprint provides a systematic approach to fix TypeORM relationships for PostgreSQL compatibility across all entities and services in the application.

## Problem Statement
When migrating from MySQL to PostgreSQL, TypeORM relationships that worked in MySQL may fail because:
1. PostgreSQL requires explicit foreign key column definitions
2. Missing `@JoinColumn` decorators cause relationship loading failures
3. Using `relations: []` arrays in queries is less reliable than explicit joins

## Solution Summary
1. **Entity Level**: Add explicit `@JoinColumn` decorators with column names
2. **Entity Level**: Add explicit foreign key columns for `@ManyToOne` relationships
3. **Service Level**: Replace `relations: []` arrays with explicit `leftJoinAndSelect()` calls

---

## Part 1: Entity Relationship Fixes

### Step 1.1: Fix `@ManyToOne` Relationships

**Pattern to Find:**
```typescript
@ManyToOne(() => RelatedEntity, (related) => related?.property)
relatedEntity: RelatedEntity;
```

**Fix Pattern:**
```typescript
@ManyToOne(() => RelatedEntity, (related) => related?.property, { nullable: true })
@JoinColumn({ name: 'relatedEntityUid' })  // Use camelCase + 'Uid' or 'Id'
relatedEntity: RelatedEntity;

@Column({ type: 'int', nullable: true })
relatedEntityUid: number;  // Explicit FK column
```

**Naming Convention:**
- For entities with `uid` primary key: `{entityName}Uid`
- For entities with `id` primary key: `{entityName}Id`
- Examples: `branchUid`, `organisationRef`, `userId`, `clientId`

**Example - Before:**
```typescript
@ManyToOne(() => Branch, (branch) => branch?.users)
branch: Branch;
```

**Example - After:**
```typescript
@ManyToOne(() => Branch, (branch) => branch?.users, { nullable: true })
@JoinColumn({ name: 'branchUid' })
branch: Branch;

@Column({ type: 'int', nullable: true })
branchUid: number;
```

---

### Step 1.2: Fix `@OneToOne` Relationships

**Pattern to Find:**
```typescript
@OneToOne(() => RelatedEntity, (related) => related?.property)
relatedEntity: RelatedEntity;
```

**Fix Pattern - When Entity Owns Relationship (has FK):**
```typescript
@OneToOne(() => RelatedEntity, (related) => related?.property)
@JoinColumn({ name: 'relatedEntityUid' })  // Explicit column name
relatedEntity: RelatedEntity;
```

**Fix Pattern - When Related Entity Owns Relationship:**
```typescript
// On the entity WITHOUT the FK (inverse side)
@OneToOne(() => RelatedEntity, (related) => related?.property)
relatedEntity: RelatedEntity;  // No @JoinColumn needed here

// On the entity WITH the FK (owning side)
@OneToOne(() => MainEntity, (main) => main?.relatedEntity)
@JoinColumn({ name: 'mainEntityUid' })  // FK column name
mainEntity: MainEntity;
```

**Example - Before:**
```typescript
// In UserTarget entity
@OneToOne(() => User, (user) => user.userTarget)
user: User;
```

**Example - After:**
```typescript
// In UserTarget entity
@OneToOne(() => User, (user) => user.userTarget)
@JoinColumn({ name: 'userUid' })
user: User;
```

**Example - Before:**
```typescript
// In UserProfile entity
@OneToOne(() => User, (user) => user?.userProfile)
owner: User;
```

**Example - After:**
```typescript
// In UserProfile entity
@OneToOne(() => User, (user) => user?.userProfile)
@JoinColumn({ name: 'ownerUid' })
owner: User;
```

---

### Step 1.3: Fix `@OneToMany` Relationships

**Note:** `@OneToMany` relationships don't need `@JoinColumn` (they're inverse relationships). However, ensure the corresponding `@ManyToOne` side is properly configured.

**Pattern to Find:**
```typescript
@OneToMany(() => RelatedEntity, (related) => related?.owner)
relatedEntities: RelatedEntity[];
```

**Fix Pattern:**
```typescript
// No changes needed, but verify the ManyToOne side has @JoinColumn
@OneToMany(() => RelatedEntity, (related) => related?.owner, { nullable: true })
relatedEntities: RelatedEntity[];
```

---

### Step 1.4: Import `JoinColumn` if Missing

**Pattern to Find:**
```typescript
import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	ManyToOne,
	OneToOne,
	OneToMany,
} from 'typeorm';
```

**Fix Pattern:**
```typescript
import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	ManyToOne,
	OneToOne,
	OneToMany,
	JoinColumn,  // Add this
} from 'typeorm';
```

---

## Part 2: Service Query Fixes

### Step 2.1: Replace `relations: []` with QueryBuilder

**Pattern to Find:**
```typescript
const entity = await this.repository.findOne({
	where: { uid: id },
	relations: ['relation1', 'relation2', 'relation3'],
});
```

**Fix Pattern:**
```typescript
const entity = await this.repository
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.relation1', 'relation1')
	.leftJoinAndSelect('entity.relation2', 'relation2')
	.leftJoinAndSelect('entity.relation3', 'relation3')
	.where('entity.uid = :id', { id })
	.getOne();
```

---

### Step 2.2: Replace `relations: []` in `find()` Queries

**Pattern to Find:**
```typescript
const entities = await this.repository.find({
	where: { isDeleted: false },
	relations: ['relation1', 'relation2'],
});
```

**Fix Pattern:**
```typescript
const entities = await this.repository
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.relation1', 'relation1')
	.leftJoinAndSelect('entity.relation2', 'relation2')
	.where('entity.isDeleted = :isDeleted', { isDeleted: false })
	.getMany();
```

---

### Step 2.3: Replace `relations: []` with Complex Where Conditions

**Pattern to Find:**
```typescript
const entity = await this.repository.findOne({
	where: {
		uid: id,
		isDeleted: false,
		...(orgId && { organisation: { uid: orgId } }),
		...(branchId && { branch: { uid: branchId } }),
	},
	relations: ['organisation', 'branch'],
});
```

**Fix Pattern:**
```typescript
const queryBuilder = this.repository
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.organisation', 'organisation')
	.leftJoinAndSelect('entity.branch', 'branch')
	.where('entity.uid = :id', { id })
	.andWhere('entity.isDeleted = :isDeleted', { isDeleted: false });

if (orgId) {
	queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
}

if (branchId) {
	queryBuilder.andWhere('branch.uid = :branchId', { branchId });
}

const entity = await queryBuilder.getOne();
```

---

### Step 2.4: Replace `relations: []` in Transaction Managers

**Pattern to Find:**
```typescript
const entity = await queryRunner.manager.findOne(Entity, {
	where: { uid: id },
	relations: ['relation1', 'relation2'],
});
```

**Fix Pattern:**
```typescript
const entity = await queryRunner.manager
	.createQueryBuilder(Entity, 'entity')
	.leftJoinAndSelect('entity.relation1', 'relation1')
	.leftJoinAndSelect('entity.relation2', 'relation2')
	.where('entity.uid = :id', { id })
	.getOne();
```

---

### Step 2.5: Replace Nested Relations

**Pattern to Find:**
```typescript
const entities = await this.repository.find({
	where: { condition: true },
	relations: ['relation1', 'relation1.nestedRelation', 'relation2'],
});
```

**Fix Pattern:**
```typescript
const entities = await this.repository
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.relation1', 'relation1')
	.leftJoinAndSelect('relation1.nestedRelation', 'nestedRelation')
	.leftJoinAndSelect('entity.relation2', 'relation2')
	.where('entity.condition = :condition', { condition: true })
	.getMany();
```

---

### Step 2.6: Create Helper Methods for Common Patterns

**Pattern to Create:**
```typescript
/**
 * Build query builder with standard entity relationships for PostgreSQL compatibility
 * @param queryBuilder - The query builder to enhance
 * @param includeRelation1 - Whether to include relation1
 * @param includeRelation2 - Whether to include relation2
 * @returns Enhanced query builder with relationships loaded
 */
private buildEntityQueryWithRelations(
	queryBuilder: any,
	includeRelation1: boolean = false,
	includeRelation2: boolean = false,
): any {
	queryBuilder
		.leftJoinAndSelect('entity.organisation', 'organisation')
		.leftJoinAndSelect('entity.branch', 'branch');

	if (includeRelation1) {
		queryBuilder.leftJoinAndSelect('entity.relation1', 'relation1');
	}

	if (includeRelation2) {
		queryBuilder.leftJoinAndSelect('entity.relation2', 'relation2');
	}

	return queryBuilder;
}
```

**Usage:**
```typescript
const queryBuilder = this.repository
	.createQueryBuilder('entity')
	.where('entity.uid = :id', { id });

this.buildEntityQueryWithRelations(queryBuilder, true, false);
const entity = await queryBuilder.getOne();
```

---

## Part 3: Common Relationship Patterns

### Pattern 3.1: Organisation Relationship

**Entity Fix:**
```typescript
@ManyToOne(() => Organisation, { onDelete: 'SET NULL', nullable: true })
@JoinColumn({ name: 'organisationRef' })  // Often uses 'Ref' instead of 'Uid'
organisation: Organisation;

@Column({ nullable: true })
organisationRef: string;  // Often string type
```

**Service Fix:**
```typescript
.leftJoinAndSelect('entity.organisation', 'organisation')
```

---

### Pattern 3.2: Branch Relationship

**Entity Fix:**
```typescript
@ManyToOne(() => Branch, (branch) => branch?.entities, { nullable: true })
@JoinColumn({ name: 'branchUid' })
branch: Branch;

@Column({ type: 'int', nullable: true })
branchUid: number;
```

**Service Fix:**
```typescript
.leftJoinAndSelect('entity.branch', 'branch')
```

---

### Pattern 3.3: User/Owner Relationship

**Entity Fix:**
```typescript
@ManyToOne(() => User, (user) => user?.entities, { nullable: true })
@JoinColumn({ name: 'ownerUid' })  // or 'createdByUid', 'userId', etc.
owner: User;

@Column({ type: 'int', nullable: true })
ownerUid: number;
```

**Service Fix:**
```typescript
.leftJoinAndSelect('entity.owner', 'owner')
```

---

### Pattern 3.4: Client Relationship

**Entity Fix:**
```typescript
@ManyToOne(() => Client, (client) => client?.entities, { nullable: true })
@JoinColumn({ name: 'clientUid' })
client: Client;

@Column({ type: 'int', nullable: true })
clientUid: number;
```

**Service Fix:**
```typescript
.leftJoinAndSelect('entity.client', 'client')
```

---

## Part 4: Implementation Checklist

### For Each Entity File:

- [ ] **Step 1**: Scan for all `@ManyToOne` relationships
  - [ ] Add `@JoinColumn({ name: 'columnName' })` decorator
  - [ ] Add explicit FK column definition
  - [ ] Ensure `JoinColumn` is imported

- [ ] **Step 2**: Scan for all `@OneToOne` relationships
  - [ ] Determine which side owns the relationship (has FK)
  - [ ] Add `@JoinColumn({ name: 'columnName' })` on owning side
  - [ ] Ensure `JoinColumn` is imported

- [ ] **Step 3**: Verify `@OneToMany` relationships
  - [ ] Ensure corresponding `@ManyToOne` side is fixed
  - [ ] No changes needed for `@OneToMany` itself

- [ ] **Step 4**: Check imports
  - [ ] Ensure `JoinColumn` is imported from 'typeorm'

---

### For Each Service File:

- [ ] **Step 1**: Search for `relations: [` pattern
  - [ ] Count occurrences
  - [ ] List all unique relation names used

- [ ] **Step 2**: Replace `findOne()` with `relations`
  - [ ] Convert to QueryBuilder pattern
  - [ ] Use `leftJoinAndSelect()` for each relation
  - [ ] Preserve all where conditions

- [ ] **Step 3**: Replace `find()` with `relations`
  - [ ] Convert to QueryBuilder pattern
  - [ ] Use `leftJoinAndSelect()` for each relation
  - [ ] Preserve all where conditions

- [ ] **Step 4**: Replace transaction manager queries
  - [ ] Convert `queryRunner.manager.findOne()` to QueryBuilder
  - [ ] Use `queryRunner.manager.createQueryBuilder()`

- [ ] **Step 5**: Create helper methods (optional)
  - [ ] Identify common relation patterns
  - [ ] Create reusable helper methods
  - [ ] Update queries to use helpers

- [ ] **Step 6**: Test queries
  - [ ] Verify all relationships load correctly
  - [ ] Check for null/undefined handling
  - [ ] Verify access control filters still work

---

## Part 5: Common Pitfalls & Solutions

### Pitfall 1: Missing FK Column Definition
**Problem:** Added `@JoinColumn` but forgot to add the FK column
**Solution:** Always add both `@JoinColumn` and `@Column` for `@ManyToOne`

### Pitfall 2: Wrong Column Name
**Problem:** Column name in `@JoinColumn` doesn't match database
**Solution:** Check migration script or database schema for actual column names

### Pitfall 3: Nested Relations Not Loading
**Problem:** Using `relations: ['relation.nested']` doesn't work
**Solution:** Use multiple `leftJoinAndSelect()` calls:
```typescript
.leftJoinAndSelect('entity.relation', 'relation')
.leftJoinAndSelect('relation.nested', 'nested')
```

### Pitfall 4: Access Control Filters Broken
**Problem:** Converting to QueryBuilder breaks org/branch filters
**Solution:** Use conditional `andWhere()` clauses:
```typescript
if (orgId) {
	queryBuilder.andWhere('organisation.uid = :orgId', { orgId });
}
```

### Pitfall 5: Transaction Manager Queries
**Problem:** Forgot to convert transaction manager queries
**Solution:** Use `queryRunner.manager.createQueryBuilder()` instead of `findOne()`

---

## Part 6: Verification Steps

### Entity Verification:
1. ✅ All `@ManyToOne` have `@JoinColumn` with explicit name
2. ✅ All `@ManyToOne` have corresponding FK column
3. ✅ All `@OneToOne` have `@JoinColumn` on owning side
4. ✅ `JoinColumn` is imported from 'typeorm'
5. ✅ Column names follow naming convention

### Service Verification:
1. ✅ No `relations: []` arrays found in codebase
2. ✅ All queries use QueryBuilder with `leftJoinAndSelect()`
3. ✅ Access control filters preserved
4. ✅ Transaction manager queries converted
5. ✅ Helper methods created for common patterns

### Testing Checklist:
1. ✅ Test entity creation with relationships
2. ✅ Test entity updates with relationships
3. ✅ Test entity queries with relationships
4. ✅ Test access control filters
5. ✅ Test nested relationships
6. ✅ Test transaction rollbacks

---

## Part 7: Example: Complete Entity + Service Fix

### Entity Example: `client.entity.ts`

**Before:**
```typescript
@ManyToOne(() => Organisation, (organisation) => organisation?.clients, { nullable: true })
organisation: Organisation;

@ManyToOne(() => Branch, (branch) => branch?.clients, { nullable: true })
branch: Branch;

@ManyToOne(() => User, (user) => user?.clients, { nullable: true })
assignedSalesRep: User;
```

**After:**
```typescript
@ManyToOne(() => Organisation, (organisation) => organisation?.clients, { nullable: true })
@JoinColumn({ name: 'organisationRef' })
organisation: Organisation;

@Column({ nullable: true })
organisationRef: string;

@ManyToOne(() => Branch, (branch) => branch?.clients, { nullable: true })
@JoinColumn({ name: 'branchUid' })
branch: Branch;

@Column({ type: 'int', nullable: true })
branchUid: number;

@ManyToOne(() => User, (user) => user?.clients, { nullable: true })
@JoinColumn({ name: 'assignedSalesRepUid' })
assignedSalesRep: User;

@Column({ type: 'int', nullable: true })
assignedSalesRepUid: number;
```

### Service Example: `clients.service.ts`

**Before:**
```typescript
const client = await this.clientRepository.findOne({
	where: { uid: clientId, isDeleted: false },
	relations: ['organisation', 'branch', 'assignedSalesRep'],
});
```

**After:**
```typescript
const client = await this.clientRepository
	.createQueryBuilder('client')
	.leftJoinAndSelect('client.organisation', 'organisation')
	.leftJoinAndSelect('client.branch', 'branch')
	.leftJoinAndSelect('client.assignedSalesRep', 'assignedSalesRep')
	.where('client.uid = :clientId', { clientId })
	.andWhere('client.isDeleted = :isDeleted', { isDeleted: false })
	.getOne();
```

---

## Part 8: Quick Reference

### Column Naming Patterns:
- `{entityName}Uid` - For entities with `uid` primary key
- `{entityName}Id` - For entities with `id` primary key
- `{entityName}Ref` - For string-based references (often Organisation)
- `ownerUid` - For owner/creator relationships
- `createdByUid` - For creator relationships
- `assignedToUid` - For assignment relationships

### Common Relationships:
- `organisation` → `organisationRef` (string)
- `branch` → `branchUid` (number)
- `owner` → `ownerUid` (number)
- `user` → `userUid` (number)
- `client` → `clientUid` (number)
- `createdBy` → `createdByUid` (number)

### Query Pattern Template:
```typescript
const entity = await this.repository
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.relation1', 'relation1')
	.leftJoinAndSelect('entity.relation2', 'relation2')
	.where('entity.uid = :id', { id })
	.andWhere('entity.isDeleted = :isDeleted', { isDeleted: false })
	.getOne();
```

---

## Part 9: Module-by-Module Checklist

Use this checklist to track progress across modules:

### Core Modules:
- [ ] `user` - ✅ COMPLETED
- [ ] `organisation`
- [ ] `branch`
- [ ] `clients`
- [ ] `leads`
- [ ] `tasks`
- [ ] `attendance`
- [ ] `claims`
- [ ] `check-ins`
- [ ] `reports`
- [ ] `journal`
- [ ] `notifications`
- [ ] `interactions`
- [ ] `shop` (quotations, orders)
- [ ] `rewards`
- [ ] `licensing`
- [ ] `tracking`
- [ ] `geofence`
- [ ] `warnings`
- [ ] `leave`
- [ ] `approvals`
- [ ] `docs`
- [ ] `assets`
- [ ] `news`
- [ ] `feedback`
- [ ] `competitors`
- [ ] `resellers`
- [ ] `products`
- [ ] `map`
- [ ] `payslips`
- [ ] `usage-tracking`

---

## Part 10: Automated Detection Script

### Find All Entities Needing Fixes:
```bash
# Find entities with ManyToOne without JoinColumn
grep -r "@ManyToOne" server/src --include="*.entity.ts" | grep -v "@JoinColumn"

# Find entities with OneToOne without JoinColumn
grep -r "@OneToOne" server/src --include="*.entity.ts" | grep -v "@JoinColumn"

# Find services using relations array
grep -r "relations:\s*\[" server/src --include="*.service.ts"
```

---

## Summary

This blueprint provides a systematic approach to:
1. **Fix Entity Relationships**: Add explicit `@JoinColumn` decorators and FK columns
2. **Fix Service Queries**: Replace `relations: []` with explicit `leftJoinAndSelect()`
3. **Maintain Consistency**: Use standardized patterns across all modules
4. **Ensure Compatibility**: PostgreSQL-compatible relationship handling

**Key Principles:**
- Always be explicit about foreign key columns
- Use QueryBuilder for all relationship loading
- Follow consistent naming conventions
- Test thoroughly after each module

**Estimated Time per Module:**
- Small module (1-2 entities, 1 service): 30-60 minutes
- Medium module (3-5 entities, 1-2 services): 1-2 hours
- Large module (5+ entities, multiple services): 2-4 hours

**Total Estimated Time:** 40-60 hours for complete codebase migration

