#!/usr/bin/env node

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BulkEmailService } from '../bulk-email/bulk-email.service';
import { BulkEmailInput } from '../lib/types/bulk-email.types';
import * as yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as path from 'path';
import * as fs from 'fs';

interface ScriptArguments {
	file: string;
	subject?: string;
	dryRun?: boolean;
	batchSize?: number;
	delay?: number;
	organizations?: string[];
	roles?: string[];
	excludeEmails?: string[];
	verbose?: boolean;
}

async function main() {
	const startTime = Date.now();
	console.log('🚀 Starting bulk email script...\n');

	// Parse command line arguments
	const argv = yargs(hideBin(process.argv))
		.options({
			file: {
				alias: 'f',
				type: 'string',
				demandOption: true,
				describe: 'Path to the email content file (JSON or TXT)',
			},
			subject: {
				alias: 's',
				type: 'string',
				describe: 'Override email subject (for TXT files)',
			},
			'dry-run': {
				alias: 'd',
				type: 'boolean',
				default: false,
				describe: 'Preview recipients without sending emails',
			},
			'batch-size': {
				alias: 'b',
				type: 'number',
				default: 10,
				describe: 'Number of emails to send per batch',
			},
			delay: {
				type: 'number',
				default: 1000,
				describe: 'Delay between batches in milliseconds',
			},
			organizations: {
				alias: 'o',
				type: 'array',
				describe: 'Filter by organization IDs (space separated)',
			},
			roles: {
				alias: 'r',
				type: 'array',
				describe: 'Filter by user roles (space separated)',
			},
			'exclude-emails': {
				alias: 'e',
				type: 'array',
				describe: 'Email addresses to exclude (space separated)',
			},
			verbose: {
				alias: 'v',
				type: 'boolean',
				default: false,
				describe: 'Enable verbose logging',
			},
		})
		.example('$0 -f announcement.json --dry-run', 'Preview email sending with JSON content')
		.example('$0 -f message.txt -s "Important Update" -b 5', 'Send emails from TXT file with custom subject')
		.example('$0 -f content.json -o org1 org2 -r admin manager', 'Send to specific organizations and roles')
		.help()
		.parseSync() as ScriptArguments;

	try {
		// Validate file exists
		const filePath = path.resolve(argv.file);
		if (!fs.existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}

		console.log(`📁 Loading email content from: ${filePath}`);
		
		// Initialize NestJS application
		console.log('⚡ Initializing application...');
		const app = await NestFactory.createApplicationContext(AppModule, {
			logger: argv.verbose ? ['log', 'debug', 'error', 'verbose', 'warn'] : ['log', 'error', 'warn'],
		});

		// Get the bulk email service
		const bulkEmailService = app.get(BulkEmailService);

		// Load email content
		let emailContent;
		try {
			emailContent = await bulkEmailService.loadEmailContentFromFile(filePath);
		} catch (error) {
			throw new Error(`Failed to load email content: ${error.message}`);
		}

		// Override subject if provided
		if (argv.subject) {
			emailContent.subject = argv.subject;
		}

		// Prepare bulk email input
		const bulkEmailInput: BulkEmailInput = {
			content: emailContent,
			recipientFilter: {
				organizations: argv.organizations as string[],
				roles: argv.roles as string[],
				excludeEmails: argv.excludeEmails as string[],
			},
			sendOptions: {
				dryRun: argv.dryRun,
				batchSize: argv.batchSize,
				delayBetweenBatches: argv.delay,
			},
		};

		// Display email preview
		console.log('\n📧 Email Preview:');
		console.log('═'.repeat(60));
		console.log(`Subject: ${emailContent.subject}`);
		if (emailContent.title) {
			console.log(`Title: ${emailContent.title}`);
		}
		console.log(`Body Preview: ${emailContent.body.substring(0, 200)}${emailContent.body.length > 200 ? '...' : ''}`);
		
		if (emailContent.images && emailContent.images.length > 0) {
			console.log(`Images: ${emailContent.images.length} image(s)`);
		}
		
		if (emailContent.links && emailContent.links.length > 0) {
			console.log(`Links: ${emailContent.links.length} link(s)`);
		}
		
		if (emailContent.cta) {
			console.log(`Call to Action: "${emailContent.cta.text}" → ${emailContent.cta.url}`);
		}
		console.log('═'.repeat(60));

		// Display sending options
		console.log('\n⚙️  Sending Options:');
		console.log(`Mode: ${argv.dryRun ? 'DRY RUN (preview only)' : 'LIVE SENDING'}`);
		console.log(`Batch Size: ${argv.batchSize}`);
		console.log(`Delay Between Batches: ${argv.delay}ms`);

		if (bulkEmailInput.recipientFilter?.organizations) {
			console.log(`Organization Filter: ${bulkEmailInput.recipientFilter.organizations.join(', ')}`);
		}
		
		if (bulkEmailInput.recipientFilter?.roles) {
			console.log(`Role Filter: ${bulkEmailInput.recipientFilter.roles.join(', ')}`);
		}
		
		if (bulkEmailInput.recipientFilter?.excludeEmails) {
			console.log(`Excluded Emails: ${bulkEmailInput.recipientFilter.excludeEmails.join(', ')}`);
		}

		// Confirm if not dry run
		if (!argv.dryRun) {
			console.log('\n⚠️  WARNING: This will send real emails to all matching users!');
			console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
			
			// Wait 5 seconds to allow cancellation
			await new Promise(resolve => setTimeout(resolve, 5000));
		}

		// Send the emails
		console.log(argv.dryRun ? '\n🔍 Starting dry run analysis...\n' : '\n📤 Starting email sending process...\n');
		
		const result = await bulkEmailService.sendBulkEmail(bulkEmailInput);

		// Display results
		console.log('\n📊 Results Summary:');
		console.log('═'.repeat(60));
		console.log(`Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
		console.log(`Total Recipients: ${result.totalRecipients}`);
		console.log(`Successful Sends: ${result.successfulSends}`);
		console.log(`Failed Sends: ${result.failedSends}`);
		console.log(`Execution Time: ${result.executionTime}ms (${(result.executionTime / 1000).toFixed(2)}s)`);

		if (result.dryRun) {
			console.log(`Mode: DRY RUN - No emails were actually sent`);
		}

		if (result.failedEmails.length > 0) {
			console.log(`\n❌ Failed Email Addresses:`);
			result.failedEmails.forEach(email => console.log(`   - ${email}`));
		}

		if (result.messageIds.length > 0 && argv.verbose) {
			console.log(`\n📨 Message IDs:`);
			result.messageIds.slice(0, 5).forEach(id => console.log(`   - ${id}`));
			if (result.messageIds.length > 5) {
				console.log(`   ... and ${result.messageIds.length - 5} more`);
			}
		}

		const successRate = result.totalRecipients > 0 ? 
			(result.successfulSends / result.totalRecipients * 100).toFixed(2) : 
			'0.00';
		console.log(`\n🎯 Success Rate: ${successRate}%`);
		console.log('═'.repeat(60));

		// Final message
		const totalTime = Date.now() - startTime;
		if (result.success) {
			console.log(`\n🎉 Bulk email operation completed successfully in ${(totalTime / 1000).toFixed(2)}s!`);
			if (!argv.dryRun) {
				console.log(`✅ ${result.successfulSends} emails sent successfully`);
			}
		} else {
			console.log(`\n💥 Bulk email operation failed after ${(totalTime / 1000).toFixed(2)}s`);
		}

		// Close the application
		await app.close();

		// Exit with appropriate code
		process.exit(result.success ? 0 : 1);

	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`\n💥 Script failed after ${(totalTime / 1000).toFixed(2)}s:`);
		console.error(error.message);
		
		if (argv.verbose) {
			console.error('\n🔍 Stack trace:');
			console.error(error.stack);
		}

		process.exit(1);
	}
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
	console.error('\n💥 Uncaught Exception:', error.message);
	process.exit(1);
});

process.on('unhandledRejection', (error) => {
	console.error('\n💥 Unhandled Rejection:', error);
	process.exit(1);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
	console.log('\n\n⚠️  Operation cancelled by user');
	process.exit(0);
});

// Run the script
if (require.main === module) {
	main();
}
