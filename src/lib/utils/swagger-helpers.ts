import { format, addDays, addMonths, addWeeks, addYears } from 'date-fns';

/**
 * Swagger Helper Utilities
 * Provides dynamic date generation and code example helpers for Swagger documentation
 */

/**
 * Gets a dynamic date string for the current year
 * @param month - Month (1-12), defaults to current month
 * @param day - Day of month (1-31), defaults to current day
 * @returns ISO date string (YYYY-MM-DD)
 */
export function getDynamicDate(month?: number, day?: number): string {
	const now = new Date();
	const currentYear = now.getFullYear();
	const targetMonth = month ?? now.getMonth() + 1;
	const targetDay = day ?? now.getDate();
	
	return format(new Date(currentYear, targetMonth - 1, targetDay), 'yyyy-MM-dd');
}

/**
 * Gets a dynamic datetime string for the current year
 * @param month - Month (1-12), defaults to current month
 * @param day - Day of month (1-31), defaults to current day
 * @param hour - Hour (0-23), defaults to 10
 * @param minute - Minute (0-59), defaults to 0
 * @returns ISO datetime string (YYYY-MM-DDTHH:mm:ssZ)
 */
export function getDynamicDateTime(month?: number, day?: number, hour: number = 10, minute: number = 0): string {
	const now = new Date();
	const currentYear = now.getFullYear();
	const targetMonth = month ?? now.getMonth() + 1;
	const targetDay = day ?? now.getDate();
	
	const date = new Date(currentYear, targetMonth - 1, targetDay, hour, minute);
	return date.toISOString();
}

/**
 * Gets a future date relative to today
 * @param days - Number of days to add, defaults to 7
 * @returns ISO date string
 */
export function getFutureDate(days: number = 7): string {
	return format(addDays(new Date(), days), 'yyyy-MM-dd');
}

/**
 * Gets a future datetime relative to today
 * @param days - Number of days to add, defaults to 7
 * @param hour - Hour (0-23), defaults to 10
 * @param minute - Minute (0-59), defaults to 0
 * @returns ISO datetime string
 */
export function getFutureDateTime(days: number = 7, hour: number = 10, minute: number = 0): string {
	const futureDate = addDays(new Date(), days);
	futureDate.setHours(hour, minute, 0, 0);
	return futureDate.toISOString();
}

/**
 * Gets a past date relative to today
 * @param days - Number of days to subtract, defaults to 30
 * @returns ISO date string
 */
export function getPastDate(days: number = 30): string {
	return format(addDays(new Date(), -days), 'yyyy-MM-dd');
}

/**
 * Gets a past datetime relative to today
 * @param days - Number of days to subtract, defaults to 30
 * @param hour - Hour (0-23), defaults to 9
 * @param minute - Minute (0-59), defaults to 0
 * @returns ISO datetime string
 */
export function getPastDateTime(days: number = 30, hour: number = 9, minute: number = 0): string {
	const pastDate = addDays(new Date(), -days);
	pastDate.setHours(hour, minute, 0, 0);
	return pastDate.toISOString();
}

/**
 * Generates code examples for different languages
 */
export interface CodeExample {
	summary: string;
	description?: string;
	value: any;
}

/**
 * Creates a standard set of code examples for Swagger documentation
 * @param baseExample - Base example object with dynamic dates
 * @param serviceMethod - Name of the service method being called
 * @param serviceDescription - Description of what the service method does
 * @returns Object with examples for different languages
 */
export function generateCodeExamples(
	baseExample: any,
	serviceMethod?: string,
	serviceDescription?: string,
): Record<string, CodeExample> {
	const examples: Record<string, CodeExample> = {
		nodejs: {
			summary: 'Node.js Example',
			description: serviceMethod
				? `Node.js example using axios. Calls \`${serviceMethod}()\` ${serviceDescription || 'to process the request'}.`
				: 'Node.js example using axios',
			value: baseExample,
		},
		csharp: {
			summary: 'C# (.NET) Example',
			description: serviceMethod
				? `C# example using HttpClient. Calls \`${serviceMethod}()\` ${serviceDescription || 'to process the request'}.`
				: 'C# example using HttpClient',
			value: baseExample,
		},
		cpp: {
			summary: 'C++ Example',
			description: serviceMethod
				? `C++ example using libcurl. Calls \`${serviceMethod}()\` ${serviceDescription || 'to process the request'}.`
				: 'C++ example using libcurl',
			value: baseExample,
		},
		c: {
			summary: 'C Example',
			description: serviceMethod
				? `C example using libcurl. Calls \`${serviceMethod}()\` ${serviceDescription || 'to process the request'}.`
				: 'C example using libcurl',
			value: baseExample,
		},
		postman: {
			summary: 'Postman Example',
			description: serviceMethod
				? `Postman collection example. Calls \`${serviceMethod}()\` ${serviceDescription || 'to process the request'}.`
				: 'Postman collection example',
			value: baseExample,
		},
	};

	return examples;
}

/**
 * Documents a service method for Swagger descriptions
 * @param serviceName - Name of the service class
 * @param methodName - Name of the method
 * @param description - What the method does
 * @param returns - What the method returns
 * @param handles - What the method handles (optional)
 * @returns Formatted service method documentation string
 */
export function getServiceMethodDoc(
	serviceName: string,
	methodName: string,
	description: string,
	returns: string,
	handles?: string[],
): string {
	let doc = `\n## Service Method\nCalls \`${serviceName}.${methodName}()\` which:\n`;
	doc += `- ${description}\n`;
	doc += `- Returns: ${returns}\n`;
	
	if (handles && handles.length > 0) {
		doc += `- Handles:\n`;
		handles.forEach((item) => {
			doc += `  - ${item}\n`;
		});
	}
	
	return doc;
}

/**
 * Creates a comprehensive API operation description
 * @param summary - Short summary
 * @param description - Detailed description
 * @param serviceName - Service class name
 * @param methodName - Service method name
 * @param serviceDescription - What the service method does
 * @param returns - What the service method returns
 * @param handles - What the service method handles
 * @returns Formatted description string
 */
export function createApiDescription(
	summary: string,
	description: string,
	serviceName?: string,
	methodName?: string,
	serviceDescription?: string,
	returns?: string,
	handles?: string[],
): string {
	let fullDescription = `## Description\n${description}\n`;
	
	if (serviceName && methodName) {
		fullDescription += getServiceMethodDoc(
			serviceName,
			methodName,
			serviceDescription || 'processes the request',
			returns || 'the processed result',
			handles,
		);
	}
	
	return fullDescription;
}
