import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Environment } from '../config/environment.js';

@Injectable()
export class JwtVerifierService {
  private readonly jwks;
  private readonly issuer;
  constructor(private readonly config: ConfigService<Environment, true>) {
    this.issuer = config.get('AUTH_ISSUER', { infer: true });
    const url = config.get('AUTH_JWKS_URL', { infer: true });
    this.jwks = url ? createRemoteJWKSet(new URL(url), { timeoutDuration: 5000 }) : undefined;
  }

  async verify(token: string): Promise<{ provider: string; subject: string }> {
    if (!this.issuer || !this.jwks)
      throw new ServiceUnavailableException('Authentication is not configured');
    try {
      const audience = this.config.get('AUTH_AUDIENCE', { infer: true });
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        ...(audience ? { audience } : {}),
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
      if (!payload.sub?.trim() || payload.sub.length > 255) throw new Error('Invalid subject');
      const parties = this.config.get('AUTH_AUTHORIZED_PARTIES', { infer: true });
      if (parties.length && (typeof payload.azp !== 'string' || !parties.includes(payload.azp))) {
        throw new Error('Invalid authorized party');
      }
      // Namespace identity by configured issuer, never by an arbitrary JWT claim.
      return { provider: this.issuer, subject: payload.sub };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
