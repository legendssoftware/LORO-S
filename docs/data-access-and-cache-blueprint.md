# Data Access and Cache Blueprint

Short reference for **query runner** usage and **cache key / invalidation** so services stay consistent, fast, and correct. Apply this to attendance, leads, tasks, and other modules.

---

## Query runner

- **When**: Use one `QueryRunner` per logical unit of work that must be **atomic** (multiple entities or steps that must succeed or fail together).
- **Pattern**:
  ```ts
  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    // All DB access via qr.manager (not this.*Repository)
    await qr.commitTransaction();
  } catch {
    await qr.rollbackTransaction();
    throw;
  } finally {
    await qr.release();
  }
  ```
- **Rules**:
  - Use `qr.manager` (not `this.*Repository`) for every query inside that transaction.
  - Keep transactions short; do **not** do heavy external calls (HTTP, email, push) inside the transaction — do them after `commitTransaction()`.
  - When a method delegates to another that already uses its own runner (e.g. consolidate → checkIn), do **not** wrap the caller in another transaction; avoid double-release.

---

## Cache keys and invalidation

- **Key shape**: Define the key in **one place** (e.g. `getListCacheKey(orgId, branchId)`) and use it for both **get** and **invalidate**.
- **Invalidation**: On any write that affects a list or aggregate, call invalidation with the **same** parameters the read endpoint uses (e.g. `orgId` and `effectiveBranchId` for a list).
- **Scoping**: Prefer **parameterised** keys (e.g. `list_${orgId}_${branchId}`) over a single global key so invalidation is scoped and correct.

---

## Consistency

- Document in the module (or here): *Writes that touch multiple entities or must be atomic use QueryRunner; cache keys are built by a single helper and cleared on write with the same params.*

---

## Swagger (API docs)

- **Style**: Match the **attendance check-in route** (`POST /att/in`) in [attendance.controller.ts](server/src/attendance/attendance.controller.ts): short summary, one or two sentence description, no long markdown blocks.
- **Summary**: Short title, no emoji (e.g. `Employee check-in`, `Get all attendance records`).
- **Description**: One or two sentences: what the endpoint does, where org/branch/user come from (auth, query, body), and any key constraint (e.g. "Requires an active shift").
- **Response types**: Use DTOs or small inline schemas with `message` and `data` where applicable; keep examples minimal.
- **Trim**: Avoid long `# Heading` / bullet lists in `description`; move detailed behaviour to a separate doc or keep it out of Swagger.
