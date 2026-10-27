# OposTest Pro

<div align="center">

![OposTest Pro](https://img.shields.io/badge/OposTest-Pro-0ea5e9?style=for-the-badge&logo=bookstack&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Node](https://img.shields.io/badge/node-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)
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

- Node.js 20 o superior
- PostgreSQL 14 o superior
- npm o yarn

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/opostest-pro.git
cd opostest-pro

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tu configuración

# 4. Crear las tablas en la base de datos
npm run db:push

# 5. Iniciar en modo desarrollo
npm run dev
```

La aplicación estará disponible en `http://localhost:5000`

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

En producción el servidor rechaza una clave de sesión ausente, de ejemplo o débil, incluido el secreto fijo de desarrollo. La cookie de sesión es `HttpOnly`, `Secure` bajo HTTPS, `SameSite=Lax` y caduca tras 30 días. Para Nginx, configura `TRUST_PROXY_HOPS=1` solo si todo el tráfico pasa por ese proxy controlado; el valor predeterminado es `0`. Puedes configurar `REQUEST_LOGGING_ENABLED=false` en una instancia privada. El registro de cuentas está deshabilitado por defecto en producción; establece `REGISTRATION_ENABLED=true` y reinicia el servidor solo cuando quieras permitir nuevas altas.

Las solicitudes API que modifican datos y las operaciones de login/registro deben proceder del mismo origen. El cliente servido por la aplicación usa rutas relativas y envía solicitudes same-origin, por lo que no necesita un token CSRF adicional.

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
npm run db:push      # Sincroniza esquema con la BD
npm run db:studio    # Abre Drizzle Studio (GUI)

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

Este proyecto está bajo la Licencia MIT. Ver el archivo [LICENSE](LICENSE) para más detalles.

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

La actualización SEC-05 usa una nueva versión de caché y elimina las cachés anteriores cuyo nombre pertenece a `opostest-`. Durante la activación conserva recursos estáticos que ya estaban guardados, elimina respuestas `/api` antiguas y deja intactas las cachés de otras aplicaciones.

Al publicar SEC-05, una instalación que aún ejecuta la PWA antigua debe terminar el test y cerrar todas las pestañas y ventanas de OposTest Pro; las versiones anteriores no pueden mostrar el nuevo aviso. El navegador activa el nuevo service worker cuando ya no quedan pestañas controladas por el anterior. Después, vuelve a abrir la app con conexión para cargar la versión nueva. En versiones nuevas, el aviso indica esta operación. No se fuerza una recarga mientras el test está abierto.

En V1 la API necesita conexión. Sus respuestas no se guardan en Cache Storage ni en cachés HTTP; sin conexión se muestra un error reintentable y no se recuperan datos privados guardados por una versión anterior.

Para repetir las comprobaciones reales en Chrome después de `npm run build`, inicia `node tests/browser/sec-05-server.mjs` y abre `http://localhost:4174/sec05-browser-test.html`. La página precarga una caché v1 privada, conserva una caché ajena y comprueba API online/offline y recursos estáticos contra el service worker del build. Para el flujo de sesiones con cuentas ficticias, inicia `node tests/browser/sec-05-app-server.mjs` y abre `http://localhost:4175/login` en dos pestañas; usa `account-a` y `account-b` con cualquier contraseña de prueba, sin una base de datos.

El flujo de login/logout A → B en dos pestañas requiere comprobación manual y no forma parte de `npm test` ni del CI. No se completó esa interacción de UI en esta validación; las pruebas automáticas cubren cancelación/limpieza del estado de consulta y la coordinación de transiciones entre pestañas.
