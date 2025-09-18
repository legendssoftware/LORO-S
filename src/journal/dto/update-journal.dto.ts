import { PartialType } from '@nestjs/swagger';
import { CreateJournalDto } from './create-journal.dto';

// Since we're using PartialType, all fields from CreateJournalDto are automatically optional
export class UpdateJournalDto extends PartialType(CreateJournalDto) {}
