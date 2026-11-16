import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export type Mensaje = { para: string; asunto: string; texto: string; html?: string };

/**
 * Envío de correo. En desarrollo apunta a Mailpit (compose.yaml): los correos no salen a internet
 * y se ven en http://localhost:8025. En producción se configura el SMTP institucional en el .env.
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);
  private readonly transporte: Transporter | null;
  private readonly remitente: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.remitente = config.get('SMTP_FROM', 'SSM FES Acatlán <no-responder@acatlan.unam.mx>');
    this.transporte = host
      ? createTransport({
          host,
          port: Number(config.get('SMTP_PORT', 1025)),
          secure: config.get('SMTP_SECURE') === 'true',
          auth: config.get('SMTP_USER') ? { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASSWORD') } : undefined,
        })
      : null;
  }

  async enviar(mensaje: Mensaje) {
    if (!this.transporte) {
      // Sin SMTP_HOST (por ejemplo en pruebas) solo se registra en consola.
      this.logger.log(`[correo sin enviar] Para: ${mensaje.para} · ${mensaje.asunto}\n${mensaje.texto}`);
      return;
    }
    await this.transporte.sendMail({ from: this.remitente, to: mensaje.para, subject: mensaje.asunto, text: mensaje.texto, html: mensaje.html });
  }
}

@Global()
@Module({ providers: [CorreoService], exports: [CorreoService] })
export class CorreoModule {}
