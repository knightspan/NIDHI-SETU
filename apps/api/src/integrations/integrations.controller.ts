import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.js';
import { NotFoundError } from '../domain/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AICTE_APPROVAL_ADAPTER,
  compareMaster,
  type AicteApprovalAdapter,
} from './aicte.adapter.js';

const AicteId = z.string().trim().min(3).max(40);

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AICTE_APPROVAL_ADAPTER) private readonly aicte: AicteApprovalAdapter,
  ) {}

  /**
   * Looks an institution up on the AICTE approval portal and compares it with the local master,
   * so stale programmes (which drive the required deposit amount) are caught.
   */
  @RequirePermission('master:manage')
  @Get('aicte/:aicteId')
  async aicteLookup(@Param('aicteId', new ZodPipe(AicteId)) aicteId: z.infer<typeof AicteId>) {
    const portal = await this.aicte.fetchInstitution(aicteId);
    if (!portal) throw new NotFoundError('AICTE record');
    const local = await this.prisma.institution.findUnique({
      where: { aicteId },
      include: { region: true },
    });
    return {
      portal,
      local: local ? { id: local.id, name: local.name } : null,
      differences: local
        ? compareMaster(portal, {
            aicteId: local.aicteId,
            name: local.name,
            trustName: local.trustName,
            state: local.state,
            regionCode: local.region.code,
            yearEstablished: local.yearEstablished,
            programmes: local.programmes,
          })
        : [],
    };
  }
}
