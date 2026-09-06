import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CommitmentsModule } from './commitments/commitments.module';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { OccurrencesModule } from './occurrences/occurrences.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { SafetyModule } from './safety/safety.module';
import { StakePolicyModule } from './stake-policy/stake-policy.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';
import { EvidenceModule } from './evidence/evidence.module';
import { DeadlineModule } from './deadline/deadline.module';
import { SettlementModule } from './settlement/settlement.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { AppealsModule } from './appeals/appeals.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RecapsModule } from './recaps/recaps.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CommonModule,
    AuditModule,
    UsersModule,
    AuthModule,
    SafetyModule,
    PaymentsModule,
    VerificationModule,
    StakePolicyModule,
    CommitmentsModule,
    OccurrencesModule,
    EvidenceModule,
    DeadlineModule,
    SettlementModule,
    JobsModule,
    AppealsModule,
    NotificationsModule,
    RecapsModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
