import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';

@Injectable()
export class CasesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  create(dto: CreateCaseDto, createdById: string) {
    return this.prisma.case.create({ data: { ...dto, createdById } });
  }

  findAll(status?: string) {
    return this.prisma.case.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
        vehicle: true,
        owner: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.case.findUnique({
      where: { id },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
        vehicle: true,
        owner: true,
        notes: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } },
        attachments: true,
      },
    });
    if (!item) throw new NotFoundException('Dossier introuvable');
    return item;
  }

  async update(id: string, dto: UpdateCaseDto) {
    await this.findOne(id);
    return this.prisma.case.update({ where: { id }, data: dto });
  }

  async addNote(caseId: string, content: string, authorId: string) {
    await this.findOne(caseId);
    return this.prisma.caseNote.create({ data: { caseId, content, authorId } });
  }

  async addAttachment(caseId: string, fileBuffer: Buffer, mimeType: string, uploadedById: string) {
    await this.findOne(caseId);
    const url = await this.storage.uploadCaptureImage(fileBuffer, mimeType);
    return this.prisma.caseAttachment.create({
      data: { caseId, url, type: mimeType, uploadedById },
    });
  }
}
