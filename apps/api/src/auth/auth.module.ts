import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MockAppleVerifier } from './auth-providers/mock-apple-verifier';
import { MockGoogleVerifier } from './auth-providers/mock-google-verifier';
import { AppJwtService } from './jwt.service';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, AppJwtService, AuthGuard, MockAppleVerifier, MockGoogleVerifier],
  exports: [AuthService, AppJwtService, AuthGuard],
})
export class AuthModule {}
