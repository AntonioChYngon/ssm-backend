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
import { PlanesModule } from './modules/planes/planes.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

// Módulos en migración al esquema del equipo: ver src/modules/_por-migrar/LEEME.md

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
    AuthModule,
    // Una línea por historia de usuario. Mantén el orden alfabético para evitar conflictos.
    PlanesModule, // HU-04
    ReportesModule, // HU-15
    UsuariosModule, // HU-02
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
