import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
  } from 'typeorm';
  
  @Entity('users')
  export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;
  
    @Column({
      unique: true,
      length: 255,
    })
    email: string;
  
    @Column()
    passwordHash: string;
  
    @Column({
      length: 100,
      nullable: true,
    })
    firstName?: string;
  
    @Column({
      length: 100,
      nullable: true,
    })
    lastName?: string;
  
    @Column({
      default: true,
    })
    isActive: boolean;
  
    @Column({
      default: false,
    })
    isVerified: boolean;
  
    @Column({
      type: 'timestamp',
      nullable: true,
    })
    lastLoginAt?: Date;
  
    @CreateDateColumn()
    createdAt: Date;
  
    @UpdateDateColumn()
    updatedAt: Date;
  }