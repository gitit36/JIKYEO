import { Module } from '@nestjs/common';
import { GoalSafetyClassifier, RuleBasedGoalSafetyClassifier } from './goal-safety.classifier';

@Module({
  providers: [
    { provide: GoalSafetyClassifier, useClass: RuleBasedGoalSafetyClassifier },
  ],
  exports: [GoalSafetyClassifier],
})
export class SafetyModule {}
