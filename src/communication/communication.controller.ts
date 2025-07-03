import { Controller } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('📱 Communication')
@Controller('communication')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) { }
}
