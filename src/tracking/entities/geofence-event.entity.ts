import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../user/entities/user.entity';
import { Geofence } from './geofence.entity';

/**
 * Enum for geofence event types
 */
export enum GeofenceEventType {
  ENTER = 'enter',
  EXIT = 'exit',
}

/**
 * Geofence event entity for tracking when users enter or exit geofence areas
 */
@Entity('geofence_events')
export class GeofenceEvent {
  @ApiProperty({ description: 'Unique identifier for the geofence event' })
  @PrimaryGeneratedColumn()
  uid: string;

  @ApiProperty({ description: 'Type of geofence event (enter or exit)' })
  @Column({
    type: 'enum',
    enum: GeofenceEventType,
    default: GeofenceEventType.ENTER,
  })
  eventType: GeofenceEventType;

  @ApiProperty({ description: 'User who triggered the geofence event' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ description: 'User ID who triggered the geofence event' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'Geofence area that was entered or exited' })
  @ManyToOne(() => Geofence, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'geofenceId' })
  geofence: Geofence;

  @ApiProperty({ description: 'Geofence ID that was entered or exited' })
  @Column({ type: 'uuid' })
  geofenceId: string;

  @ApiProperty({ description: 'Latitude where the event occurred' })
  @Column({ type: 'float' })
  latitude: number;

  @ApiProperty({ description: 'Longitude where the event occurred' })
  @Column({ type: 'float' })
  longitude: number;

  @ApiProperty({ description: 'Accuracy of the location in meters' })
  @Column({ type: 'float', nullable: true })
  accuracy?: number;

  @ApiProperty({ description: 'Device information as JSON' })
  @Column({ type: 'json', nullable: true })
  deviceInfo?: Record<string, any>;

  @ApiProperty({ description: 'Creation timestamp (when the event occurred)' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
} 