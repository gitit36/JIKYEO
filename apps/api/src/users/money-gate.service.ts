import { Injectable, Optional } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { DomainError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MoneyGateService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cfg?: AppConfig,
  ) {}

  async assertCanUseMoney(userId: string): Promise<void> {
    if (this.cfg && !this.cfg.moneyEnabled) {
      throw new DomainError('MONEY_DISABLED', '지금은 약속금 기능을 쓸 수 없어요.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const status = user?.ageVerificationStatus ?? 'unknown';
    if (status === 'verified_adult') return;
    if (status === 'underage') {
      throw new DomainError('AGE_UNVERIFIED', '만 19세 이상만 약속금을 걸 수 있어요.');
    }
    if (this.cfg?.allowAgeFixture) return;
    throw new DomainError('AGE_UNVERIFIED', '나이 확인이 끝나야 약속금을 걸 수 있어요.');
  }

  async setAgeFixture(userId: string, status: 'verified_adult' | 'underage', at: Date): Promise<void> {
    if (this.cfg && !this.cfg.allowAgeFixture) {
      throw new DomainError('MONEY_DISABLED', '운영 환경에서는 나이 확인을 임의로 바꿀 수 없어요.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { ageVerificationStatus: status, ageVerifiedAt: at },
    });
  }
}
