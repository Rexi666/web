-- =====================================================================
--  Premier Planner — esquema de Supabase
--  Ejecuta este archivo entero en: Supabase > SQL Editor > New query
-- =====================================================================

-- ---------- Tipos ----------
create type public.app_role    as enum ('viewer', 'player', 'admin');
create type public.agent_level as enum ('none', 'bad', 'good', 'great');   -- no lo tiene / malo / bien / genial
create type public.agent_role  as enum ('duelist', 'initiator', 'controller', 'sentinel');

-- ---------- Tablas ----------

-- Una fila por cuenta de Supabase Auth (se crea sola con el trigger de abajo)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         public.app_role not null default 'viewer',
  created_at   timestamptz not null default now()
);

-- Jugadores del equipo. Pueden existir sin cuenta; user_id los vincula a una.
create table public.players (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  user_id    uuid unique references public.profiles(id) on delete set null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create table public.agents (
  id     bigint generated always as identity primary key,
  name   text not null unique,
  role   public.agent_role not null,
  active boolean not null default true
);

create table public.maps (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  in_pool boolean not null default true   -- está en el map pool actual de Premier
);

-- Nivel de cada jugador con cada agente. Si no hay fila = "sin valorar".
create table public.player_agents (
  player_id  bigint not null references public.players(id) on delete cascade,
  agent_id   bigint not null references public.agents(id)  on delete cascade,
  level      public.agent_level not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (player_id, agent_id)
);

create table public.compositions (
  id         bigint generated always as identity primary key,
  map_id     bigint not null references public.maps(id) on delete cascade,
  name       text not null default 'Comp',
  notes      text,
  is_main    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.composition_slots (
  id             bigint generated always as identity primary key,
  composition_id bigint not null references public.compositions(id) on delete cascade,
  slot           smallint not null check (slot between 1 and 5),
  player_id      bigint references public.players(id) on delete set null,
  agent_id       bigint references public.agents(id)  on delete set null,
  unique (composition_id, slot),
  unique (composition_id, player_id),   -- un jugador no se repite en la misma comp
  unique (composition_id, agent_id)     -- un agente no se repite en la misma comp
);

-- ---------- Funciones de permisos ----------

create or replace function public.my_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'viewer'::public.app_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin';
$$;

-- Admin: cualquier jugador. Player: solo el jugador vinculado a su cuenta.
create or replace function public.can_edit_player(p_player_id bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.my_role() = 'player'
          and exists (select 1 from public.players
                      where id = p_player_id and user_id = auth.uid()));
$$;

-- ---------- Alta automática de perfiles ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Guardar una composición entera de forma atómica ----------

create or replace function public.save_composition(
  p_id      bigint,
  p_map_id  bigint,
  p_name    text,
  p_notes   text,
  p_is_main boolean,
  p_slots   jsonb      -- [{ "slot": 1, "player_id": 3, "agent_id": 7 }, ...]
)
returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para editar composiciones';
  end if;

  if p_id is null then
    insert into compositions (map_id, name, notes, is_main)
    values (p_map_id, p_name, p_notes, coalesce(p_is_main, false))
    returning id into v_id;
  else
    update compositions
       set map_id = p_map_id, name = p_name, notes = p_notes,
           is_main = coalesce(p_is_main, false), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'La composición % no existe', p_id;
    end if;
  end if;

  delete from composition_slots where composition_id = v_id;

  insert into composition_slots (composition_id, slot, player_id, agent_id)
  select v_id,
         (s->>'slot')::smallint,
         (s->>'player_id')::bigint,
         (s->>'agent_id')::bigint
  from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) as s;

  return v_id;
end;
$$;

-- ---------- Row Level Security ----------

alter table public.profiles          enable row level security;
alter table public.players           enable row level security;
alter table public.agents            enable row level security;
alter table public.maps              enable row level security;
alter table public.player_agents     enable row level security;
alter table public.compositions      enable row level security;
alter table public.composition_slots enable row level security;

-- Perfiles: cada uno ve el suyo; el admin ve y edita todos (así los emails no son públicos)
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Lectura pública (también sin login) de todo lo demás
create policy players_read  on public.players           for select using (true);
create policy agents_read   on public.agents            for select using (true);
create policy maps_read     on public.maps              for select using (true);
create policy pool_read     on public.player_agents     for select using (true);
create policy comps_read    on public.compositions      for select using (true);
create policy slots_read    on public.composition_slots for select using (true);

-- Escritura solo admin
create policy players_admin on public.players           for all using (public.is_admin()) with check (public.is_admin());
create policy agents_admin  on public.agents            for all using (public.is_admin()) with check (public.is_admin());
create policy maps_admin    on public.maps              for all using (public.is_admin()) with check (public.is_admin());
create policy comps_admin   on public.compositions      for all using (public.is_admin()) with check (public.is_admin());
create policy slots_admin   on public.composition_slots for all using (public.is_admin()) with check (public.is_admin());

-- Agent pool: admin cualquiera, player solo el suyo
create policy pool_insert on public.player_agents
  for insert with check (public.can_edit_player(player_id));
create policy pool_update on public.player_agents
  for update using (public.can_edit_player(player_id)) with check (public.can_edit_player(player_id));
create policy pool_delete on public.player_agents
  for delete using (public.can_edit_player(player_id));

-- ---------- Grants (RLS decide qué filas) ----------

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.save_composition(bigint, bigint, text, text, boolean, jsonb) to authenticated;

-- ---------- Realtime (la web se actualiza sola cuando alguien edita) ----------

alter publication supabase_realtime add table
  public.players, public.agents, public.maps, public.player_agents,
  public.compositions, public.composition_slots;

-- ---------- Datos iniciales ----------
-- Revisa la lista: si Riot ha sacado agentes o mapas nuevos, añádelos desde la pestaña Admin.

insert into public.agents (name, role) values
  ('Jett','duelist'), ('Phoenix','duelist'), ('Reyna','duelist'), ('Raze','duelist'),
  ('Yoru','duelist'), ('Neon','duelist'), ('Iso','duelist'), ('Waylay','duelist'),
  ('Sova','initiator'), ('Breach','initiator'), ('Skye','initiator'), ('KAY/O','initiator'),
  ('Fade','initiator'), ('Gekko','initiator'), ('Tejo','initiator'),
  ('Brimstone','controller'), ('Omen','controller'), ('Viper','controller'),
  ('Astra','controller'), ('Harbor','controller'), ('Clove','controller'), ('Miks','controller'),
  ('Sage','sentinel'), ('Cypher','sentinel'), ('Killjoy','sentinel'), ('Chamber','sentinel'),
  ('Deadlock','sentinel'), ('Vyse','sentinel'), ('Veto','sentinel');

insert into public.maps (name) values
  ('Abyss'), ('Ascent'), ('Bind'), ('Breeze'), ('Corrode'), ('Fracture'),
  ('Haven'), ('Icebox'), ('Lotus'), ('Pearl'), ('Split'), ('Sunset'), ('Summit');

-- ---------- Tras registrarte por primera vez en la web ----------
-- Hazte admin (cambia el email):
--   update public.profiles set role = 'admin' where email = 'tu@email.com';