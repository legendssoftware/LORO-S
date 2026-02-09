import { Test, TestingModule } from '@nestjs/testing';
import { CompetitorsService } from './competitors.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Competitor } from './entities/competitor.entity';
import { MockType, repositoryMockFactory } from '../../test/utils/mock-factory';
import { Repository } from 'typeorm';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';
import { AddressDto } from '../clients/dto/create-client.dto';
import { User } from '../user/entities/user.entity';

describe('CompetitorsService', () => {
  let service: CompetitorsService;
  let repositoryMock: MockType<Repository<Competitor>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitorsService,
        {
          provide: getRepositoryToken(Competitor),
          useFactory: repositoryMockFactory,
        },
      ],
    }).compile();

    service = module.get<CompetitorsService>(CompetitorsService);
    repositoryMock = module.get(getRepositoryToken(Competitor));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of competitors', async () => {
      // Arrange
      const competitors = [
        { id: 1, name: 'Competitor 1' },
        { id: 2, name: 'Competitor 2' },
      ];
      repositoryMock.find.mockReturnValue(competitors);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual(competitors);
      expect(repositoryMock.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a competitor by id', async () => {
      // Arrange
      const competitor = { id: 1, name: 'Competitor 1' };
      repositoryMock.findOne.mockReturnValue(competitor);

      // Act
      const result = await service.findOne(1);

      // Assert
      expect(result).toEqual(competitor);
      expect(repositoryMock.findOne).toHaveBeenCalledWith({
        where: { id: 1 }
      });
    });
  });

  describe('create', () => {
    it('should create a new competitor', async () => {
      // Arrange
      const addressDto: AddressDto = {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'USA',
        suburb: 'New York'
      };

      const createCompetitorDto: CreateCompetitorDto = {
        name: 'New Competitor',
        website: 'https://example.com',
        description: 'A competitor description',
        address: addressDto
      };
      
      const newCompetitor = { id: 1, ...createCompetitorDto };
      const mockUser = {} as User;
      const mockOrgId = 'org_123';
      const mockBranchId = 456;
      
      repositoryMock.create.mockReturnValue(newCompetitor);
      repositoryMock.save.mockReturnValue(newCompetitor);

      // Act
      const result = await service.create(createCompetitorDto, mockUser, mockOrgId, mockBranchId);

      // Assert
      expect(repositoryMock.create).toHaveBeenCalledWith(createCompetitorDto);
      expect(repositoryMock.save).toHaveBeenCalled();
      expect(result).toEqual(newCompetitor);
    });
  });

  describe('update', () => {
    it('should update a competitor', async () => {
      // Arrange
      const id = 1;
      const updateCompetitorDto: UpdateCompetitorDto = {
        name: 'Updated Competitor',
      };
      const existingCompetitor = { id, name: 'Old Competitor' };
      const updatedCompetitor = { ...existingCompetitor, ...updateCompetitorDto };
      const mockOrgId = 'org_123';
      const mockBranchId = 456;
      
      repositoryMock.findOne.mockReturnValue(existingCompetitor);
      repositoryMock.save.mockReturnValue(updatedCompetitor);

      // Act
      const result = await service.update(id, updateCompetitorDto, mockOrgId, mockBranchId);

      // Assert
      expect(repositoryMock.findOne).toHaveBeenCalledWith({
        where: { id }
      });
      expect(repositoryMock.save).toHaveBeenCalledWith(updatedCompetitor);
      expect(result).toEqual(updatedCompetitor);
    });
  });

  describe('remove', () => {
    it('should remove a competitor', async () => {
      // Arrange
      const id = 1;
      const competitor = { id, name: 'Competitor 1' };
      const mockOrgId = 'org_123';
      const mockBranchId = 456;
      
      repositoryMock.findOne.mockReturnValue(competitor);
      repositoryMock.delete.mockReturnValue({ affected: 1 });

      // Act
      await service.remove(id, mockOrgId, mockBranchId);

      // Assert
      expect(repositoryMock.findOne).toHaveBeenCalledWith({
        where: { id }
      });
      expect(repositoryMock.delete).toHaveBeenCalledWith(id);
    });
  });
});
