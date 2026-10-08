# Vizzio · Staff & Finance

Aplicación web (escritorio y móvil) para gestionar el personal y las finanzas de una discoteca.

## Funcionalidades

**Administrador**
- **Resumen** — ingresos, gastos, coste de personal y resultado del mes; quién está fichado ahora mismo en tiempo real; próximas noches y solicitudes pendientes.
- **Personal** — fichas de empleado con puesto, departamento, contrato y coste por hora. Horas y coste por persona de la semana, el mes o el año (camareros y DJ / técnicos). Gestión del rol (admin / trabajador).
- **Fichajes** — entradas y salidas agrupadas por noche, fichajes manuales, cierre de fichajes abiertos, exportación a CSV.
- **Disponibilidad** — tabla semanal con los días que puede trabajar cada persona; desde cada casilla se asigna el turno.
- **Turnos** — planificación semanal, asignación de varias personas de una vez, coste previsto y "copiar semana anterior". Se ve quién ha aceptado (✓), rechazado (✗) o no ha respondido cada turno.
- **Noches** — sesiones y eventos con su rentabilidad (ingresos − gastos − personal).
- **Finanzas** — movimientos, cierre de caja por noche (efectivo / tarjeta por concepto), gráficos y desglose por categoría.
- **Facturas** — archivo de facturas recibidas y emitidas (PDF o foto) con importe, IVA, estado de pago y vencimiento; se guardan en un almacenamiento privado de Supabase.
- **Proveedores** (en Facturas) — cada proveedor tiene su apartado con sus facturas, total y pendiente de pago, y su ficha (CIF, contacto, categoría habitual).
- **Fourvenues** (en Ajustes) — trae las noches, sus entradas vendidas, los QR gratis de las listas, los reservados y lo vendido por cada RRPP para sus comisiones (no apunta ingresos en Finanzas). Ver más abajo.
- **Conector de Claude** (en Ajustes) — pásale a Claude extractos, tickets o facturas y los registra en Finanzas y Facturas, creando los proveedores que falten. Ver más abajo.
- **Nóminas** — devengado por empleado según fichajes, pagado y pendiente; registro de pagos.
- **Solicitudes** — aprobar o rechazar vacaciones, ausencias y cambios de turno.
- **Mensajes** — avisos y tareas para una persona, un grupo (camareros, DJ / técnicos, RRPP) o todo el equipo; se ve quién los ha leído y quién acepta o rechaza cada tarea, y se contesta a sus respuestas (conversación privada con cada persona).

**Trabajador**
- **Fichar** entrada / salida con un botón (la hora la pone el servidor, no se puede manipular).
- **Disponibilidad** semanal: qué días puede trabajar (con horario y nota opcionales).
- **Mis turnos**: aceptar ("Asistiré") o rechazar ("No puedo", con motivo opcional) cada turno hasta que empieza.
- **Mensajes**: los avisos y tareas del responsable; las tareas se aceptan o se rechazan (con motivo opcional) y puede responder a cualquiera de ellos.
- **Notificaciones al móvil** (Perfil → Avisos) cuando le asignan, cambian o cancelan un turno y cuando le llega un mensaje o una tarea.
- Mis horas y lo ganado por semana, mes o año (sin ver su tarifa €/h), mis turnos, mis solicitudes y perfil.

> Una "noche" va de 06:00 a 06:00: una salida a las 05:30 del sábado cuenta para la noche del viernes.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y rellena URL + anon key de Supabase
npm run dev
```

Sin credenciales de Supabase la app arranca en **modo demo** con datos de ejemplo guardados en el navegador.

## Base de datos (Supabase)

El esquema está en `supabase/migrations/`. **Cada push a `main` aplica las migraciones nuevas automáticamente** con la acción de GitHub *Aplicar migraciones de Supabase* (`.github/workflows/apply-migrations.yml`, con los secretos `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PROJECT_REF`). Para cambios en el esquema, añade un nuevo archivo `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql` (nunca edites uno ya aplicado ni lo ejecutes a mano en el editor SQL).

### Alta de usuarios
1. **El primer usuario que se registra es administrador.**
2. El administrador da de alta a cada empleado en *Personal* con su email.
3. El empleado se registra en `/registro` con ese mismo email y queda vinculado a su ficha automáticamente.
4. Cualquier otra persona puede registrarse también: se le crea una ficha de **Camarero/a** con tarifa 0 €/h (en Personal aparece como "falta tarifa" para que el administrador la complete).

### Enlaces de los correos (cambiar la contraseña, confirmar la cuenta)
Llevan a la *Site URL* de Supabase. La acción *Configurar enlaces de los correos de Supabase* (`.github/workflows/supabase-auth-urls.yml`) la pone en `https://ficherovizzio.vercel.app` y añade la app a las *Redirect URLs*. Si la app cambia de dirección, crea la variable del repositorio `APP_URL` con la nueva y lanza la acción a mano marcando "aplicar".

### Seguridad
Todas las tablas usan Row Level Security: el trabajador solo puede leer sus propios fichajes, turnos y solicitudes; las finanzas solo son visibles para administradores. El fichaje se hace mediante las funciones `clock_in()` / `clock_out()` con la hora del servidor.

## Notificaciones al móvil

Avisan al trabajador cuando le asignan, cambian o cancelan un turno futuro y cuando le llega un mensaje, una tarea o una respuesta; y a los administradores cuando un trabajador responde (se activan en *Ajustes*).

- **Cómo funciona:** la base de datos apunta cada aviso en `notifications` (triggers sobre `shifts` y `message_recipients`). Tras cada cambio, la app del administrador llama a la función `supabase/functions/notify`, que los envía (Web Push estándar, sin servicios externos) a los dispositivos de cada trabajador (`push_subscriptions`). Si alguien tiene varios avisos a la vez, recibe uno con el resumen.
- **Claves:** la función genera las claves VAPID la primera vez y las guarda en `push_keys` (sólo ella puede leerlas). No hay que configurar nada.
- **Publicación:** la acción *Publicar funciones de Supabase* despliega `notify` (sin verificación JWT de la pasarela: la sesión se comprueba dentro) al cambiar `supabase/functions/` en `main`.
- **Activarlas:** cada trabajador, en *Perfil → Avisos → Activar notificaciones* (o en el aviso que sale arriba) y puede enviarse un aviso de prueba. En **iPhone** sólo funcionan con la app añadida a la pantalla de inicio (Safari → Compartir → «Añadir a pantalla de inicio», iOS 16.4 o posterior); en Android, desde Chrome.

## Conector de Claude (MCP)

La función `supabase/functions/rapid-responder` es un servidor MCP: Claude la usa como conector para registrar ingresos y gastos en **Finanzas**, subir facturas (PDF o foto) a **Facturas** y crear o actualizar **proveedores**.

**Herramientas:** `ver_categorias`, `registrar_movimientos` (hasta 500 por llamada; omite duplicados), `listar_movimientos`, `eliminar_movimientos`, `buscar_proveedores`, `crear_proveedor`, `actualizar_proveedor`, `preparar_subida_factura`, `registrar_factura`, `listar_facturas`, `eliminar_factura`, `listar_personal`, `ver_fichajes_noche` y `corregir_fichajes`.

### Instalación (una vez)
1. Aplica las migraciones `20261006130000_suppliers.sql` y `20261006140000_claude_connector.sql` (se aplican solas al hacer push a `main`).
2. Publica la función **sin verificación JWT** (Claude no envía el token de Supabase; el acceso lo controla el enlace secreto). Lo hace sola la acción de GitHub *Publicar funciones de Supabase* cada vez que cambia `supabase/functions/` en `main`, si el repositorio tiene estos secretos (*GitHub → Settings → Secrets and variables → Actions*):
   - `SUPABASE_ACCESS_TOKEN`: un token de *Supabase → Account → Access Tokens*.
   - `SUPABASE_PROJECT_REF`: el identificador del proyecto (lo que va antes de `.supabase.co` en su URL).

   A mano: `supabase functions deploy rapid-responder --no-verify-jwt --project-ref <ref>`, o pegando el archivo en el editor del panel y desactivando *Verify JWT*.
3. En la app: *Ajustes → Conector de Claude → Conectar con Claude* genera el enlace (`https://<proyecto>.supabase.co/functions/v1/rapid-responder/<código>`). Se muestra una sola vez; en la base de datos solo se guarda su hash.
4. En Claude: *Ajustes → Conectores → Añadir conector personalizado*, pega el enlace y actívalo en el chat.

**Comprobar el enlace:** ábrelo en el navegador. Si todo está bien, verás "✅ Conector de Vizzio listo"; si no, la página dice qué falla. Si en lugar de esa página aparece un error 401 (`Missing authorization header` / `Invalid JWT`), la función todavía tiene la verificación JWT activada.

Cada enlace actúa en nombre del administrador que lo generó (deja de funcionar si deja de serlo) y se puede desactivar en cualquier momento desde Ajustes.

### Uso
Adjunta el archivo en el chat y pide, p. ej., *"carga estos gastos en Finanzas"* o *"sube estas facturas"*. Claude lee el archivo, te enseña un resumen y lo registra. Para las facturas busca el proveedor (por nombre o CIF) y, si no existe, lo crea.

**Hoja de firmas:** pásale el PDF o la foto y pide que revise las horas. Claude empareja cada nombre con su ficha, compara con los fichajes de esa noche (de 06:00 a 06:00, hora española), te enseña las diferencias y corrige las que estén mal (por defecto da por buenas las de 10 minutos o menos). Si alguien de la hoja no está en la app, no se registra en ningún sitio. Cada fichaje corregido guarda en sus notas la hora que tenía antes.

Para subir el **archivo** de la factura, Claude necesita poder ejecutar comandos: lo sube con `curl` al enlace que le da `preparar_subida_factura`. En claude.ai eso requiere tener activada la ejecución de código y permitir salida de red al dominio `*.supabase.co` (*Ajustes → Funciones/Capacidades*); en Claude Code o en la app de escritorio con acceso a tus archivos funciona directamente. Si no puede, guarda la factura sin archivo (aparece como "sin archivo" y se adjunta desde la app).

## Fourvenues (venta de entradas)

La función `supabase/functions/fourvenues-sync` trae de Fourvenues (Integrations API) las noches de la última semana y de los próximos dos meses:

- **Noches** — cada evento de Fourvenues crea su noche (tipo *Sesión*). Si ese día ya había una noche creada a mano, se asocia a ella en lugar de duplicarla. En *Noches* se ve, por noche, las **entradas vendidas** (de pago, por cualquier canal), los **QR gratis** (personas apuntadas en las listas de Fourvenues, sin las canceladas) y los **reservados** (reservas de mesa de Fourvenues, sin las canceladas). El detalle de la noche sólo enseña datos de Fourvenues (también cuántos han entrado ya); el personal y los gastos están en *Fichajes* y *Finanzas*.
- **Por RRPP** — al abrir una noche sincronizada se ve, por cada RRPP con el nombre que tiene en Fourvenues, sus **entradas** (de pago), sus **listas** (QR gratis) y sus **reservados** (de Fourvenues). Lo que no lleva RRPP sale como *Sin RRPP*; un RRPP que no está asociado a una ficha sale igual, con el aviso *Sin asociar a una ficha*. El botón *Sincronizar con Fourvenues* de la noche la vuelve a traer (aunque tenga más de una semana) y enseña cualquier aviso o error.
- **Sin ingresos** — la sincronización **no apunta nada en Finanzas**: la venta de entradas la mete el administrador a mano (p. ej. en *Entradas online* o en el cierre de caja).
- **Comisiones RRPP** — las entradas vendidas con el enlace de cada RRPP rellenan sus *Entradas* de esa noche (cantidad y precio medio), y la comisión se calcula con los % que ya hay configurados. Las personas de lista siguen siendo a mano.

Todo lo importado lleva el id de Fourvenues: sincronizar varias veces no duplica nada.

### Puesta en marcha (una vez)
1. Aplica la migración `20261008160000_fourvenues.sql` (se aplica sola al hacer push a `main`).
2. Guarda la clave en *Supabase → Edge Functions → Secrets*: `FOURVENUES_API_KEY`. Si es una clave de pruebas, añade `FOURVENUES_ENV` = `alpha` (por defecto se usa producción). La clave nunca llega al navegador.
3. La acción *Publicar funciones de Supabase* publica `fourvenues-sync` (sin verificación JWT de la pasarela: dentro se comprueba que quien llama es administrador). A mano: `supabase functions deploy fourvenues-sync --no-verify-jwt`.
4. En la app: *Ajustes → Fourvenues → Sincronizar ahora*. Para traer noches más antiguas (hasta 180 días): *Traer noches anteriores*.
5. *Asociar RRPP*: cada usuario de Fourvenues que vende entradas se asocia a su ficha. Si el email de Fourvenues coincide con el de su ficha, se asocia solo. Mientras un RRPP no esté asociado, sus ventas no cuentan en sus comisiones (Ajustes avisa).

Después se sincroniza sola al abrir *Noches* (como mucho cada 10 minutos). La clave necesita acceso a los eventos, las entradas, las listas, las reservas y los usuarios de Fourvenues (si las listas o las reservas fallan, la sincronización sigue con el resto, esas columnas salen como "—" y se avisa).

## Despliegue

Compatible con Vercel o Netlify (ya incluye las reglas de rutas SPA). Configura las variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_APP_NAME`, y añade la URL de producción en Supabase → Authentication → URL Configuration.
