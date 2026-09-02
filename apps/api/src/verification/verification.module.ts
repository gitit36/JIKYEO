import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { MockVerificationProvider } from './providers/mock-verification-provider';
import { VerificationProvider } from './providers/verification-provider';
import { VisionVerificationProvider } from './providers/vision-verification-provider.stub';

@Module({
  providers: [
    MockVerificationProvider,
    VisionVerificationProvider,
    {
      provide: VerificationProvider,
      inject: [AppConfig, MockVerificationProvider, VisionVerificationProvider],
      useFactory: (
        cfg: AppConfig,
        mock: MockVerificationProvider,
        vision: VisionVerificationProvider,
      ): VerificationProvider => {
        switch (cfg.verificationProvider) {
          case 'vision':
            return vision;
          case 'mock':
          default:
            return mock;
        }
      },
    },
  ],
  exports: [VerificationProvider],
})
export class VerificationModule {}
