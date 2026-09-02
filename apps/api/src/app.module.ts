import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CommitmentsModule } from './commitments/commitments.module';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { SafetyModule } from './safety/safety.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';

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
    CommitmentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
