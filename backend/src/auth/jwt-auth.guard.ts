import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { Repository } from "typeorm";
import { IS_PUBLIC_KEY } from "./decorators/public.decorator";
import { JwtPayload } from "./interfaces/jwt-payload.interface";

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly reflector: Reflector,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass()
        ]);
        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request>();
        const token = this.extractBearerToken(request);
        if (!token) {
            throw new UnauthorizedException('Missing access token');
        }
        let payload: JwtPayload;
        try {
            payload = await this.jwtService.verifyAsync<JwtPayload>(token);
        } catch (error) {
            throw new UnauthorizedException('Invalid access token');
        }
        if (!payload?.sub) {
            throw new UnauthorizedException('Invalid access token');
        }
        const user = await this.userRepo.findOne({
            where: { id: payload.sub }
        });
        if (!user || !user.isActive) {
            throw new UnauthorizedException('Invalid access token');
        }
        (request as Request & { user: User }).user = user;
        return true;
    }

    private extractBearerToken(request: Request): string | undefined {
        const header = request.headers['authorization'];
        if (!header) return undefined;
        const [type, token] = header.split(' ');
        return type === 'Bearer' && token ? token : undefined;
    }
}