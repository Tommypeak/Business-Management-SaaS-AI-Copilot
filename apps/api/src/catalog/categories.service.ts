import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CatalogCategoryResponse, PageResponse } from '@saas/types';
import { CatalogDatabase, type CatalogTransaction } from './catalog-database.service.js';
import type { CategoryDto, UpdateCategoryDto } from './catalog.dto.js';
import type { ListQueryDto } from '../common/list-query.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly db: CatalogDatabase) {}
  async list(
    organizationId: string,
    query: ListQueryDto,
  ): Promise<PageResponse<CatalogCategoryResponse>> {
    const rows = await this.db.prisma.catalogCategory.findMany({
      where: { organizationId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      select: { id: true, name: true, parentId: true, isActive: true },
    });
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  }
  private async parent(
    tx: CatalogTransaction,
    organizationId: string,
    parentId: string | null | undefined,
    id?: string,
  ) {
    const visited = new Set<string>(id ? [id] : []);
    let current = parentId;
    while (current) {
      if (visited.has(current))
        throw new BadRequestException('Category hierarchy cannot contain a cycle');
      if (visited.size >= 64) throw new BadRequestException('Category hierarchy is too deep');
      visited.add(current);
      const parent = await tx.catalogCategory.findFirst({
        where: { organizationId, id: current, isActive: true },
        select: { parentId: true },
      });
      if (!parent) throw new NotFoundException('Parent category unavailable');
      current = parent.parentId;
    }
  }
  create(organizationId: string, input: CategoryDto) {
    return this.db.write(organizationId, async (tx) => {
      await this.parent(tx, organizationId, input.parentId);
      return tx.catalogCategory.create({
        data: {
          organizationId,
          name: input.name,
          parentId: input.parentId,
          isActive: input.isActive,
        },
        select: { id: true, name: true, parentId: true, isActive: true },
      });
    });
  }
  update(organizationId: string, id: string, input: UpdateCategoryDto) {
    return this.db.write(organizationId, async (tx) => {
      const existing = await tx.catalogCategory.findFirst({ where: { id, organizationId } });
      if (!existing) throw new NotFoundException();
      if (
        (input.parentId !== undefined && input.parentId !== existing.parentId) ||
        input.isActive === true
      )
        await this.parent(
          tx,
          organizationId,
          input.parentId === undefined ? existing.parentId : input.parentId,
          id,
        );
      if (
        input.isActive === false &&
        (await tx.catalogCategory.count({
          where: { organizationId, parentId: id, isActive: true },
        }))
      )
        throw new ConflictException('Archive or move active child categories first');
      return tx.catalogCategory.update({
        where: { id, organizationId },
        data: { name: input.name, parentId: input.parentId, isActive: input.isActive },
        select: { id: true, name: true, parentId: true, isActive: true },
      });
    });
  }
}
