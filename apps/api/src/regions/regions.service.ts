import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRegionDto } from './dto/create-region.dto';

@Injectable()
export class RegionsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateRegionDto) {
    return this.prisma.region.create({ data: dto });
  }

  findAll() {
    return this.prisma.region.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw new NotFoundException('Région introuvable');
    return region;
  }

  // Valide un numéro de plaque contre le format configuré pour la région
  async validatePlate(regionId: string, plate: string): Promise<boolean> {
    const region = await this.findOne(regionId);
    return new RegExp(region.plateFormatRegex).test(plate);
  }
}
