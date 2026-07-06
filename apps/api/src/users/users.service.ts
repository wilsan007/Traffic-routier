import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthService } from '../auth/auth.service';

const SAFE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  badgeNumber: true,
  role: true,
  active: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const passwordHash = await AuthService.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        badgeNumber: dto.badgeNumber,
        role: dto.role,
      },
      select: SAFE_SELECT,
    });
  }

  findAll() {
    return this.prisma.user.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('Agent introuvable');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data: dto, select: SAFE_SELECT });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data: { active: false }, select: SAFE_SELECT });
  }
}
