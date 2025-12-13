import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Organisation } from '../../organisation/entities/organisation.entity';
import { User } from '../../user/entities/user.entity';

/**
 * Geofence entity for storing geofence areas
 */
@Entity('geofences')
export class Geofence {
  @ApiProperty({ description: 'Unique identifier for the geofence area' })
  @PrimaryGeneratedColumn()
  uid: string;

  @ApiProperty({ description: 'Name of the geofence area' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiProperty({ description: 'Description of the geofence area', required: false })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @ApiProperty({ description: 'Latitude of the center point of the geofence area' })
  @Column({ type: 'float' })
  latitude: number;

  @ApiProperty({ description: 'Longitude of the center point of the geofence area' })
  @Column({ type: 'float' })
  longitude: number;

  @ApiProperty({ description: 'Radius of the geofence area in meters' })
  @Column({ type: 'float' })
  radius: number;

  @ApiProperty({ description: 'Whether the geofence area is active' })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Organisation that owns this geofence area' })
  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation: Organisation;

  @ApiProperty({ description: 'User who created the geofence' })
  @Column({ name: 'createdById', nullable: true })
  createdById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @ApiProperty({ description: 'User who last updated the geofence' })
  @Column({ name: 'updatedById', nullable: true })
  updatedById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'updatedById' })
  updatedBy: User;

  @ApiProperty({ description: 'User who deleted the geofence' })
  @Column({ name: 'deletedById', nullable: true })
  deletedById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'deletedById' })
  deletedBy: User;

  @ApiProperty({ description: 'Creation timestamp' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  @UpdateDateColumn()
  updatedAt: Date;

  @ApiProperty({ description: 'Deletion timestamp' })
  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date;
} 