# Fichajes

Plataforma de fichaje de entrada y salida para varias sedes, centralizada en tu propio servidor (fuera de Claude, sin depender de ninguna cuenta).

- Pantalla táctil con todos los trabajadores: se toca su foto/nombre y se pone en verde (dentro) o rojo (fuera).
- Histórico con filtros, resumen de horas del día y exportación a CSV.
- Cada pantalla "recuerda" a qué sede pertenece y etiqueta los fichajes con esa ubicación.
- Panel de administración (trabajadores y sedes) opcionalmente protegido con una contraseña compartida.
- Sin necesidad de cuenta de ningún tipo para fichar: cualquiera con el enlace puede tocar su casilla.

## Cómo funciona por dentro

Es una aplicación Node.js (Express) muy sencilla con una base de datos PostgreSQL. El navegador de cada pantalla consulta el servidor cada pocos segundos (`GET /api/state`) para mantenerse sincronizado con lo que ocurre en la otra sede, y envía `POST /api/punch` cada vez que alguien ficha. Todo vive en tu base de datos, no en la de Anthropic/Claude.

## 1. Desplegarlo (recomendado: gratis, sin tarjeta)

Vas a necesitar dos cosas gratuitas: una base de datos (Neon) y un sitio donde corra el servidor (Render).

### Paso 1 — Crear la base de datos en Neon

1. Ve a [neon.tech](https://neon.tech) y crea una cuenta gratuita.
2. Crea un proyecto nuevo (cualquier nombre, por ejemplo "fichajes").
3. En el panel del proyecto, copia la **cadena de conexión** (Connection string). Empieza por `postgresql://...`. La necesitarás en el paso 3.

> Nota: en el plan gratuito, Neon "duerme" la base de datos tras un rato sin uso y tarda un instante en despertar con la primera consulta del día. No pierdes datos, solo hay un pequeño retraso ocasional.

### Paso 2 — Subir este código a GitHub

1. Crea un repositorio nuevo en [github.com](https://github.com) (puede ser privado).
2. Sube el contenido de esta carpeta (`fichajes-server`) a ese repositorio. Si nunca has usado git, la forma más fácil es arrastrar los archivos desde la web de GitHub ("Add file" → "Upload files").

### Paso 3 — Desplegar en Render

1. Ve a [render.com](https://render.com) y crea una cuenta gratuita.
2. "New" → "Web Service" → conecta el repositorio de GitHub que acabas de crear.
3. Configuración del servicio:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. En la sección "Environment Variables", añade:
   - `DATABASE_URL` → la cadena de conexión de Neon del paso 1
   - `ADMIN_PASSWORD` → una contraseña a tu elección (para proteger la pestaña "Configuración"). Puedes dejarla vacía si no quieres proteger esa sección.
5. Pulsa "Create Web Service". En unos minutos tendrás una URL propia, por ejemplo `https://fichajes-tuempresa.onrender.com`.

Esa URL es la que abres en las pantallas de las dos sedes.

> Nota sobre el plan gratuito de Render: si nadie usa la aplicación durante 15 minutos, "se duerme" y la primera persona que la abra después esperará unos 30-60 segundos a que arranque de nuevo. El resto del día funciona con normalidad. Si esto molesta en el día a día, Render tiene un plan de pago (unos 7 USD/mes) que elimina esa espera — se cambia con un clic, sin tocar el código.

## 2. Primeros pasos tras desplegar

1. Abre la URL en cada pantalla. La primera vez te preguntará a qué sede pertenece esa pantalla — elige la que corresponda; queda guardado en ese dispositivo.
2. Ve a la pestaña **Configuración** y sustituye a los 6 trabajadores de ejemplo por tu equipo real (nombre y foto).
3. Ajusta el nombre y número de tus sedes si "Sede 1" / "Sede 2" no encajan con tu empresa.

## 3. Probarlo en tu ordenador antes de desplegar (opcional)

Si quieres verlo funcionar en tu propio ordenador primero:

```bash
npm install
cp .env.example .env
# Edita .env con los datos de tu base de datos de Neon (o una PostgreSQL local)
npm start
```

Luego abre `http://localhost:3000` en el navegador.

## Estructura del proyecto

```
fichajes-server/
  server.js       El servidor (rutas de la API)
  db.js           Conexión a PostgreSQL y datos de ejemplo iniciales
  schema.sql      Estructura de la base de datos (se crea sola al arrancar)
  public/
    index.html    Página
    styles.css    Diseño visual
    app.js        Toda la lógica de la interfaz (fichar, historial, configuración)
```

## Preguntas frecuentes

**¿Puedo usar mi propio dominio (por ejemplo fichajes.miempresa.com)?**
Sí. Tanto Render como Neon lo permiten configurar desde su panel, sin tocar el código.

**¿Y si ya tengo un servidor o hosting propio?**
También funciona: solo necesitas Node.js 18+ y una base de datos PostgreSQL accesible. Sigue el paso 3 de este documento con los datos de tu propio servidor.

**¿Qué pasa si dos personas fichan a la vez en sedes distintas?**
Sin problema — cada fichaje se guarda de forma independiente en la base de datos; no hay conflicto entre sedes.

**¿Cómo protejo el panel de "Configuración"?**
Con la variable de entorno `ADMIN_PASSWORD`. Si la defines, la primera vez que alguien intente añadir, editar o borrar algo en esa pestaña se le pedirá esa contraseña (se guarda en su navegador para las siguientes veces).
