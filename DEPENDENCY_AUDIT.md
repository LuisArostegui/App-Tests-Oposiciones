# Auditoría de dependencias — 28-10-2026

Auditoría de `origin/main` después de integrar #15: `npm ci` → 51 avisos (4 bajos, 17 moderados, 28 altos, 2 críticos). Después de esta rama: `npm audit` → 3 altos; `npm audit --omit=dev` → los mismos 3 altos. Ambos códigos de salida siguen siendo 1. No se usó `npm audit fix --force` ni se ocultaron avisos.

## Correcciones compatibles

| Dependencia y uso | Antes → después | Aviso e impacto |
| --- | --- | --- |
| `express` (directa, producción y bundle del servidor), con `body-parser`, `path-to-regexp`, `proxy-addr` y `qs` transitivos | 4.21.2 → 4.22.3; 1.20.3 → 1.20.9; 0.1.12 → 0.1.13; 2.0.7 → 2.0.8; 6.13.0 → 6.16.2 | DoS al parsear, ReDoS de rutas, suplantación IP detrás de proxy y DoS de `qs`. El parche conserva Express 4; se contrastó con [body-parser comprimido](https://github.com/advisories/GHSA-27r3-jxmh-p828), [path-to-regexp](https://github.com/advisories/GHSA-37ch-88jc-xwx2), [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) y [qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g). |
| `ws` directa de producción | 8.18.0 → 8.22.0 | Divulgación de memoria y DoS por fragmentos WebSocket. Está instalada, pero no aparece en el grafo de imports del bundle del servidor. [Aviso de memoria](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) y [aviso de DoS](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). |
| `lodash`, transitiva de `recharts` (interfaz) | 4.17.21 → 4.18.1 | Inyección de código en plantillas y prototype pollution ([GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc), [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh)). |
| `vite` y `rollup` (solo herramientas de desarrollo/build) | 7.3.0 → 7.3.7; 4.53.5 → 4.66.0 | Lectura/traversal de archivos en el servidor Vite y escritura arbitraria por traversal en Rollup. Vite 7.3.7 es la versión parcheada indicada por el [aviso upstream](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw); Rollup, [GHSA-mw96-cpmx-2vgc](https://github.com/advisories/GHSA-mw96-cpmx-2vgc). No se cambió de major. |
| `postcss` (build CSS) y parser | 8.5.6 → 8.5.32; 6.1.2 → 6.1.5 | XSS/lectura de sourcemaps y agotamiento CPU al analizar selectores. `@tailwindcss/typography` 0.5.20 fija parser 6.0.10; el override puntual lo lleva a 6.1.5. Sigue en la rama 6 compatible con Tailwind 3 y es el parche oficial [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf). |
| Transitivas de herramientas: `@babel/core`, `browserslist`, `brace-expansion`, `form-data`, `minimatch`, `nanoid`, `picomatch`, `source-map-js`, `yaml` | Se actualizaron dentro de los rangos compatibles del lockfile; ejemplos: 7.28.4 → 7.29.7, 4.24.2 → 4.29.5, 2.0.2 → 2.1.7, 4.0.5 → 4.0.6, 9.0.5 → 9.0.9, 3.3.11 → 3.3.20, 2.3.1 → 2.3.2, 1.2.1 → 1.2.2, 2.6.0 → 2.9.1 | Incluían lectura de archivos, DoS/ReDoS, errores de glob, y CRLF injection. `@types/node-fetch` es solo de tipos y se movió a desarrollo; `tailwindcss-animate` y `tw-animate-css` se movieron también porque solo intervienen en el build. |

`@tailwindcss/typography` mantiene un pin exacto del parser, por eso `npm audit fix` no podía resolverlo en rango. El override se limita a esa dependencia y a `6.1.5`; el changelog oficial indica que la versión es un parche de seguridad de la rama 6, sin cambios funcionales, y mantiene compatibilidad con Tailwind 3 ([release 6.1.5](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.5)).

## Pendientes de compatibilidad

| Dependencia y uso | Versión instalada | Aviso, exposición y siguiente paso |
| --- | --- | --- |
| `drizzle-orm` (directa; usada e incluida en `dist/index.cjs`) y `drizzle-zod` (directa, incluida en el bundle) | 0.39.3 / 0.7.0 | Inyección SQL por identificadores mal escapados, [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9), corregida desde Drizzle 0.45.2. Revisar si algún identificador procede de datos externos y validar la actualización del ORM/schema en una PR separada; no se considera mitigada por el uso del query builder. |
| `zod` (directa; contratos compartidos de API, cliente y servidor bundleado) | 3.25.76 | Agotamiento de memoria al validar colecciones restringidas, [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), corregido desde Zod 4.6.6. El tope de archivo/cuerpo reduce el tamaño aceptado, pero no cierra el aviso. Revisar los cambios de API e inferencia en la [guía oficial de Zod 4](https://zod.dev/v4/changelog) y probarlos en una PR separada. `drizzle-zod` también queda contado por las alertas de Drizzle/Zod. |

Se retiró `zod-validation-error` porque no tiene importaciones en el código. La inspección del grafo real de `dist/index.cjs` identificó como paquetes incorporados `connect-pg-simple`, `dotenv`, `drizzle-orm`, `drizzle-zod`, `express`, `express-session`, `passport`, `passport-local`, `pg` y `zod`; `bcryptjs` queda como runtime externo. Esto distingue paquetes instalados (`npm ls`) de los realmente empaquetados.

La versión común local/CI es Node `22.23.2`; el rango declarado `>=22.12.0 <23` satisface Vite 7 y permanece en Node 22 LTS según el [calendario oficial de Node.js](https://nodejs.org/en/about/previous-releases). Reejecuta ambas auditorías al cambiar el lockfile: los recuentos anteriores son una captura fechada.
