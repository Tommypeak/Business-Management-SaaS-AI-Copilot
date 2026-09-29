import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtVerifierService } from './jwt-verifier.service.js';
import { AuthenticatedUserService } from './authenticated-user.service.js';
import { PUBLIC_ROUTE } from './public.decorator.js';
import type { AuthenticatedRequest } from './auth-context.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
    private readonly users: AuthenticatedUserService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    const token = match?.[1];
    if (!token || token.length > 16384) throw new UnauthorizedException();
    const identity = await this.verifier.verify(token);
    request.currentUser = await this.users.resolve(identity.provider, identity.subject);
    return true;
  }
}
