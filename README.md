# Vizzio · Staff & Finance

Aplicación web (escritorio y móvil) para gestionar el personal y las finanzas de una discoteca.

## Funcionalidades

**Administrador**
- **Resumen** — ingresos, gastos, coste de personal y resultado del mes; quién está fichado ahora mismo en tiempo real; próximas noches y solicitudes pendientes.
- **Personal** — fichas de empleado con puesto, departamento, contrato y coste por hora. Horas y coste del mes por persona. Gestión del rol (admin / trabajador).
- **Fichajes** — entradas y salidas agrupadas por noche, fichajes manuales, cierre de fichajes abiertos, exportación a CSV.
- **Disponibilidad** — tabla semanal con los días que puede trabajar cada persona; desde cada casilla se asigna el turno.
- **Turnos** — planificación semanal, asignación de varias personas de una vez, coste previsto y "copiar semana anterior".
- **Noches** — sesiones y eventos con su rentabilidad (ingresos − gastos − personal).
- **Finanzas** — movimientos, cierre de caja por noche (efectivo / tarjeta por concepto), gráficos y desglose por categoría.
- **Nóminas** — devengado por empleado según fichajes, pagado y pendiente; registro de pagos.
- **Solicitudes** — aprobar o rechazar vacaciones, ausencias y cambios de turno.

**Trabajador**
- **Fichar** entrada / salida con un botón (la hora la pone el servidor, no se puede manipular).
- **Disponibilidad** semanal: qué días puede trabajar (con horario y nota opcionales).
- Mis horas e importe estimado, mis turnos, mis solicitudes y perfil.

> Una "noche" va de 06:00 a 06:00: una salida a las 05:30 del sábado cuenta para la noche del viernes.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y rellena URL + anon key de Supabase
npm run dev
```

Sin credenciales de Supabase la app arranca en **modo demo** con datos de ejemplo guardados en el navegador.

## Base de datos (Supabase)

El esquema está en `supabase/migrations/`. El proyecto de Supabase está enlazado con este repositorio mediante la integración de GitHub, así que **cada push a `main` aplica las migraciones nuevas automáticamente**. Para cambios en el esquema, añade un nuevo archivo `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql` (nunca edites uno ya aplicado).

### Alta de usuarios
1. **El primer usuario que se registra es administrador.**
2. El administrador da de alta a cada empleado en *Personal* con su email.
3. El empleado se registra en `/registro` con ese mismo email y queda vinculado a su ficha automáticamente.
4. Cualquier otra persona puede registrarse también: se le crea una ficha de **Camarero/a** con tarifa 0 €/h (en Personal aparece como "falta tarifa" para que el administrador la complete).

### Seguridad
Todas las tablas usan Row Level Security: el trabajador solo puede leer sus propios fichajes, turnos y solicitudes; las finanzas solo son visibles para administradores. El fichaje se hace mediante las funciones `clock_in()` / `clock_out()` con la hora del servidor.

## Despliegue

Compatible con Vercel o Netlify (ya incluye las reglas de rutas SPA). Configura las variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_APP_NAME`, y añade la URL de producción en Supabase → Authentication → URL Configuration.
