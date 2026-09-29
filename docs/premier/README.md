# Premier Planner

Premier Planner is a lightweight team-management platform for Valorant Premier teams. It combines a static web application, Supabase as the backend, and an optional Discord bot.

The project manages:

- Players, web accounts, permissions, and Discord links
- Agent pools and proficiency levels
- Map pool and map-specific compositions
- Composition states: Active, Draft, and Discarded
- Seasons, match-day windows, and selected play days
- Attendance polls for choosing a match date
- Premier and Ranked match history
- Per-player match statistics
- Statistics by player, agent, map, and composition
- Result screenshot uploads
- JSON backup export and restore from the Admin panel
- Discord commands, reminders, attendance notices, and match summaries

## Project structure

A typical deployment contains:

```text
premier-planner/
├── index.html
├── app.js
├── styles.css
├── config.js
├── bot.py
├── requirements.txt
├── .env
└── supabase_setup.sql
```

The web application is static and can be hosted on GitHub Pages, Cloudflare Pages, Netlify, or any standard static host.

## Requirements

### Web

- A Supabase project
- A static web host
- A modern browser

### Discord bot

- Python 3.11 or newer
- A Discord application and bot token
- A Supabase service-role key
- The dependencies listed in `requirements.txt`

Typical Python dependencies are:

```text
discord.py
python-dotenv
supabase
aiohttp
```

## Supabase installation

### 1. Create a project

Create a new Supabase project and wait until its database is available.

### 2. Run the installation script

Open:

```text
Supabase Dashboard → SQL Editor → New query
```

Paste and execute the complete contents of:

```text
supabase_setup.sql
```

The script creates:

- All application tables
- Foreign keys and constraints
- Indexes
- Row Level Security policies
- Authentication profile trigger
- Composition save function
- Attendance voting functions
- Composition-status normalization trigger
- Match-result Storage bucket and policies
- Discord notification settings tables

The script is designed for a fresh project. It is also mostly idempotent, but it should not be treated as a migration system for an existing production database.

### 3. Create the first administrator

Create the first user from:

```text
Supabase Dashboard → Authentication → Users
```

After creating the user, execute this query with the user's email:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

Do not expose the service-role key in the browser.

### 4. Configure the web application

Create `config.js` next to `app.js`:

```javascript
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
export const TEAM_NAME = 'My Premier Team';
export const ENABLE_DISCORD_LOGIN = false;
```

Only the anon key belongs in frontend code. The service-role key must remain private.

### 5. Authentication URLs

In Supabase, configure the deployed web URL under:

```text
Authentication → URL Configuration
```

Set the Site URL and any required redirect URLs for the static website.

## Optional user-management Edge Function

The Admin panel can call an Edge Function named:

```text
create-user-premier
```

This function is useful when administrators should create or update Auth users directly from the web UI. It must:

- Validate the caller's JWT
- Verify that the caller has `profiles.role = 'admin'`
- Use the Supabase service-role key only inside the function
- Create or update the Auth user
- Return a safe JSON response

Without that Edge Function, users can still be created through the Supabase Authentication dashboard and linked to a player in the Admin panel.

## Storage

The SQL installer creates a public bucket named:

```text
match-results
```

Administrators can upload result screenshots. Authenticated users can view the resulting public URLs.

The JSON backup feature stores image URLs, not the binary image files. For a complete disaster-recovery copy, back up the `match-results` bucket separately.

## Web features

### Agent pool

Each player can classify agents as:

- Great
- Good
- Normal
- Bad
- Does not have
- Unrated

### Maps and compositions

Compositions belong to a map and contain five player-agent slots.

Supported states:

- Active
- Draft
- Discarded

Only an Active composition can be the main composition for a map.

### Calendar

Calendar event types:

- Season
- Match days
- Selected play day

A match-days event can contain multiple date and time occurrences.

### Attendance

Administrators can open a poll from a match-days event. Players can vote for every option as:

- Available
- Maybe
- Unavailable

When an administrator closes the poll, the chosen option creates a selected play-day event. The Discord bot can announce both the opening and the final date.

### Statistics

Matches can be registered as:

- Premier, associated with a selected calendar event
- Ranked, associated with a manually chosen date

Recorded match data includes:

- Win, loss, or Ranked draw
- Score
- Map
- Composition
- Notes
- Result image
- Player and agent
- Performance Score
- Kills, deaths, assists
- Trades
- First Bloods
- Plants and defuses

The Statistics page supports filters for match type, season, player, map, and composition usage.

### Backups

The Admin panel can export a JSON backup and restore one later.

The application backup includes Planner tables but does not include:

- Supabase Auth users or passwords
- Storage files
- Project settings
- Database extensions
- Edge Functions

Use Supabase platform backups or `pg_dump` in addition to JSON exports for production disaster recovery.

## Discord bot configuration

Create `.env` next to `bot.py`:

```dotenv
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
TIMEZONE=Europe/Madrid
NOTIFICATION_MORNING_HOUR=09:00
```

Install dependencies and start the bot:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python bot.py
```

The service-role key is required because the bot works as a trusted backend process. Never commit `.env`.

## Main Discord commands

Depending on the installed bot version, commands include:

```text
/agentes
/composiciones
/calendario
/proximopartido
/votacion
/estadisticas
/resumen
/vincular
/setmainchannel
```

Use `/setmainchannel` inside the target server channel to configure automated announcements.

## Recommended security practices

- Keep Row Level Security enabled
- Never place the service-role key in `config.js`
- Use a separate Discord bot token per environment
- Restrict administrator accounts
- Export a JSON backup before large changes
- Enable Supabase database backups for production
- Back up Storage separately
- Test imports in a staging project before restoring production data

## Updating an existing installation

Do not rerun a fresh-install schema blindly against production. Use versioned migration files for schema changes.

A practical workflow is:

```text
supabase/
└── migrations/
    ├── 001_initial.sql
    ├── 002_attendance.sql
    ├── 003_composition_status.sql
    └── 004_statistics.sql
```

For a new installation, `supabase_setup.sql` contains the consolidated schema.

## Troubleshooting

### The web page loads but shows no data

Check:

- `config.js` URL and anon key
- Browser developer console
- Supabase RLS policies
- Authentication session
- Whether the SQL installer completed without errors

### An administrator cannot edit data

Confirm:

```sql
select id, email, role
from public.profiles
where email = 'admin@example.com';
```

The role must be `admin`.

### The bot cannot access Supabase

Check:

- `.env` is in the same directory as `bot.py`
- The service-role key is correct
- The project URL is correct
- The Python environment contains the required packages

### Result images cannot be uploaded

Confirm that:

- The `match-results` bucket exists
- The signed-in user is an administrator
- Storage policies were created
- The image is within the frontend size limit

## License

Add the license you want to use for the project, for example MIT, Apache-2.0, or a private/proprietary notice.
