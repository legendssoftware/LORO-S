import { DataSource, QueryRunner } from 'typeorm';

/**
 * Run a function inside a TypeORM transaction.
 * Handles connect, startTransaction, commit/rollback, and release.
 * Use for write flows that need a single transaction scope.
 */
export async function runInTransaction<T>(
	dataSource: DataSource,
	fn: (queryRunner: QueryRunner) => Promise<T>,
): Promise<T> {
	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();
	await queryRunner.startTransaction();
	try {
		const result = await fn(queryRunner);
		await queryRunner.commitTransaction();
		return result;
	} catch (error) {
		await queryRunner.rollbackTransaction();
		throw error;
	} finally {
		await queryRunner.release();
	}
}
