import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Task } from './task.entity';
import { User } from '../../user/entities/user.entity';
import { Branch } from '../../branch/entities/branch.entity';

export interface RouteStep {
  distance: {
    text: string;
    value: number;
  };
  duration: {
    text: string;
    value: number;
  };
  startLocation: {
    lat: number;
    lng: number;
  };
  endLocation: {
    lat: number;
    lng: number;
  };
  instructions: string;
}

export interface RouteLeg {
  distance: {
    text: string;
    value: number;
  };
  duration: {
    text: string;
    value: number;
  };
  startLocation: {
    lat: number;
    lng: number;
  };
  endLocation: {
    lat: number;
    lng: number;
  };
  steps: RouteStep[];
}

@Entity('routes')
export class Route {
  @PrimaryGeneratedColumn()
  uid: number;

  @Column({ type: 'json' })
  waypoints: Array<{
    taskId: number;
    clientId: number;
    location: {
      lat: number;
      lng: number;
    };
  }>;

  @Column({ type: 'json' })
  waypointOrder: number[];

  @Column({ type: 'json' })
  legs: RouteLeg[];

  @Column('float')
  totalDistance: number; // in meters

  @Column('float')
  totalDuration: number; // in seconds

  @Column({ type: 'timestamptz' })
  plannedDate: Date;

  @Column({ default: false })
  isOptimized: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ default: false })
  isDeleted: boolean;

  // Relations
  @ManyToOne(() => Task, task => task?.routes)
  task: Task;

  @ManyToOne(() => User, user => user?.routes)
  assignee: User;

  @ManyToOne(() => Branch, branch => branch?.routes)
  branch: Branch;
} 