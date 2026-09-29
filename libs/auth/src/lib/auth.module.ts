import {
  Module,
  type DynamicModule,
  type InjectionToken,
} from '@nestjs/common';
import {
  createAccessTokenVerifier,
  type AccessTokenVerifierOptions,
} from './access-token';
import { ACCESS_TOKEN_VERIFIER, JwtAuthGuard } from './jwt-auth.guard';

export interface AuthModuleOptions {
  /** Usually reads `JWT_PUBLIC_KEY` (via `pemFromEnv`) and `JWT_KEY_ID` from config. */
  useFactory: (
    ...deps: never[]
  ) => AccessTokenVerifierOptions | Promise<AccessTokenVerifierOptions>;
  inject?: InjectionToken[];
}

/** Provides the access-token verifier and `JwtAuthGuard`. Verify-only: signing lives in Identity. */
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      providers: [
        {
          provide: ACCESS_TOKEN_VERIFIER,
          useFactory: async (...deps: never[]) =>
            createAccessTokenVerifier(await options.useFactory(...deps)),
          inject: options.inject ?? [],
        },
        JwtAuthGuard,
      ],
      exports: [ACCESS_TOKEN_VERIFIER, JwtAuthGuard],
    };
  }
}
