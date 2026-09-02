import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { GoalSafetyClassifier } from './goal-safety.classifier';

class SafetyCheckDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

@ApiTags('safety')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('safety')
export class SafetyController {
  constructor(private readonly classifier: GoalSafetyClassifier) {}

  @Post('check')
  async check(@Body() dto: SafetyCheckDto): Promise<{
    decision: 'safe' | 'stake_disallowed' | 'blocked';
    reasonCode: string;
    userMessage: string;
  }> {
    const result = await this.classifier.classify(dto.title, dto.description ?? null);
    return {
      decision: result.decision,
      reasonCode: result.reasonCode,
      userMessage: result.userMessage,
    };
  }
}
