-- Usuario de la aplicación (el backend NO debe conectarse como root).
-- Cambia 'CambiaEstaContrasena2026' por una contraseña propia y úsala en DB_PASSWORD del .env del backend.
CREATE USER IF NOT EXISTS 'ssm_app'@'localhost' IDENTIFIED BY 'CambiaEstaContrasena2026';
GRANT SELECT, INSERT, UPDATE, DELETE ON ssm.* TO 'ssm_app'@'localhost';
FLUSH PRIVILEGES;
