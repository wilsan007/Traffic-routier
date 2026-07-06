import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOwnerDto } from './dto/create-owner.dto';
import { UpdateOwnerDto } from './dto/update-owner.dto';

@Injectable()
export class OwnersService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateOwnerDto) {
    return this.prisma.owner.create({ data: dto });
  }

  findAll(search?: string) {
    if (!search) {
      return this.prisma.owner.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    }
    return this.prisma.owner.findMany({
      where: {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { nationalId: { contains: search, mode: 'insensitive' } },
          { licenseNumber: { contains: search, mode: 'insensitive' } },
        ],
      },
      take: 50,
    });
  }

  async findOne(id: string) {
    const owner = await this.prisma.owner.findUnique({
      where: { id },
      include: {
        ownerships: { include: { vehicle: true }, orderBy: { startDate: 'desc' } },
        infractions: { orderBy: { occurredAt: 'desc' } },
        cases: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!owner) throw new NotFoundException('Propriétaire introuvable');
    return owner;
  }

  async update(id: string, dto: UpdateOwnerDto) {
    await this.findOne(id);
    return this.prisma.owner.update({ where: { id }, data: dto });
  }
}
