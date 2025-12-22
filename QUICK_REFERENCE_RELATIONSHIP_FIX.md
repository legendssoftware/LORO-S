# Quick Reference: PostgreSQL Relationship Fix

## 🎯 Quick Fix Patterns

### Entity: Fix ManyToOne
```typescript
// ❌ BEFORE
@ManyToOne(() => Branch)
branch: Branch;

// ✅ AFTER
@ManyToOne(() => Branch, (branch) => branch?.entities, { nullable: true })
@JoinColumn({ name: 'branchUid' })
branch: Branch;

@Column({ type: 'int', nullable: true })
branchUid: number;
```

### Entity: Fix OneToOne
```typescript
// ❌ BEFORE
@OneToOne(() => User, (user) => user.profile)
owner: User;

// ✅ AFTER
@OneToOne(() => User, (user) => user.profile)
@JoinColumn({ name: 'ownerUid' })
owner: User;
```

### Service: Fix findOne Query
```typescript
// ❌ BEFORE
const entity = await this.repo.findOne({
	where: { uid: id },
	relations: ['branch', 'organisation'],
});

// ✅ AFTER
const entity = await this.repo
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.branch', 'branch')
	.leftJoinAndSelect('entity.organisation', 'organisation')
	.where('entity.uid = :id', { id })
	.getOne();
```

### Service: Fix find Query
```typescript
// ❌ BEFORE
const entities = await this.repo.find({
	where: { isDeleted: false },
	relations: ['branch'],
});

// ✅ AFTER
const entities = await this.repo
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.branch', 'branch')
	.where('entity.isDeleted = :isDeleted', { isDeleted: false })
	.getMany();
```

### Service: Fix with Access Control
```typescript
// ❌ BEFORE
const entity = await this.repo.findOne({
	where: {
		uid: id,
		...(orgId && { organisation: { uid: orgId } }),
	},
	relations: ['organisation'],
});

// ✅ AFTER
const qb = this.repo
	.createQueryBuilder('entity')
	.leftJoinAndSelect('entity.organisation', 'organisation')
	.where('entity.uid = :id', { id });

if (orgId) {
	qb.andWhere('organisation.uid = :orgId', { orgId });
}

const entity = await qb.getOne();
```

## 📋 Column Naming Rules

| Relationship Type | Column Name Pattern | Example |
|------------------|---------------------|---------|
| Organisation | `organisationRef` (string) | `organisationRef: string` |
| Branch | `{entity}Uid` (number) | `branchUid: number` |
| User/Owner | `ownerUid` or `{role}Uid` | `ownerUid: number`, `createdByUid: number` |
| Client | `clientUid` (number) | `clientUid: number` |
| Other Entities | `{entityName}Uid` (number) | `leadUid: number` |

## 🔍 Find & Replace Commands

### Find entities needing fixes:
```bash
# Find ManyToOne without JoinColumn
grep -r "@ManyToOne" server/src --include="*.entity.ts" | grep -v "@JoinColumn"

# Find OneToOne without JoinColumn  
grep -r "@OneToOne" server/src --include="*.entity.ts" | grep -v "@JoinColumn"

# Find services using relations array
grep -r "relations:\s*\[" server/src --include="*.service.ts"
```

## ✅ Checklist Per File

### Entity File:
- [ ] All `@ManyToOne` have `@JoinColumn({ name: '...' })`
- [ ] All `@ManyToOne` have FK column (`@Column`)
- [ ] All `@OneToOne` have `@JoinColumn({ name: '...' })` on owning side
- [ ] `JoinColumn` imported from 'typeorm'

### Service File:
- [ ] No `relations: []` arrays found
- [ ] All `findOne()` use QueryBuilder
- [ ] All `find()` use QueryBuilder
- [ ] Access control filters preserved
- [ ] Transaction queries converted

## 🚀 Common Patterns

### Pattern: Organisation + Branch
```typescript
// Entity
@ManyToOne(() => Organisation, { nullable: true })
@JoinColumn({ name: 'organisationRef' })
organisation: Organisation;
@Column({ nullable: true })
organisationRef: string;

@ManyToOne(() => Branch, { nullable: true })
@JoinColumn({ name: 'branchUid' })
branch: Branch;
@Column({ type: 'int', nullable: true })
branchUid: number;

// Service
.leftJoinAndSelect('entity.organisation', 'organisation')
.leftJoinAndSelect('entity.branch', 'branch')
```

### Pattern: Owner/Creator
```typescript
// Entity
@ManyToOne(() => User, { nullable: true })
@JoinColumn({ name: 'ownerUid' })
owner: User;
@Column({ type: 'int', nullable: true })
ownerUid: number;

// Service
.leftJoinAndSelect('entity.owner', 'owner')
```

## ⚠️ Common Mistakes

1. **Missing FK Column**: Added `@JoinColumn` but forgot `@Column`
2. **Wrong Column Name**: Check database schema for actual column names
3. **Broken Access Control**: Use conditional `andWhere()` not spread operator
4. **Nested Relations**: Use multiple `leftJoinAndSelect()` calls

## 📚 Full Documentation

See `POSTGRESQL_RELATIONSHIP_FIX_BLUEPRINT.md` for complete guide.

