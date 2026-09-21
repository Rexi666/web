# Premier Planner

Web estática (GitHub Pages) + Supabase para organizar Valorant Premier: agent pool de cada jugador y composiciones por mapa.

## Permisos

| Quién | Puede |
|---|---|
| Sin login | Ver todo |
| Cuenta "Solo ver" | Ver todo (rol por defecto al registrarse) |
| Jugador | Editar **su propio** agent pool (su cuenta debe estar vinculada a un jugador) |
| Admin | Todo: pools de cualquiera, composiciones, jugadores, agentes, mapas y permisos |

Los permisos se aplican en la base de datos (RLS), no solo en la web: aunque alguien toque el JS, Supabase rechaza lo que no le corresponde.

## Instalación

### 1. Supabase
1. Crea un proyecto en supabase.com.
2. **SQL Editor → New query**, pega `supabase/schema.sql` entero y ejecútalo.
3. **Project Settings → API**: copia la *Project URL* y la *anon / publishable key* en `config.js`.

### 2. GitHub Pages
1. Sube la carpeta a un repo.
2. **Settings → Pages → Deploy from a branch → main / (root)**.
3. Tu web queda en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

### 3. Login por email
En Supabase, **Authentication → URL Configuration**:
- *Site URL*: `https://TU-USUARIO.github.io/NOMBRE-REPO/`
- *Redirect URLs*: añade esa misma URL (y `http://localhost:8000/` si pruebas en local).

El SMTP incluido en Supabase tiene un límite bajo de emails por hora; para un equipo suele bastar. Si se queda corto, configura un SMTP propio en **Authentication → Emails**.

### 4. Hazte admin
Entra en la web con tu email una vez y luego ejecuta en el SQL Editor:
```sql
update public.profiles set role = 'admin' where email = 'tu@email.com';
```
Recarga la web: aparecerá la pestaña **Admin**. Desde ahí creas jugadores, vinculas cuentas y das permisos al resto.

### 5. (Opcional) Login con Discord
1. En el Discord Developer Portal crea una aplicación → OAuth2 → añade como redirect la URL de callback que te muestra Supabase en **Authentication → Providers → Discord**.
2. Pega Client ID y Secret en Supabase y activa el provider.
3. En `config.js` pon `ENABLE_DISCORD_LOGIN = true`.

## Probar en local
Los módulos ES no funcionan abriendo el archivo directamente; usa un servidor:
```bash
python3 -m http.server 8000
```

## Estructura
```
index.html          página
styles.css          estilos
app.js              lógica (supabase-js desde CDN, sin build)
config.js           URL y key de Supabase
supabase/schema.sql tablas, RLS, funciones, agentes y mapas iniciales
```

## Cambiar el modelo de permisos
Todo está en tres funciones de `schema.sql`: `my_role()`, `is_admin()` y `can_edit_player()`. Por ejemplo, para que los jugadores puedan editar el pool de **todos** (pero no las composiciones), cambia `can_edit_player` a:
```sql
select public.my_role() in ('player', 'admin');
```
