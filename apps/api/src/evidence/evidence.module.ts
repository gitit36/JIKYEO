import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';
import { VerificationModule } from '../verification/verification.module';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { FocusTimerService } from './focus-timer.service';
import { EvidenceStorage } from './storage/evidence-storage';
import { MockEvidenceStorage } from './storage/mock-evidence-storage';

@Module({
  imports: [AuthModule, VerificationModule],
  controllers: [EvidenceController],
  providers: [
    EvidenceService,
    FocusTimerService,
    MockEvidenceStorage,
    { provide: EvidenceStorage, useExisting: MockEvidenceStorage },
    VerificationOrchestrator,
  ],
  exports: [EvidenceService, FocusTimerService, VerificationOrchestrator],
})
export class EvidenceModule {}
