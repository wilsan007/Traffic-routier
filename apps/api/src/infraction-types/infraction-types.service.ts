import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInfractionTypeDto } from './dto/create-infraction-type.dto';

@Injectable()
export class InfractionTypesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateInfractionTypeDto) {
    return this.prisma.infractionType.create({ data: dto });
  }

  findAll(activeOnly = false) {
    return this.prisma.infractionType.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ category: 'asc' }, { label: 'asc' }],
    });
  }

  async findOne(id: string) {
    const type = await this.prisma.infractionType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('Type d’infraction introuvable');
    return type;
  }

  async update(id: string, dto: Partial<CreateInfractionTypeDto>) {
    await this.findOne(id);
    return this.prisma.infractionType.update({ where: { id }, data: dto });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.infractionType.update({ where: { id }, data: { active: false } });
  }
}
