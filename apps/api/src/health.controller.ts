import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  ok(): { status: 'ok'; app: string; time: string } {
    return { status: 'ok', app: 'jikyeo-api', time: new Date().toISOString() };
  }
}
