import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { AuthService, SessionTokens } from './auth.service';

class AppleSignInDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

class GoogleSignInDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

class EmailDevSignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('apple')
  @HttpCode(200)
  apple(@Body() dto: AppleSignInDto): Promise<SessionTokens> {
    return this.auth.signInApple(dto.idToken);
  }

  @Post('google')
  @HttpCode(200)
  google(@Body() dto: GoogleSignInDto): Promise<SessionTokens> {
    return this.auth.signInGoogle(dto.idToken);
  }

  @Post('email/dev')
  @HttpCode(200)
  emailDev(@Body() dto: EmailDevSignInDto): Promise<SessionTokens> {
    return this.auth.signInEmailDev(dto.email, dto.displayName);
  }
}
