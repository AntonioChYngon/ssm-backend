import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard } from './common/auth';
import { AuthModule } from './modules/auth/auth.module';
import { BitacoraModule } from './modules/bitacora/bitacora.module';
import { EvidenciasModule } from './modules/evidencias/evidencias.module';
import { InformesModule } from './modules/informes/informes.module';
import { NotificacionesModule } from './modules/notificaciones/notificaciones.module';
import { ObservacionesModule } from './modules/observaciones/observaciones.module';
import { PlanesModule } from './modules/planes/planes.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mariadb',
        host: config.get('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 3306)),
        username: config.get('DB_USER'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME', 'ssm'),
        autoLoadEntities: true,
        synchronize: config.get('DB_SYNC') === 'true' && config.get('NODE_ENV') !== 'production',
        timezone: 'Z',
        charset: 'utf8mb4_unicode_ci',
        // Las columnas DATE se manejan como texto YYYY-MM-DD para evitar corrimientos de zona horaria.
        dateStrings: ['DATE'],
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '8h') },
      }),
    }),
    BitacoraModule,
    UsuariosModule,
    AuthModule,
    NotificacionesModule,
    ObservacionesModule,
    PlanesModule,
    InformesModule,
    EvidenciasModule,
    ReportesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
