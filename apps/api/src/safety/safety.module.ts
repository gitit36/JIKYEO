import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoalSafetyClassifier, RuleBasedGoalSafetyClassifier } from './goal-safety.classifier';
import { SafetyController } from './safety.controller';

@Module({
  imports: [AuthModule],
  controllers: [SafetyController],
  providers: [
    { provide: GoalSafetyClassifier, useClass: RuleBasedGoalSafetyClassifier },
  ],
  exports: [GoalSafetyClassifier],
})
export class SafetyModule {}
