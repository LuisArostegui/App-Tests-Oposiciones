# Guía de Self-Hosting para OposTest Pro

Esta guía te explica paso a paso cómo instalar OposTest Pro en tu propio servidor Ubuntu (VPS).

## Requisitos Previos

- **Sistema Operativo**: Ubuntu 20.04 LTS o superior
- **RAM**: Mínimo 1GB (recomendado 2GB)
- **Almacenamiento**: Mínimo 10GB libres
- **Acceso**: Usuario con permisos sudo

---

## Paso 1: Actualizar el Sistema

Primero, actualiza todos los paquetes del sistema:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Paso 2: Instalar Node.js 20

OposTest Pro requiere Node.js versión 20 o superior.

```bash
# Instalar curl si no lo tienes
sudo apt install -y curl

# Añadir el repositorio de NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Instalar Node.js
sudo apt install -y nodejs

# Verificar la instalación
node --version  # Debería mostrar v20.x.x
npm --version   # Debería mostrar 10.x.x
```

---

## Paso 3: Instalar PostgreSQL

OposTest Pro usa PostgreSQL como base de datos.

```bash
# Instalar PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Iniciar el servicio
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verificar que está funcionando
sudo systemctl status postgresql
```

### Crear la Base de Datos

```bash
# Acceder a PostgreSQL como superusuario
sudo -u postgres psql

# Dentro de PostgreSQL, ejecuta estos comandos:
CREATE USER opostest WITH PASSWORD 'tu_contraseña_segura';
CREATE DATABASE opostest OWNER opostest;
GRANT ALL PRIVILEGES ON DATABASE opostest TO opostest;

# Salir de PostgreSQL
\q
```

> ⚠️ **Importante**: Cambia `tu_contraseña_segura` por una contraseña fuerte y recuérdala para el archivo `.env`.

---

## Paso 4: Instalar Git

```bash
sudo apt install -y git
```

---

## Paso 5: Clonar el Repositorio

```bash
# Crear directorio para la aplicación
sudo mkdir -p /var/www
cd /var/www

# Clonar el repositorio (reemplaza con tu repositorio)
sudo git clone https://tu-repositorio/opostest-pro.git opostest
cd opostest

# Dar permisos al usuario actual
sudo chown -R $USER:$USER /var/www/opostest
```

---

## Paso 6: Configurar Variables de Entorno

```bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar el archivo con nano (o tu editor preferido)
nano .env
```

Modifica los siguientes valores en el archivo `.env`:

```env
# Base de datos - usa los datos que configuraste en el Paso 3
DATABASE_URL=postgresql://opostest:tu_contraseña_segura@localhost:5432/opostest

# Puerto (5000 por defecto, cámbialo si es necesario)
PORT=5000

# IMPORTANTE: Genera una clave secreta segura para las sesiones de usuario
# Ejecuta: openssl rand -base64 48 y guarda el resultado solo en .env
SESSION_SECRET=

# El ejemplo de Nginx de esta guía tiene un salto de proxy controlado.
# Mantén 0 si expones directamente la aplicación o cambia solo tras limitar el acceso al proxy.
TRUST_PROXY_HOPS=1

# Para una instancia privada puedes desactivar los logs de solicitudes API.
REQUEST_LOGGING_ENABLED=false

# El registro de nuevas cuentas está deshabilitado en producción por defecto.
# Cámbialo a true solo mientras quieras permitir altas y reinicia el servidor.
REGISTRATION_ENABLED=false

# Nombre de tu aplicación
APP_NAME=OposTest Pro
```

> **Importante**: El `SESSION_SECRET` es obligatorio en producción y se usa para firmar las sesiones de usuario. Genera una clave segura con `openssl rand -base64 48`, guárdala solo en `.env` y nunca la compartas. La aplicación rechaza valores ausentes, de ejemplo, débiles y el secreto fijo de desarrollo. `REGISTRATION_ENABLED` vale `false` por defecto en producción; configúralo explícitamente a `true` y reinicia el servidor para permitir nuevas cuentas.

Guarda el archivo: `Ctrl + X`, luego `Y`, luego `Enter`.

---

## Paso 7: Instalar Dependencias

```bash
# Instalar todas las dependencias
npm install

# Esto puede tardar unos minutos
```

---

## Paso 8: Crear las Tablas de la Base de Datos

```bash
# Sincronizar el esquema con la base de datos
npm run db:push
```

> **Nota**: Esto creará las tablas necesarias incluyendo `users`, `questions`, `results`, `test_attempts` y `session` (para sesiones persistentes).

---

## Paso 9: Compilar la Aplicación

```bash
# Construir la versión de producción
npm run build
```

---

## Paso 10: Probar la Aplicación

```bash
# Ejecutar en modo producción
npm start
```

Abre tu navegador y visita `http://IP_DE_TU_SERVIDOR:5000`. Deberías ver la página de inicio de sesión. Registra tu primera cuenta de usuario para empezar a usar la aplicación.

Presiona `Ctrl + C` para detener la aplicación.

---

## Paso 11: Configurar como Servicio

Tienes dos opciones para ejecutar la aplicación como servicio: **PM2** (más fácil) o **systemd** (más robusto).

### Opción A: Usar PM2 (Recomendado para principiantes)

PM2 es un gestor de procesos fácil de usar:

```bash
# Instalar PM2 globalmente
sudo npm install -g pm2

# Iniciar la aplicación (IMPORTANTE: usar --cwd para establecer el directorio correcto)
pm2 start /var/www/opostest/dist/index.cjs --name opostest --cwd /var/www/opostest

# Configurar para que inicie automáticamente al reiniciar el servidor
pm2 startup
pm2 save

# Comandos útiles:
pm2 status              # Ver estado
pm2 logs opostest       # Ver logs en tiempo real
pm2 restart opostest    # Reiniciar aplicación
pm2 stop opostest       # Detener aplicación
pm2 delete opostest     # Eliminar y volver a crear si hay problemas
```

> **Importante**: Usa siempre `--cwd /var/www/opostest` para que PM2 ejecute la aplicación desde el directorio correcto donde está el archivo `.env`.

### Opción B: Usar systemd (Más robusto)

Para que la aplicación se ejecute automáticamente al iniciar el servidor:

```bash
# Crear archivo de servicio
sudo nano /etc/systemd/system/opostest.service
```

Pega el siguiente contenido:

```ini
[Unit]
Description=OposTest Pro
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/opostest
ExecStart=/usr/bin/node dist/index.cjs
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

# Cargar variables de entorno desde .env
EnvironmentFile=/var/www/opostest/.env

[Install]
WantedBy=multi-user.target
```

Guarda el archivo y ejecuta:

```bash
# Dar permisos a www-data
sudo chown -R www-data:www-data /var/www/opostest

# Recargar systemd
sudo systemctl daemon-reload

# Habilitar el servicio
sudo systemctl enable opostest

# Iniciar el servicio
sudo systemctl start opostest

# Verificar el estado
sudo systemctl status opostest
```

---

## Paso 12: Configurar Nginx (Proxy Inverso) - Opcional pero Recomendado

Nginx permite usar el puerto 80/443 y añadir SSL.

Si esta es la única capa de proxy inverso y el puerto de la aplicación no está disponible desde Internet, configura `TRUST_PROXY_HOPS=1`. Para acceso directo usa `TRUST_PROXY_HOPS=0`. La aplicación no confía en cabeceras de proxy por defecto. En producción las cookies de sesión requieren HTTPS.

```bash
# Instalar Nginx
sudo apt install -y nginx

# Crear configuración del sitio
sudo nano /etc/nginx/sites-available/opostest
```

Pega el siguiente contenido:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;  # Cambia por tu dominio o IP

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activa la configuración:

```bash
# Crear enlace simbólico
sudo ln -s /etc/nginx/sites-available/opostest /etc/nginx/sites-enabled/

# Verificar la configuración
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
```

---

## Paso 13: Configurar SSL con Let's Encrypt - Opcional

Para añadir HTTPS gratuito:

```bash
# Instalar Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtener certificado (reemplaza con tu dominio y email)
sudo certbot --nginx -d tu-dominio.com -m tu@email.com --agree-tos

# El certificado se renovará automáticamente
```

---

## Paso 14: Configurar el Firewall

```bash
# Instalar ufw si no está instalado
sudo apt install -y ufw

# Permitir SSH (¡importante!)
sudo ufw allow ssh

# Permitir HTTP y HTTPS
sudo ufw allow 'Nginx Full'

# Si no usas Nginx, permite el puerto 5000 directamente
# sudo ufw allow 5000

# Activar el firewall
sudo ufw enable

# Verificar reglas
sudo ufw status
```

---

## Comandos Útiles

### Ver logs de la aplicación
```bash
sudo journalctl -u opostest -f
```

### Reiniciar la aplicación
```bash
sudo systemctl restart opostest
```

### Actualizar la aplicación
```bash
cd /var/www/opostest
git pull
npm install
npm run build
sudo systemctl restart opostest
```

### Ver estado del servicio
```bash
sudo systemctl status opostest
```

---

## Solución de Problemas

### La aplicación no inicia
```bash
# Ver logs detallados
sudo journalctl -u opostest -n 50

# Verificar que PostgreSQL está funcionando
sudo systemctl status postgresql

# Probar la conexión a la base de datos
psql -U opostest -d opostest -h localhost
```

### Error de conexión a la base de datos
1. Verifica que `DATABASE_URL` en `.env` es correcta
2. Verifica que PostgreSQL está corriendo: `sudo systemctl status postgresql`
3. Verifica el usuario y contraseña de PostgreSQL

### Error: DATABASE_URL must be set
Este error normalmente indica que la aplicación no encuentra el archivo `.env`. Verifica que:
1. El archivo `.env` existe en la raíz del proyecto (`/var/www/opostest/.env`)
2. El archivo tiene la variable `DATABASE_URL` configurada
3. Si usas PM2, simplemente reinicia: `pm2 restart opostest`

> **Nota técnica**: La aplicación carga automáticamente dotenv al inicio del bundle de producción, por lo que no necesitas exportar las variables manualmente.

### Puerto 5000 ya en uso
Cambia el puerto en `.env`:
```env
PORT=3000
```
Y reinicia: `sudo systemctl restart opostest`

### Permisos denegados
```bash
sudo chown -R www-data:www-data /var/www/opostest
```

---

## Copias de Seguridad

### Exportar la base de datos
```bash
pg_dump -U opostest -d opostest > backup_$(date +%Y%m%d).sql
```

### Importar la base de datos
```bash
psql -U opostest -d opostest < backup_20240115.sql
```

---

## Soporte

Si tienes problemas, revisa los logs con:
```bash
sudo journalctl -u opostest -f
```

¡Tu aplicación OposTest Pro ya está lista para usar en tu propio servidor!
