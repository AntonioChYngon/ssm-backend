import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard } from './common/auth';
import { ENTIDADES_ACCESO } from './database/entities';
import { ENTIDADES_PLAN } from './database/plan.entities';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { AuthModule } from './modules/auth/auth.module';
import { CorreoModule } from './modules/correo/correo.module';
import { InformesModule } from './modules/informes/informes.module';
import { NotificacionesModule } from './modules/notificaciones/notificaciones.module';
import { PlanesModule } from './modules/planes/planes.module';
import { RecordatoriosModule } from './modules/recordatorios/recordatorios.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HistoricoModule } from './modules/historico/historico.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { TransversalesModule } from './modules/transversales/transversales.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      errorMessage: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mariadb',
        host: config.get('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 3306)),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.get('DB_NAME', 'ssm'),
        // Entidades compartidas del esquema. Si un módulo necesita una entidad propia, la registra con
        // TypeOrmModule.forFeature([...]) y autoLoadEntities la agrega sola, sin tocar este archivo.
        entities: [...ENTIDADES_ACCESO, ...ENTIDADES_PLAN],
        autoLoadEntities: true,
        // El esquema lo define db/ssm_mariadb.sql. TypeORM nunca debe crear ni alterar tablas.
        synchronize: false,
        migrationsRun: false,
        charset: 'utf8mb4_unicode_ci',
        // DATE como texto YYYY-MM-DD y BIGINT como texto para no perder precisión.
        dateStrings: ['DATE'],
        // Todas las fechas y horas en UTC, igual que MariaDB en el contenedor, el CI y producción.
        // Sin esto, Node escribe la hora local y choca con CURRENT_TIMESTAMP (p. ej. ck_token_expiracion).
        timezone: 'Z',
        supportBigNumbers: true,
        bigNumberStrings: true,
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
    AuditoriaModule,
    CorreoModule,
    NotificacionesModule,
    AuthModule,
    // Una línea por historia de usuario. Mantén el orden alfabético para evitar conflictos.
    InformesModule, // HU-07, HU-08, HU-11
    PlanesModule, // HU-04
    RecordatoriosModule, // HU-10
    ReportesModule, // HU-15
    TransversalesModule, // HU-17
    HistoricoModule, // HU-16
    DashboardModule, // Dashboards con datos reales
    UsuariosModule, // HU-02
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
