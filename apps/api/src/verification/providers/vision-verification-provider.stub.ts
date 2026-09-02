import { Injectable } from '@nestjs/common';
import {
  GpsInput,
  PhotoInput,
  TimerInput,
  VerificationDecision,
  VerificationProvider,
} from './verification-provider';

/**
 * Placeholder for a production vision-model-backed verifier.
 * Wire once a model is chosen. GPS/Timer keep server-side math and can share
 * with MockVerificationProvider even in production.
 */
@Injectable()
export class VisionVerificationProvider extends VerificationProvider {
  readonly name = 'vision';

  async verifyPhoto(_input: PhotoInput): Promise<VerificationDecision> {
    throw new Error('VisionVerificationProvider is not implemented for MVP');
  }

  async verifyGps(_input: GpsInput): Promise<VerificationDecision> {
    throw new Error('Use MockVerificationProvider for GPS in MVP');
  }

  async verifyTimer(_input: TimerInput): Promise<VerificationDecision> {
    throw new Error('Use MockVerificationProvider for Timer in MVP');
  }
}
