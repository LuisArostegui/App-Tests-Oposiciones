# OposTest Pro

<div align="center">

![OposTest Pro](https://img.shields.io/badge/OposTest-Pro-0ea5e9?style=for-the-badge&logo=bookstack&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-not%20declared-lightgrey?style=for-the-badge)
![Node](https://img.shields.io/badge/node-22.23.2-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)

**Plataforma profesional de preparación de oposiciones**

[Características](#-características) •
[Instalación](#-instalación-rápida) •
[Self-Hosting](#-self-hosting) •
[Documentación](#-documentación) •
[Contribuir](#-contribuir)

---

</div>

## Sobre OposTest Pro

OposTest Pro es una aplicación web progresiva (PWA) diseñada específicamente para la preparación de exámenes de oposiciones en España. Permite a los usuarios practicar con tests personalizados, realizar seguimiento de su progreso y gestionar bancos de preguntas de forma eficiente.

### Por qué OposTest Pro

- **Enfocado en oposiciones españolas** - Diseñado específicamente para el formato de exámenes de oposiciones
- **Funciona sin conexión** - Estudia en cualquier lugar, incluso sin Internet
- **Multiplataforma** - Instálalo en Windows, Android, iOS o úsalo en el navegador
- **Open Source** - Código abierto, gratuito y personalizable
- **Self-hosted** - Despliega tu propia instancia con total privacidad

---

## Características

### Tests y Práctica

| Característica | Descripción |
|----------------|-------------|
| **Tests aleatorios** | Genera tests con preguntas en orden aleatorio |
| **Tests secuenciales** | Practica las preguntas en orden original |
| **Pausar y continuar** | Guarda tu progreso y continúa más tarde |
| **Temporizador opcional** | Practica con límite de tiempo como en el examen real |
| **Corrección instantánea** | Revisa tus respuestas al finalizar |

### Gestión de Contenido

| Característica | Descripción |
|----------------|-------------|
| **Importar JSON** | Carga tus propios bancos de preguntas |
| **Servidores remotos** | Conecta a servidores para descargar tests |
| **Panel de administración** | Edita, añade o elimina preguntas |
| **2-8 opciones por pregunta** | Soporte flexible para diferentes formatos |

### Seguimiento de Progreso

| Característica | Descripción |
|----------------|-------------|
| **Historial completo** | Revisa todos tus tests realizados |
| **Gráficas de evolución** | Visualiza tu progreso con el tiempo |
| **Estadísticas detalladas** | Porcentaje de aciertos, tiempo medio, etc. |

### Sistema de Usuarios

| Característica | Descripción |
|----------------|-------------|
| **Registro e inicio de sesión** | Cada usuario tiene su propia cuenta |
| **Datos privados** | Cada usuario solo ve sus propios tests y resultados |
| **Sesiones persistentes** | No necesitas iniciar sesión cada vez (30 días) |
| **Contraseñas seguras** | Encriptadas con bcrypt |

### Experiencia de Usuario

| Característica | Descripción |
|----------------|-------------|
| **Interfaz en español** | UI completamente en español (España) |
| **Modo oscuro** | Cuida tu vista durante las sesiones nocturnas |
| **PWA instalable** | Instala como app nativa en tu dispositivo |
| **Diseño responsive** | Optimizado para móvil, tablet y escritorio |
| **Animaciones fluidas** | Transiciones suaves con Framer Motion |

---

## Stack Tecnológico

<div align="center">

| Frontend | Backend | Base de Datos | Herramientas |
|:--------:|:-------:|:-------------:|:------------:|
| ![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black) | ![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white) | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) | ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white) |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white) | ![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?style=flat-square&logo=drizzle&logoColor=black) | ![TailwindCSS](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white) |
| ![TanStack Query](https://img.shields.io/badge/TanStack-FF4154?style=flat-square&logo=reactquery&logoColor=white) | ![Zod](https://img.shields.io/badge/Zod-3E67B1?style=flat-square&logo=zod&logoColor=white) | | ![shadcn/ui](https://img.shields.io/badge/shadcn/ui-000000?style=flat-square&logo=shadcnui&logoColor=white) |

</div>

---

## Instalación Rápida

### Requisitos

- Node.js 22.12 o superior dentro de la rama 22 (versión local/CI: `22.23.2`, ver `.nvmrc`)
- PostgreSQL 14 o superior
- npm 10 (`package.json` limita la compatibilidad a npm 10)

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/opostest-pro.git
cd opostest-pro

# 2. Instalar exactamente el árbol de package-lock.json
npm ci

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tu configuración

# 4. Preparar el esquema de una base local nueva para desarrollo
npm run db:push

# 5. Iniciar en modo desarrollo
npm run dev
```

La aplicación estará disponible en `http://localhost:5000`

### PostgreSQL local

Instala PostgreSQL 14 o superior y crea una base y usuario dedicados. En `psql` como administrador:

```sql
CREATE ROLE opostest LOGIN PASSWORD 'elige-una-clave-local';
CREATE DATABASE opostest OWNER opostest;
```

Configura `DATABASE_URL` en `.env`. El servidor y Drizzle leen ese archivo; la configuración de esquema importa `dotenv/config`. No uses las credenciales de ejemplo fuera de una base local.

### Desarrollo, producción y comprobaciones

`npm run dev` inicia `server/index.ts` con `NODE_ENV=development`. `npm run build` genera `dist/`; `npm start` inicia ese build con `NODE_ENV=production` y exige un `SESSION_SECRET` único y fuerte. Ambos comandos funcionan en Windows y Linux mediante `script/run-server.mjs`.

Para preparar el esquema de desarrollo en una base local nueva, usa `npm run db:push`. El repositorio también conserva SQL versionado en `migrations/`; `db:push` no es el mecanismo de actualización de una base de producción. La migración `migrations/20261028_attempt_result_link.sql` contiene sus propias instrucciones de copia de seguridad y aplicación.

```bash
npm run check
npm test
npm run build
npm exec playwright install chromium  # primera ejecución de test:browser
npm run test:browser
```

`npm test` crea un PostgreSQL temporal con Docker o acepta un `TEST_DATABASE_URL` exclusivo. Rechaza la URL configurada para desarrollo. Las pruebas de navegador usan el build de producción y servidores de fixture; no validan la base ni la API desplegada.

---

## Configuración

Copia `.env.example` a `.env` y personaliza según tus necesidades:

```env
# Base de datos PostgreSQL
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/opostest

# Puerto del servidor
PORT=5000

# Personalización de la aplicación
APP_NAME=OposTest Pro
APP_DESCRIPTION=Preparación de oposiciones
WELCOME_MESSAGE=Preparando tu entorno de estudio...

# Seguridad (genera con: openssl rand -base64 48)
SESSION_SECRET=
TRUST_PROXY_HOPS=0
REQUEST_LOGGING_ENABLED=true
REGISTRATION_ENABLED=
```

### Variables de Entorno

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DATABASE_URL` | URL de conexión a PostgreSQL | Requerido |
| `PORT` | Puerto del servidor | `5000` |
| `APP_NAME` | Nombre de la aplicación | `OposTest Pro` |
| `APP_DESCRIPTION` | Descripción corta | `Preparación de oposiciones` |
| `WELCOME_MESSAGE` | Mensaje de bienvenida | `Preparando tu entorno de estudio...` |
| `SESSION_SECRET` | Clave para firmar sesiones; en producción debe ser aleatoria, privada y de al menos 32 caracteres | Generada por el administrador |
| `TRUST_PROXY_HOPS` | Número de saltos de proxy inverso confiables; `0` ignora cabeceras de proxy | `0` |
| `REQUEST_LOGGING_ENABLED` | Activa logs de método, ruta, estado y duración. No se guardan cuerpos ni query strings | `true` |
| `REGISTRATION_ENABLED` | Permite crear cuentas desde la pantalla de registro | Desarrollo: `true`; producción: `false` |
| `APP_URL` | Origen público exacto, sin barra final; restringe origen de las solicitudes mutables/CSRF detrás de proxy | Sin configurar para acceso same-origin |

En producción el servidor rechaza una clave de sesión ausente, de ejemplo o débil, incluido el secreto fijo de desarrollo. La cookie de sesión es `HttpOnly`, `Secure` bajo HTTPS, `SameSite=Lax` y caduca tras 30 días. Para Nginx, configura `TRUST_PROXY_HOPS=1` solo si todo el tráfico pasa por ese proxy controlado; el valor predeterminado es `0`. Puedes configurar `REQUEST_LOGGING_ENABLED=false` en una instancia privada. El registro de cuentas está deshabilitado por defecto en producción; establece `REGISTRATION_ENABLED=true` y reinicia el servidor solo cuando quieras permitir nuevas altas.

Las solicitudes API que modifican datos y las operaciones de login/registro deben proceder del mismo origen. El cliente servido por la aplicación usa rutas relativas y envía solicitudes same-origin, por lo que no necesita un token CSRF adicional.

### Auditoría de dependencias

La auditoría del `main` integrado de #15 registró 51 avisos. La PR #16 reduce ese resultado a 3 altos; esta actualización sobre `main` integra `drizzle-orm` 0.45.4, `drizzle-zod` 0.8.3 y `zod` 4.6.6, y `npm audit` vuelve a cero avisos (28-10-2026). El ORM queda por encima de la versión corregida de GHSA-gpj5-g38j-94v9 y Zod por encima de la versión corregida de GHSA-mrhx-c7xc-m3w5. Para conservar la importación de entre 2 y 8 respuestas en Zod 4 se usa `z.partialRecord`, porque `z.record` con claves enum ahora exige todas las claves. Reejecuta `npm audit` al cambiar el lockfile: estos recuentos corresponden a la auditoría fechada.

---

## Self-Hosting

Para desplegar OposTest Pro en tu propio servidor Ubuntu VPS, consulta la guía completa:

**[SELFHOSTING.md](SELFHOSTING.md)**

La guía incluye:

- Instalación de Node.js y PostgreSQL
- Configuración de la base de datos
- Despliegue con systemd (auto-arranque)
- Configuración de Nginx como proxy inverso
- SSL gratuito con Let's Encrypt
- Configuración del firewall
- Comandos de mantenimiento
- Copias de seguridad

---

## Formato de Preguntas

OposTest Pro acepta archivos JSON con el siguiente formato:

```json
[
  {
    "pregunta": "¿Cuál es la capital de España?",
    "respuestas": [
      "Barcelona",
      "Madrid",
      "Valencia",
      "Sevilla"
    ],
    "respuesta_correcta": 1,
    "oposicion": "Geografía"
  }
]
```

### Campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `pregunta` | string | Texto de la pregunta |
| `respuestas` | string[] | Array con 2-8 opciones de respuesta |
| `respuesta_correcta` | number | Índice de la respuesta correcta (0-based) |
| `oposicion` | string | Categoría o tipo de oposición (opcional) |

---

## API Endpoints

> **Nota**: Todas las rutas (excepto autenticación y configuración) requieren que el usuario esté autenticado.

### Autenticación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Registra un nuevo usuario |
| `POST` | `/api/auth/login` | Inicia sesión |
| `POST` | `/api/auth/logout` | Cierra la sesión actual |
| `GET` | `/api/auth/me` | Obtiene el usuario actual |

### Tests

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/tests` | Lista los tests del usuario |
| `GET` | `/api/tests/:id` | Obtiene las preguntas de un test |
| `POST` | `/api/tests` | Importa un nuevo test (JSON) |
| `PUT` | `/api/tests/:id/rename` | Renombra un test |
| `DELETE` | `/api/tests/:id` | Elimina un test |

### Resultados

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/results` | Lista el historial del usuario |
| `POST` | `/api/results` | Guarda un nuevo resultado |
| `DELETE` | `/api/results/:id` | Elimina un resultado |

### Intentos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/attempts` | Lista intentos del usuario |
| `GET` | `/api/attempts/:id` | Obtiene un intento específico |
| `POST` | `/api/attempts` | Crea un nuevo intento |
| `PUT` | `/api/attempts/:id` | Actualiza un intento |
| `DELETE` | `/api/attempts/:id` | Elimina un intento |

### Configuración

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/config` | Obtiene la configuración de la app |

---

## PWA (Progressive Web App)

OposTest Pro es una PWA completa que permite:

### Instalación

- **Windows/macOS**: Haz clic en el icono de instalación en la barra de direcciones
- **Android**: Menú del navegador → "Añadir a pantalla de inicio"
- **iOS**: Compartir → "Añadir a pantalla de inicio"

### Funcionalidades Offline

- Acceso a tests descargados previamente
- Realización de tests sin conexión
- Sincronización automática al recuperar conexión
- Indicador de estado de conexión

---

## Estructura del Proyecto

```
opostest-pro/
├── client/                 # Frontend React
│   ├── src/
│   │   ├── components/     # Componentes reutilizables
│   │   ├── hooks/          # Custom hooks
│   │   ├── lib/            # Utilidades y configuración
│   │   └── pages/          # Vistas principales
│   └── public/             # Assets estáticos y PWA
├── server/                 # Backend Express
│   ├── routes.ts           # Definición de rutas API
│   ├── storage.ts          # Capa de abstracción de datos
│   ├── auth.ts             # Sistema de autenticación
│   └── config.ts           # Configuración del servidor
├── shared/                 # Código compartido
│   ├── schema.ts           # Esquema de base de datos (Drizzle)
│   └── routes.ts           # Contratos de API
├── .env.example            # Ejemplo de configuración
├── SELFHOSTING.md          # Guía de self-hosting
└── README.md               # Este archivo
```

---

## Scripts Disponibles

```bash
# Desarrollo
npm run dev          # Inicia servidor de desarrollo

# Base de datos
npm run db:push      # Sincroniza el esquema de una base local de desarrollo

# Producción
npm run build        # Compila para producción
npm start            # Inicia en modo producción
```

---

## Contribuir

¡Las contribuciones son bienvenidas! Por favor:

1. Haz fork del repositorio
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Haz commit de tus cambios (`git commit -m 'Añade nueva funcionalidad'`)
4. Haz push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

### Guía de Estilo

- Código en TypeScript estricto
- Componentes funcionales con hooks
- Tailwind CSS para estilos
- Commits en español o inglés

---

## Licencia

Ni el upstream [`Alexmofu/App-Tests-Oposiciones`](https://github.com/Alexmofu/App-Tests-Oposiciones) ni este fork incluyen un archivo `LICENSE` en `main` (comprobado el 28-10-2026). El campo MIT anterior de `package.json` y esta referencia del README no acreditaban una autorización y se han retirado. La licencia y los derechos para redistribuir el código deben aclararse con el titular correspondiente antes de distribuir este fork. Esta nota no concede derechos adicionales.

---

## Agradecimientos

- [shadcn/ui](https://ui.shadcn.com/) - Componentes de interfaz
- [Drizzle ORM](https://orm.drizzle.team/) - ORM para TypeScript
- [TanStack Query](https://tanstack.com/query) - Gestión de estado asíncrono
- [Framer Motion](https://www.framer.com/motion/) - Animaciones

---

<div align="center">

**Hecho con para opositores de España**

[Reportar Bug](../../issues) •
[Solicitar Feature](../../issues)

</div>
# Actualización de seguridad de la PWA

La actualización SEC-05 usa una nueva versión de caché y elimina las cachés anteriores cuyo nombre pertenece a `opostest-`. Durante la activación solo migra assets same-origin con nombre versionado/hash y MIME estático permitido. Excluye HTML/documentos de navegación, API y assets sin hash; nunca sobrescribe un recurso que ya está en el caché nuevo y deja intactas las cachés de otras aplicaciones.

Al publicar SEC-05, una instalación que aún ejecuta la PWA antigua debe terminar el test y cerrar todas las pestañas y ventanas de OposTest Pro; las versiones anteriores no pueden mostrar el nuevo aviso. El navegador activa el nuevo service worker cuando ya no quedan pestañas controladas por el anterior. Después, vuelve a abrir la app con conexión para cargar la versión nueva. En versiones nuevas, el aviso indica esta operación. No se fuerza una recarga mientras el test está abierto.

En V1 la API necesita conexión. Sus respuestas no se guardan en Cache Storage ni en cachés HTTP; sin conexión se muestra un error reintentable y no se recuperan datos privados guardados por una versión anterior.

La suite Playwright incluye una prueba en Chromium real contra el build de producción. Prepara una caché v1 con HTML antiguo, una respuesta API privada y otra caché ajena; instala/activa v2 y comprueba que una apertura offline devuelve el shell nuevo, además de probar API online/offline, Cache Storage y recursos estáticos.

Las pruebas E2E de sesión se ejecutan contra el build de producción y un servidor en memoria con cuentas ficticias (`account-a` y `account-b`); no usan base de desarrollo ni cuentas reales. Instala Chromium una vez y ejecuta:

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

El CI instala Chromium con `npx playwright install --with-deps chromium` y ejecuta `npm run test:browser`. Cinco escenarios prueban A → logout → B, dos pestañas, una respuesta tardía de A, sesión caducada y recuperación tras cerrar la pestaña durante logout. Un sexto escenario controla el build de producción con el service worker real. Los casos se ejecutan en serie porque los servidores de prueba mantienen estado en memoria. Las pruebas unitarias cubren además el descarte de escrituras en cola y callbacks de mutaciones de la sesión anterior.
