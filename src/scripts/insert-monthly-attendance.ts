#!/usr/bin/env node

/**
 * Insert Monthly Attendance Records Script
 * 
 * This script inserts attendance records for user ID 1 for the current month.
 * - Check-in times: Random between 07:01 - 07:26
 * - Check-out times: Just after 16:35 (16:36 - 16:40)
 * 
 * Usage:
 *   npm run insert-attendance
 * 
 * Or run directly:
 *   ts-node -r tsconfig-paths/register src/scripts/insert-monthly-attendance.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AttendanceService } from '../attendance/attendance.service';
import { User } from '../user/entities/user.entity';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateCheckInDto } from '../attendance/dto/create.attendance.check.in.dto';
import { CreateCheckOutDto } from '../attendance/dto/create.attendance.check.out.dto';
import { AttendanceStatus } from '../lib/enums/attendance.enums';

/**
 * Generate a random time between minHour:minMinute and maxHour:maxMinute
 */
function getRandomTime(minHour: number, minMinute: number, maxHour: number, maxMinute: number): { hour: number; minute: number } {
	const minTotalMinutes = minHour * 60 + minMinute;
	const maxTotalMinutes = maxHour * 60 + maxMinute;
	const randomTotalMinutes = Math.floor(Math.random() * (maxTotalMinutes - minTotalMinutes + 1)) + minTotalMinutes;
	
	return {
		hour: Math.floor(randomTotalMinutes / 60),
		minute: randomTotalMinutes % 60,
	};
}

/**
 * Get all days in the current month
 */
function getDaysInCurrentMonth(): Date[] {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth();
	
	// Get the first and last day of the month
	const firstDay = new Date(year, month, 1);
	const lastDay = new Date(year, month + 1, 0);
	
	const days: Date[] = [];
	for (let day = firstDay.getDate(); day <= lastDay.getDate(); day++) {
		days.push(new Date(year, month, day));
	}
	
	return days;
}

/**
 * Create a date with specific time
 */
function createDateWithTime(date: Date, hour: number, minute: number): Date {
	const newDate = new Date(date);
	newDate.setHours(hour, minute, Math.floor(Math.random() * 60), 0); // Random seconds for more realism
	return newDate;
}

async function insertMonthlyAttendance() {
	console.log('🚀 Starting monthly attendance insertion script...\n');

	// Create NestJS application context
	const app = await NestFactory.createApplicationContext(AppModule);
	const attendanceService = app.get(AttendanceService);
	const userRepository = app.get<Repository<User>>(getRepositoryToken(User));

	try {
		// Get user ID 1 with organization and branch info
		console.log('📊 Step 1: Fetching user information...');
		const user = await userRepository.findOne({
			where: { uid: 1 },
			relations: ['organisation', 'branch'],
		});

		if (!user) {
			throw new Error('User with ID 1 not found');
		}

		if (!user.organisation) {
			throw new Error('User does not have an organization assigned');
		}

		const orgId = user.organisation.uid;
		const branchId = user.branch?.uid;

		console.log(`   ✅ Found user: ${user.name} ${user.surname}`);
		console.log(`   Organization ID: ${orgId}`);
		console.log(`   Branch ID: ${branchId || 'None'}\n`);

		// Get all days in current month
		console.log('📅 Step 2: Getting days in current month...');
		const days = getDaysInCurrentMonth();
		console.log(`   ✅ Found ${days.length} days in current month\n`);

		// Check for existing attendance records
		console.log('🔍 Step 3: Checking for existing attendance records...');
		const today = new Date();
		const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

		// We'll check existing records as we go to avoid duplicates
		console.log(`   Checking records from ${startOfMonth.toISOString().split('T')[0]} to ${endOfMonth.toISOString().split('T')[0]}\n`);

		let successCount = 0;
		let skipCount = 0;
		let errorCount = 0;

		// Process each day
		console.log('📝 Step 4: Processing attendance records...\n');
		console.log('═══════════════════════════════════════════════════════════════\n');

		for (let i = 0; i < days.length; i++) {
			const day = days[i];
			const dayStr = day.toISOString().split('T')[0];

			try {
				// Generate random check-in time between 07:01 - 07:26
				const checkInTime = getRandomTime(7, 1, 7, 26);
				const checkInDate = createDateWithTime(day, checkInTime.hour, checkInTime.minute);

				// Generate check-out time just after 16:35 (16:36 - 16:40)
				const checkOutTime = getRandomTime(16, 36, 16, 40);
				const checkOutDate = createDateWithTime(day, checkOutTime.hour, checkOutTime.minute);

				// Check if record already exists for this day
				// We'll try to create and handle errors if it already exists
				
				console.log(`Day ${i + 1}/${days.length} (${dayStr}):`);
				console.log(`   Check-in: ${checkInDate.toLocaleString()}`);
				console.log(`   Check-out: ${checkOutDate.toLocaleString()}`);

				// Ensure check-out is after check-in (same day)
				if (checkOutDate <= checkInDate) {
					// If check-out time is before check-in, adjust it to be after
					checkOutDate.setTime(checkInDate.getTime() + (9 * 60 * 60 * 1000)); // Add 9 hours minimum
					console.log(`   ⚠️  Adjusted check-out time to ensure it's after check-in`);
				}

				// Create check-in DTO
				const checkInDto: CreateCheckInDto = {
					owner: { uid: 1 },
					checkIn: checkInDate,
					status: AttendanceStatus.PRESENT,
					branch: branchId ? { uid: branchId } : { uid: 1 }, // Fallback to branch 1 if no branch
					checkInNotes: `Auto-generated attendance record for ${dayStr}`,
				};

				// Create check-in
				const checkInResult = await attendanceService.checkIn(checkInDto, orgId, branchId);

				if (!checkInResult.data) {
					// Check if it's because user already has an active shift
					if (checkInResult.message?.includes('already have an active shift') || 
					    checkInResult.message?.includes('ACTIVE_SHIFT_TODAY')) {
						console.log(`   ⚠️  Skipping - User already has active shift for this day\n`);
						skipCount++;
						continue;
					}
					throw new Error(checkInResult.message || 'Check-in failed');
				}

				const attendanceId = checkInResult.data.attendanceId;

				// Wait a small delay to ensure check-in is processed and saved to database
				await new Promise(resolve => setTimeout(resolve, 500));

				// Create check-out DTO
				const checkOutDto: CreateCheckOutDto = {
					owner: { uid: 1 },
					checkOut: checkOutDate,
					checkOutNotes: `Auto-generated check-out for ${dayStr}`,
				};

				// Create check-out
				const checkOutResult = await attendanceService.checkOut(checkOutDto, orgId, branchId);

				if (!checkOutResult.data) {
					// If check-out fails, log but don't fail the entire script
					if (checkOutResult.message?.includes('NO_ACTIVE_SHIFT')) {
						console.log(`   ⚠️  No active shift found for check-out (may have been auto-closed)\n`);
						skipCount++;
						continue;
					}
					throw new Error(checkOutResult.message || 'Check-out failed');
				}

				console.log(`   ✅ Successfully created attendance record (ID: ${attendanceId})\n`);
				successCount++;

				// Small delay between records to avoid overwhelming the system
				await new Promise(resolve => setTimeout(resolve, 200));

			} catch (error) {
				console.error(`   ❌ Error processing ${dayStr}: ${error.message}\n`);
				errorCount++;
				
				// Continue with next day even if this one failed
				continue;
			}
		}

		console.log('═══════════════════════════════════════════════════════════════\n');
		console.log('📊 Summary:');
		console.log(`   ✅ Successfully created: ${successCount} records`);
		console.log(`   ⚠️  Skipped: ${skipCount} records`);
		console.log(`   ❌ Errors: ${errorCount} records`);
		console.log(`   📅 Total days processed: ${days.length}\n`);

		if (successCount > 0) {
			console.log('🎉 Attendance records insertion completed successfully!\n');
		} else {
			console.log('⚠️  No records were created. Check errors above.\n');
		}

	} catch (error) {
		console.error('❌ Script failed:', error);
		throw error;
	} finally {
		await app.close();
	}
}

// Run the script
insertMonthlyAttendance()
	.then(() => {
		console.log('Script completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Script failed:', error);
		process.exit(1);
	});

