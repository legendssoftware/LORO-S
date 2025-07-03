import { DocsService } from './docs.service';
import { CreateDocDto } from './dto/create-doc.dto';
import { UpdateDocDto } from './dto/update-doc.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	UseInterceptors,
	UploadedFile,
	NotFoundException,
	BadRequestException,
	UseGuards,
	ParseFilePipe,
	MaxFileSizeValidator,
	FileTypeValidator,
	Query,
	Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { isPublic } from '../decorators/public.decorator';
import { Roles } from '../decorators/role.decorator';
import { AccessLevel } from '../lib/enums/user.enums';
import { RoleGuard } from '../guards/role.guard';
import { AuthGuard } from '../guards/auth.guard';
import { EnterpriseOnly } from '../decorators/enterprise-only.decorator';

@ApiTags('💾 Documents & Files')
@Controller('docs')
@UseGuards(AuthGuard, RoleGuard)
@EnterpriseOnly('claims')
export class DocsController {
	constructor(private readonly docsService: DocsService) {}

	@Post()
	@UseGuards(AuthGuard, RoleGuard)
	@isPublic()
	@ApiOperation({ summary: 'create a new document' })
	create(@Body() createDocDto: CreateDocDto) {
		return this.docsService.create(createDocDto);
	}

	@Post('upload')
	@UseInterceptors(FileInterceptor('file'))
	async uploadFile(
		@UploadedFile(
			new ParseFilePipe({
				validators: [
					new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
					new FileTypeValidator({ fileType: /(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|txt)$/i }),
				],
				errorHttpStatusCode: 400,
			}),
		)
		file: Express.Multer.File,
		@Query('type') type?: string,
		@Request() req?: any,
	) {
		try {
			const ownerId = req.user?.uid;
			const branchId = req.user?.branch?.uid;

			const result = await this.docsService.uploadFile(file, type, ownerId, branchId);
			return result;
		} catch (error) {
			throw new BadRequestException({
				message: error.message,
				error: 'File Upload Failed',
				statusCode: 400,
			});
		}
	}

	@Post('/remove/:ref')
	@isPublic()
	@ApiOperation({ summary: 'soft delete an file from a storage bucket in google cloud storage' })
	async deleteFromBucket(@Param('ref') ref: number) {
		return this.docsService.deleteFromBucket(ref);
	}

	async getExtension(filename: string) {
		const parts = filename?.split('.');
		return parts?.length === 1 ? '' : parts[parts?.length - 1];
	}

	@Get()
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'get all documents' })
	findAll() {
		return this.docsService.findAll();
	}

	@Get('user/:ref')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'get documents by user reference code' })
	findByUser(@Param('ref') ref: number) {
		return this.docsService.docsByUser(ref);
	}

	@Get(':ref')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'get a document by reference code' })
	findOne(@Param('ref') ref: number) {
		return this.docsService.findOne(ref);
	}

	@Patch(':ref')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'update a document by reference code' })
	update(@Param('ref') ref: number, @Body() updateDocDto: UpdateDocDto) {
		return this.docsService.update(ref, updateDocDto);
	}

	@Get('download/:ref')
	@UseGuards(AuthGuard, RoleGuard)
	@Roles(
		AccessLevel.ADMIN,
		AccessLevel.MANAGER,
		AccessLevel.SUPPORT,
		AccessLevel.DEVELOPER,
		AccessLevel.USER,
		AccessLevel.OWNER,
		AccessLevel.TECHNICIAN,
	)
	@ApiOperation({ summary: 'get download URL for a document' })
	async getDownloadUrl(@Param('ref') ref: number) {
		return this.docsService.getDownloadUrl(ref);
	}
}
