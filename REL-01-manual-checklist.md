# REL-01: comprobación manual pendiente

REL-01 no se considera cerrado hasta completar y registrar estos recorridos en el entorno de despliegue previsto.

## Móvil

1. Abre la aplicación en un teléfono real o en el modo móvil del navegador.
2. Inicia sesión, importa un JSON pequeño, empieza un intento y responde varias preguntas.
3. Comprueba que los botones, el estado de guardado, el historial y los diálogos de renombrar/borrar se pueden usar sin contenido cortado ni controles fuera de pantalla.

## Dos sesiones de navegador

1. Inicia sesión con la cuenta A en una ventana normal y con la cuenta B en una ventana privada u otro navegador.
2. Importa un banco y crea un intento en A. Comprueba que B no ve ese banco, intento ni historial.
3. Cierra sesión de A y entra con B en esa misma ventana. Confirma que no permanecen datos de A.

## Recarga, sesión y desconexión

1. En A, responde y avanza; recarga la página y comprueba que se conservan las respuestas y la pregunta actual.
2. Cierra sesión, vuelve a entrar con A y continúa el mismo intento.
3. Desconecta la red antes de guardar. Comprueba que no aparece confirmación de guardado y que las respuestas siguen en pantalla.
4. Restablece la red, reintenta guardar y salir, y confirma en Historial que el intento quedó guardado una sola vez.

## Build y cookies de producción

1. Ejecuta `npm run build` con la configuración de producción prevista.
2. Despliega detrás del proxy HTTPS que se utilizará en producción, configurando `APP_URL` con el origen HTTPS público, `SESSION_SECRET` fuerte y único, y `TRUST_PROXY_HOPS` según los proxies reales.
3. Comprueba en las herramientas del navegador que la cookie de sesión incluye `Secure`, `HttpOnly` y `SameSite=Lax`; registra, recarga e inicia sesión y repite el flujo de guardado.
4. Confirma que HTTPS y el origen configurado permiten las escrituras protegidas por la comprobación de mismo origen.

## Registro de resultado

- Fecha, versión/commit y entorno:
- Dispositivo/navegador:
- Resultado por sección (correcto / fallo) y evidencia:
- Incidencias o seguimiento:
