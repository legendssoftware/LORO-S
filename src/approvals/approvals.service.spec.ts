import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalsService } from './approvals.service';

describe('ApprovalsService', () => {
  let service: ApprovalsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApprovalsService],
    }).compile();

    service = module.get<ApprovalsService>(ApprovalsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
