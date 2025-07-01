import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Doc } from '../docs/entities/doc.entity';
import { User } from '../user/entities/user.entity';
import { DocType } from '../lib/enums/doc.enums';
import { StorageService } from '../lib/services/storage.service';
import { GetPayslipsDto, FetchPayslipDto } from './dto/create-payslip.dto';
import { extname } from 'path';

@Injectable()
export class PayslipsService {
  constructor(
    @InjectRepository(Doc)
    private readonly docRepository: Repository<Doc>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly storageService: StorageService,
  ) {}

  async getUserPayslips(userId: number, filters?: GetPayslipsDto) {
    const queryBuilder = this.docRepository
      .createQueryBuilder('doc')
      .where('doc.owner = :userId', { userId })
      .andWhere('doc.docType = :docType', { docType: DocType.PAYSLIP })
      .andWhere('doc.isActive = :isActive', { isActive: true })
      .orderBy('doc.createdAt', 'DESC');

    // Apply date filters if provided
    if (filters?.startDate && filters?.endDate) {
      queryBuilder.andWhere('doc.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    } else if (filters?.startDate) {
      queryBuilder.andWhere('doc.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    } else if (filters?.endDate) {
      queryBuilder.andWhere('doc.createdAt <= :endDate', {
        endDate: filters.endDate,
      });
    }

    const payslips = await queryBuilder.getMany();

    return payslips.map(doc => ({
      uid: doc.uid,
      title: doc.title,
      description: doc.description,
      url: doc.url,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      extension: doc.extension,
      createdAt: doc.createdAt,
      metadata: doc.metadata,
    }));
  }

  async getPayslipById(userId: number, payslipId: number) {
    const payslip = await this.docRepository.findOne({
      where: {
        uid: payslipId,
        owner: { uid: userId },
        docType: DocType.PAYSLIP,
        isActive: true,
      },
    });

    if (!payslip) {
      return null;
    }

    return {
      uid: payslip.uid,
      title: payslip.title,
      description: payslip.description,
      url: payslip.url,
      fileSize: payslip.fileSize,
      mimeType: payslip.mimeType,
      extension: payslip.extension,
      createdAt: payslip.createdAt,
      metadata: payslip.metadata,
    };
  }

  /**
   * Fetch payslip file from Google Cloud Storage and populate database
   * If file is inaccessible (different bucket), create record with available sample data
   * @param fetchPayslipDto - Contains fileName, userId and optional sample data
   * @returns Created or updated Doc entity
   */
  async fetchAndPopulatePayslip(fetchPayslipDto: FetchPayslipDto) {
    const { 
      fileName, 
      userId, 
      title, 
      description, 
      fileSize: providedFileSize,
      mimeType: providedMimeType,
      externalUrl,
      bucketName 
    } = fetchPayslipDto;

    // Validate user exists and get relations for consistent creator links
    const user = await this.userRepository.findOne({
      where: { uid: userId },
      relations: ['organisation', 'branch'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    let fileMetadata: any = {};
    let publicUrl: string = '';
    let extension: string = extname(fileName);
    let mimeType: string = providedMimeType || 'application/octet-stream';
    let fileSize: number = providedFileSize || 0;
    let fileType: string = mimeType.split('/')[0];
    let isAccessible: boolean = false;
    let source: string = 'external_bucket';

    try {
      // Try to fetch from our default GCS bucket first
      fileMetadata = await this.storageService.getMetadata(fileName);
      publicUrl = await this.storageService.getSignedUrl(fileName);
      
      // If successful, use GCS data
      mimeType = fileMetadata.contentType || mimeType;
      fileSize = parseInt(fileMetadata.size) || fileSize;
      fileType = mimeType.split('/')[0];
      isAccessible = true;
      source = 'gcs_fetch';
      
    } catch (error) {
      // File not accessible in our bucket - use provided sample data
      console.log(`File ${fileName} not accessible in default bucket, using sample data:`, error.message);
      
      // Use external URL if provided, otherwise create a reference URL
      publicUrl = externalUrl || `gs://${bucketName || 'external-bucket'}/${fileName}`;
      
      // Detect file type from extension if not provided
      if (!providedMimeType) {
        const ext = extension.toLowerCase();
        switch (ext) {
          case '.pdf':
            mimeType = 'application/pdf';
            break;
          case '.doc':
          case '.docx':
            mimeType = 'application/msword';
            break;
          case '.xls':
          case '.xlsx':
            mimeType = 'application/vnd.ms-excel';
            break;
          case '.jpg':
          case '.jpeg':
            mimeType = 'image/jpeg';
            break;
          case '.png':
            mimeType = 'image/png';
            break;
          default:
            mimeType = 'application/octet-stream';
        }
        fileType = mimeType.split('/')[0];
      }

      // Create sample metadata with user token information
      fileMetadata = {
        name: fileName,
        bucket: bucketName || 'external-bucket',
        contentType: mimeType,
        size: fileSize.toString(),
        timeCreated: new Date().toISOString(),
        updated: new Date().toISOString(),
        etag: `sample-${Date.now()}`,
        generation: Date.now().toString(),
        metageneration: '1',
        storageClass: 'STANDARD',
        mediaLink: publicUrl,
        selfLink: `https://www.googleapis.com/storage/v1/b/${bucketName || 'external-bucket'}/o/${fileName}`,
        // Add user context from token
        userContext: {
          requestedBy: userId,
          userName: user.name || 'Unknown',
          userEmail: user.email || '',
          organisation: user.organisation?.name || '',
          branch: user.branch?.name || '',
          requestedAt: new Date().toISOString(),
        }
      };
    }

    try {
      // Check if a payslip with this filename already exists for the user
      const existingPayslip = await this.docRepository.findOne({
        where: {
          owner: { uid: userId },
          docType: DocType.PAYSLIP,
          title: title || fileName,
          isActive: true,
        },
      });

      let doc: Doc;

      if (existingPayslip) {
        // Update existing payslip with new information
        await this.docRepository.update(existingPayslip.uid, {
          content: fileType,
          fileType,
          fileSize,
          url: publicUrl,
          mimeType,
          extension,
          metadata: {
            ...existingPayslip.metadata,
            ...fileMetadata,
            fetchedAt: new Date().toISOString(),
            source,
            isAccessible,
            bucketName: bucketName || 'default',
            lastUpdateMethod: isAccessible ? 'gcs_direct' : 'sample_data',
          },
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
          description: description || existingPayslip.description,
        });

        doc = await this.docRepository.findOne({
          where: { uid: existingPayslip.uid },
        });
      } else {
        // Create new payslip record with consistent creator links
        const newDoc = this.docRepository.create({
          title: title || fileName,
          content: fileType,
          description: description || `Payslip document: ${fileName}${!isAccessible ? ' (External source)' : ''}`,
          fileType,
          docType: DocType.PAYSLIP,
          fileSize,
          url: publicUrl,
          mimeType,
          extension,
          metadata: {
            ...fileMetadata,
            fetchedAt: new Date().toISOString(),
            source,
            isAccessible,
            bucketName: bucketName || 'default',
            creationMethod: isAccessible ? 'gcs_direct' : 'sample_data',
          },
          isActive: true,
          isPublic: false,
          // Maintain consistent creator links
          owner: user,
          branch: user.branch || null,
          organisation: user.organisation || null,
          lastAccessedAt: new Date(),
        });

        doc = await this.docRepository.save(newDoc);
      }

      return {
        uid: doc.uid,
        title: doc.title,
        description: doc.description,
        url: doc.url,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        extension: doc.extension,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        metadata: doc.metadata,
        isAccessible,
        source,
        message: existingPayslip 
          ? `Payslip updated successfully${!isAccessible ? ' (using sample data)' : ''}` 
          : `Payslip created successfully${!isAccessible ? ' (using sample data)' : ''}`,
      };

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to fetch and populate payslip: ${error.message}`);
    }
  }
}
