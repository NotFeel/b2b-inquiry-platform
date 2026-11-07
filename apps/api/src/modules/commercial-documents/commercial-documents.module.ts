import { Module } from '@nestjs/common';
import { CommercialDocumentsController } from './commercial-documents.controller';
import { CommercialDocumentsService } from './commercial-documents.service';
import { CompanyProfilesController } from './company-profiles.controller';
import { CompanyProfilesService } from './company-profiles.service';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';

@Module({
  controllers: [
    CommercialDocumentsController,
    DocumentTemplatesController,
    CompanyProfilesController,
  ],
  providers: [CommercialDocumentsService, DocumentTemplatesService, CompanyProfilesService],
  exports: [CommercialDocumentsService, DocumentTemplatesService, CompanyProfilesService],
})
export class CommercialDocumentsModule {}
