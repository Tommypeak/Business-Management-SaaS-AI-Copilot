import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import type { HealthResponse } from '@saas/types';
import { HealthService } from './health.service.js';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  live(): HealthResponse {
    return this.health.live();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  ready(): Promise<HealthResponse> {
    return this.health.ready();
  }
}
