# Documentación - Aplicación de Test de Oposiciones

## Índice
1. [Descripción General](#descripción-general)
2. [Tecnologías Utilizadas](#tecnologías-utilizadas)
3. [Estructura del Proyecto](#estructura-del-proyecto)
4. [Formato del JSON](#formato-del-json)
5. [Funcionalidades](#funcionalidades)
6. [Guía de Uso](#guía-de-uso)
7. [Conexión Remota](#conexión-remota)
8. [Base de Datos](#base-de-datos)

---

## Descripción General

Esta aplicación está diseñada para practicar tests de oposiciones. Permite:
- Cargar archivos JSON con preguntas
- Realizar tests con preguntas aleatorias o en orden
- Ver resultados con porcentaje de aciertos
- Editar y administrar las preguntas
- Mantener un historial de puntuaciones
- Conectarse a un servidor remoto para descargar más tests

---

## Tecnologías Utilizadas

### Frontend
| Tecnología | Uso |
|------------|-----|
| **React 18** | Librería principal para la interfaz de usuario |
| **TypeScript** | Tipado estático para mayor robustez |
| **Tailwind CSS** | Framework de estilos CSS utilitarios |
| **Shadcn/UI** | Componentes de interfaz modernos y accesibles |
| **Wouter** | Enrutamiento ligero para React |
| **TanStack Query** | Gestión de estado del servidor y caché |
| **Framer Motion** | Animaciones fluidas |
| **Recharts** | Gráficos para el historial de puntuaciones |
| **Lucide React** | Iconos SVG |

### Backend
| Tecnología | Uso |
|------------|-----|
| **Node.js** | Entorno de ejecución JavaScript |
| **Express** | Framework web para el servidor API |
| **TypeScript** | Tipado estático |
| **Drizzle ORM** | ORM moderno para base de datos |
| **PostgreSQL** | Base de datos relacional |
| **Zod** | Validación de esquemas |

### Herramientas de Desarrollo
| Tecnología | Uso |
|------------|-----|
| **Vite** | Bundler y servidor de desarrollo rápido |
| **ESBuild** | Compilación TypeScript ultrarrápida |
| **Drizzle Kit** | Migraciones de base de datos |

---

## Estructura del Proyecto

```
├── client/                    # Código del frontend
│   ├── src/
│   │   ├── components/        # Componentes reutilizables
│   │   │   ├── ui/           # Componentes Shadcn/UI
│   │   │   ├── question-card.tsx
│   │   │   ├── question-editor.tsx
│   │   │   ├── import-dialog.tsx
│   │   │   └── theme-toggle.tsx
│   │   ├── hooks/            # Hooks personalizados
│   │   │   ├── use-tests.ts
│   │   │   ├── use-results.ts
│   │   │   └── use-questions.ts
│   │   ├── lib/              # Utilidades
│   │   ├── pages/            # Páginas de la aplicación
│   │   │   ├── home.tsx      # Página principal
│   │   │   ├── test-view.tsx # Vista del test
│   │   │   ├── results.tsx   # Resultados
│   │   │   ├── admin.tsx     # Administración
│   │   │   └── history.tsx   # Historial
│   │   ├── App.tsx           # Componente raíz
│   │   └── main.tsx          # Punto de entrada
│   └── index.html
├── server/                    # Código del backend
│   ├── db.ts                 # Conexión a base de datos
│   ├── storage.ts            # Capa de acceso a datos
│   ├── routes.ts             # Rutas de la API
│   └── index.ts              # Punto de entrada del servidor
├── shared/                    # Código compartido
│   ├── schema.ts             # Esquema de base de datos y tipos
│   └── routes.ts             # Contrato de la API
└── attached_assets/           # Archivos adjuntos (JSONs de ejemplo)
```

---

## Formato del JSON

La aplicación acepta archivos JSON con el siguiente formato:

```json
[
  {
    "pregunta": "Texto de la pregunta",
    "respuestas": {
      "A": "Primera opción",
      "B": "Segunda opción",
      "C": "Tercera opción",
      "D": "Cuarta opción"
    },
    "respuesta_correcta": "A",
    "oposicion": "Nombre de la oposición"
  }
]
```

### Campos:
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `pregunta` | string | El texto de la pregunta |
| `respuestas` | object | Objeto con las opciones (A, B, C, D, etc.) |
| `respuesta_correcta` | string | La letra de la respuesta correcta |
| `oposicion` | string | Categoría o nombre de la oposición (opcional) |

### Notas importantes:
- El número de respuestas es flexible (2, 3, 4, 5... opciones)
- La interfaz se adapta automáticamente al número de respuestas
- Las claves de respuestas deben ser letras (A, B, C, D...)

---

## Funcionalidades

### 1. Página Principal (Home)
- **Ver tests disponibles**: Lista de todos los tests importados
- **Importar JSON local**: Subir archivos desde tu ordenador
- **Conexión remota**: Conectar a un servidor para descargar tests
- **Acceso rápido**: Enlaces a Historial y Administración

### 2. Realizar Test (Test View)
- **Modo aleatorio**: Opción para mezclar las preguntas
- **Navegación**: Botones Anterior/Siguiente
- **Feedback inmediato**: La respuesta correcta se muestra en verde, la incorrecta en rojo
- **Contador de progreso**: Muestra pregunta actual / total
- **Finalizar test**: Calcula y guarda la puntuación

### 3. Resultados
- **Puntuación**: Número de aciertos sobre total
- **Porcentaje**: Porcentaje de aciertos
- **Acciones**: Reintentar o volver al inicio

### 4. Historial (Scoreboard)
- **Tabla de resultados**: Todos los intentos pasados
- **Gráfico**: Visualización de la evolución
- **Ordenado por fecha**: Los más recientes primero

### 5. Administración
- **Lista de preguntas**: Todas las preguntas de todos los tests
- **Editar pregunta**: Modificar texto, respuestas y respuesta correcta
- **Eliminar pregunta**: Borrar preguntas individuales
- **Búsqueda/Filtro**: Por test o categoría

### 6. Modo Oscuro/Claro
- Toggle en la cabecera para cambiar entre temas
- Se guarda la preferencia en el navegador

---

## Guía de Uso

### Importar un Test Local

1. Ve a la **Página Principal**
2. Haz clic en **"Importar JSON"**
3. Selecciona un archivo `.json` desde tu ordenador
4. El test aparecerá en la lista de tests disponibles

### Realizar un Test

1. En la página principal, haz clic en el test que quieras realizar
2. (Opcional) Activa **"Aleatorizar"** para mezclar las preguntas
3. Haz clic en **"Iniciar Test"**
4. Selecciona una respuesta para cada pregunta
5. Usa **Siguiente/Anterior** para navegar
6. Al terminar, haz clic en **"Finalizar"**
7. Verás tu puntuación y se guardará en el historial

### Editar una Pregunta

1. Ve a **Administración** (icono de configuración)
2. Busca la pregunta que quieres editar
3. Haz clic en el botón **Editar** (icono de lápiz)
4. Modifica:
   - Texto de la pregunta
   - Textos de las respuestas
   - Respuesta correcta (selecciona la letra)
5. Haz clic en **"Guardar"**

### Eliminar una Pregunta

1. Ve a **Administración**
2. Busca la pregunta
3. Haz clic en el botón **Eliminar** (icono de papelera)
4. Confirma la eliminación

### Ver el Historial

1. Haz clic en **Historial** (icono de gráfico)
2. Verás una tabla con todos tus intentos
3. El gráfico muestra tu evolución

---

## Conexión Remota

La aplicación puede conectarse a un servidor HTTP que tenga archivos JSON disponibles.

### Requisitos del servidor remoto:
- Debe servir un listado de directorio HTML (como `python -m http.server`)
- Los archivos deben tener extensión `.json`
- Debe permitir CORS o estar en la misma red

### Cómo conectar:

1. En la página principal, introduce la URL del servidor
   - Ejemplo: `http://192.168.1.50:8000`
2. Haz clic en **"Conectar"**
3. Aparecerá la lista de archivos `.json` disponibles
4. Haz clic en un archivo para importarlo

### Iniciar un servidor local simple (Python):
```bash
cd carpeta_con_jsons
python -m http.server 8000
```
El servidor estará en `http://tu-ip:8000`

---

## Base de Datos

### Tablas

#### `questions`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | serial | ID único autoincremental |
| test_id | text | Identificador del test (nombre del archivo) |
| question_text | text | Texto de la pregunta |
| answers | jsonb | Objeto JSON con las respuestas |
| correct_answer | text | Letra de la respuesta correcta |
| category | text | Categoría/oposición |

#### `results`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | serial | ID único autoincremental |
| test_id | text | Identificador del test |
| score | integer | Porcentaje de aciertos (0-100) |
| correct_count | integer | Número de aciertos |
| total_questions | integer | Total de preguntas |
| completed_at | timestamp | Fecha y hora de finalización |

### Gestión de la base de datos

Los datos se almacenan en PostgreSQL. Para sincronizar cambios en el esquema:

```bash
npm run db:push
```

---

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tests` | Lista todos los tests |
| GET | `/api/tests/:id` | Obtiene preguntas de un test |
| POST | `/api/tests/import` | Importa un nuevo test |
| PUT | `/api/questions/:id` | Actualiza una pregunta |
| DELETE | `/api/questions/:id` | Elimina una pregunta |
| GET | `/api/results` | Lista el historial |
| POST | `/api/results` | Guarda un resultado |
| GET | `/api/remote/list?url=...` | Desactivado: responde 503 a usuarios autenticados |
| GET | `/api/remote/fetch?url=...&filename=...` | Desactivado: responde 503 a usuarios autenticados |

La importación remota permanece desactivada en esta versión y no existe una opción de entorno para reactivarla. No se realizan conexiones salientes desde estas rutas. Reactivarla requiere primero una allowlist administrada, validación de destino y ruta, control de redirecciones y DNS, y límites de tiempo y tamaño. La importación local de archivos JSON continúa disponible.

---

## Atajos y Consejos

1. **Modo oscuro**: El toggle está en la esquina superior derecha
2. **Navegación rápida**: Usa los iconos de la cabecera
3. **Aleatorización**: Cada vez que activas aleatorizar, el orden cambia
4. **Múltiples tests**: Puedes importar varios archivos JSON
5. **Edición masiva**: Ve a Administración para gestionar todas las preguntas

---

## Solución de Problemas

### "El test no se importa"
- Verifica que el JSON tenga el formato correcto
- Comprueba que el archivo tenga extensión `.json`
- Abre la consola del navegador (F12) para ver errores

### "No puedo conectar al servidor remoto"
- Asegúrate de que la URL sea correcta
- Verifica que el servidor esté corriendo
- Comprueba que no haya problemas de firewall

### "Las respuestas no se muestran"
- Verifica que el campo `respuestas` en el JSON sea un objeto válido
- Las claves deben ser strings ("A", "B", etc.)

---

## Desarrollo

### Iniciar en modo desarrollo:
```bash
npm run dev
```

### Sincronizar base de datos:
```bash
npm run db:push
```

### Estructura de comandos:
- `npm run dev` - Inicia servidor de desarrollo
- `npm run build` - Compila para producción
- `npm run db:push` - Sincroniza esquema de BD

---

## Créditos

Desarrollado utilizando:
- React + TypeScript
- Express.js
- PostgreSQL + Drizzle ORM
- Tailwind CSS + Shadcn/UI
- Vite

---

*Última actualización: Enero 2026*
