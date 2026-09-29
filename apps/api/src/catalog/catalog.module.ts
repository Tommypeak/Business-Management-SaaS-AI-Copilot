import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CatalogDatabase } from './catalog-database.service.js';
import { CategoriesService } from './categories.service.js';
import { VariantsService } from './variants.service.js';
import { CustomFieldsService } from './custom-fields.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [CatalogController],
  providers: [
    CatalogDatabase,
    CatalogService,
    CategoriesService,
    VariantsService,
    CustomFieldsService,
  ],
})
export class CatalogModule {}
