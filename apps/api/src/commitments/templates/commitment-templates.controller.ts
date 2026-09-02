import { Controller, Get } from '@nestjs/common';
import { COMMITMENT_TEMPLATES, CommitmentTemplate } from './commitment-templates';

@Controller('commitment-templates')
export class CommitmentTemplatesController {
  @Get()
  list(): { items: CommitmentTemplate[] } {
    return { items: COMMITMENT_TEMPLATES };
  }
}
