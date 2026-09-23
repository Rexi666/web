from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import discord
from discord import app_commands
from discord.ext import commands, tasks
from dotenv import load_dotenv
from supabase import Client, create_client

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DISCORD_TOKEN = os.environ["DISCORD_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TIMEZONE = ZoneInfo(os.getenv("TIMEZONE", "Europe/Madrid"))
MORNING_TIME_RAW = os.getenv("NOTIFICATION_MORNING_HOUR", "09:00").strip()
try:
    if ":" in MORNING_TIME_RAW:
        MORNING_HOUR, MORNING_MINUTE = map(int, MORNING_TIME_RAW.split(":", 1))
    else:
        MORNING_HOUR = int(MORNING_TIME_RAW)
        MORNING_MINUTE = 0
except ValueError as exc:
    raise ValueError(
        "NOTIFICATION_MORNING_HOUR debe tener formato 9 o 09:00"
    ) from exc

if not 0 <= MORNING_HOUR <= 23 or not 0 <= MORNING_MINUTE <= 59:
    raise ValueError("NOTIFICATION_MORNING_HOUR contiene una hora no válida")
OWNER_USER_ID = 621725560866996244

LEVEL_ORDER = ["great", "good", "normal", "bad", "none", None]
LEVEL_INFO = {
    "great": ("Genial", "⭐"),
    "good": ("Bien", "✅"),
    "normal": ("Normal", "🟡"),
    "bad": ("Malo", "⚠️"),
    "none": ("No lo tiene", "❌"),
    None: ("Sin valorar", "▫️"),
}
EVENT_INFO = {
    "season": ("Temporada", "🟣"),
    "match_days": ("Días de partido", "🔵"),
    "play_day": ("Día elegido", "🟢"),
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
log = logging.getLogger("premier-bot")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def rows(response: Any) -> list[dict[str, Any]]:
    return list(response.data or [])


async def db(callable_, *args, **kwargs):
    """Ejecuta el cliente síncrono de Supabase sin bloquear Discord."""
    return await asyncio.to_thread(callable_, *args, **kwargs)


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def format_date(value: str | date | None) -> str:
    if value is None:
        return "Sin fecha"
    parsed = value if isinstance(value, date) else parse_iso_date(value)
    if not parsed:
        return str(value)
    months = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ]
    return f"{parsed.day} de {months[parsed.month - 1]} de {parsed.year}"

def format_date_with_weekday(value: str | date | None) -> str:
    if value is None:
        return "Sin fecha"

    parsed = (
        value
        if isinstance(value, date)
        else parse_iso_date(value)
    )

    if not parsed:
        return str(value)

    weekdays = [
        "Lunes",
        "Martes",
        "Miércoles",
        "Jueves",
        "Viernes",
        "Sábado",
        "Domingo",
    ]

    months = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ]

    weekday = weekdays[parsed.weekday()]
    month = months[parsed.month - 1]

    return (
        f"{weekday} {parsed.day} "
        f"de {month} de {parsed.year}"
    )


def trim(text: str, limit: int = 1024) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def send_embeds(interaction: discord.Interaction, embeds: list[discord.Embed]) -> None:
    if not embeds:
        await interaction.followup.send("No hay información disponible.")
        return
    for start in range(0, len(embeds), 10):
        await interaction.followup.send(embeds=embeds[start : start + 10])


async def player_choices(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    result = await db(
        lambda: supabase.table("players").select("id,name").order("name").execute()
    )
    current_lower = current.casefold()
    return [
        app_commands.Choice(name=p["name"][:100], value=str(p["id"]))
        for p in rows(result)
        if current_lower in p["name"].casefold()
    ][:25]


async def map_choices(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    result = await db(
        lambda: supabase.table("maps")
        .select("id,name")
        .eq("in_pool", True)
        .order("name")
        .execute()
    )
    current_lower = current.casefold()
    return [
        app_commands.Choice(name=m["name"][:100], value=str(m["id"]))
        for m in rows(result)
        if current_lower in m["name"].casefold()
    ][:25]


async def composition_choices(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    """Sugiere composiciones pertenecientes al mapa elegido."""
    map_value = getattr(interaction.namespace, "mapa", None)
    if not map_value:
        return []

    try:
        map_id = int(map_value)
    except (TypeError, ValueError):
        return []

    result = await db(
        lambda: supabase.table("compositions")
        .select("id,name,is_main")
        .eq("map_id", map_id)
        .order("is_main", desc=True)
        .order("name")
        .execute()
    )
    current_lower = current.casefold()
    return [
        app_commands.Choice(
            name=(f"⭐ {comp['name']}" if comp.get("is_main") else comp["name"])[:100],
            value=str(comp["id"]),
        )
        for comp in rows(result)
        if current_lower in comp["name"].casefold()
    ][:25]


class PremierBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(
            command_prefix=commands.when_mentioned,
            intents=intents,
            allowed_installs=app_commands.AppInstallationType(guild=True, user=True),
            allowed_contexts=app_commands.AppCommandContext(
                guild=True, dm_channel=True, private_channel=True
            ),
        )

    async def setup_hook(self) -> None:
        await self.tree.sync()
        if not notification_worker.is_running():
            notification_worker.start()

    async def on_ready(self) -> None:
        log.info("Conectado como %s (%s)", self.user, self.user.id if self.user else "?")


bot = PremierBot()


@bot.tree.command(name="agentes", description="Muestra los agentes de un jugador ordenados por nivel")
@app_commands.describe(
    jugador="Jugador del agent pool",
    tipo="Nivel que quieres mostrar (opcional)",
)
@app_commands.choices(
    tipo=[
        app_commands.Choice(name="Genial", value="great"),
        app_commands.Choice(name="Bien", value="good"),
        app_commands.Choice(name="Normal", value="normal"),
        app_commands.Choice(name="Malo", value="bad"),
        app_commands.Choice(name="No lo tiene", value="none"),
        app_commands.Choice(name="Sin valorar", value="unrated"),
    ]
)
@app_commands.autocomplete(jugador=player_choices)
async def agentes(
    interaction: discord.Interaction,
    jugador: str,
    tipo: app_commands.Choice[str] | None = None,
) -> None:
    await interaction.response.defer(thinking=True)
    try:
        player_id = int(jugador)
    except ValueError:
        await interaction.followup.send("Selecciona un jugador de las sugerencias.", ephemeral=True)
        return

    player_result, agents_result, levels_result = await asyncio.gather(
        db(lambda: supabase.table("players").select("id,name").eq("id", player_id).maybe_single().execute()),
        db(lambda: supabase.table("agents").select("id,name,role,active").eq("active", True).order("name").execute()),
        db(lambda: supabase.table("player_agents").select("agent_id,level").eq("player_id", player_id).execute()),
    )
    player = player_result.data
    if not player:
        await interaction.followup.send("Ese jugador ya no existe.", ephemeral=True)
        return

    level_by_agent = {item["agent_id"]: item["level"] for item in rows(levels_result)}
    grouped: dict[str | None, list[str]] = {level: [] for level in LEVEL_ORDER}
    for agent in rows(agents_result):
        grouped[level_by_agent.get(agent["id"])].append(agent["name"])

    selected_level: str | None | object = object()
    if tipo is not None:
        selected_level = None if tipo.value == "unrated" else tipo.value

    levels_to_show = (
        LEVEL_ORDER
        if tipo is None
        else [selected_level]
    )

    title = f"Agentes de {player['name']}"
    if tipo is not None:
        title += f" · {tipo.name}"

    embed = discord.Embed(title=title, color=discord.Color.gold())
    fields_added = 0
    for level in levels_to_show:
        names = grouped.get(level, [])
        if names:
            label, icon = LEVEL_INFO[level]
            embed.add_field(
                name=f"{icon} {label}",
                value=trim(", ".join(names)),
                inline=False,
            )
            fields_added += 1

    if fields_added == 0:
        embed.description = (
            f"{player['name']} no tiene agentes clasificados como **{tipo.name}**."
        )

    embed.set_footer(text="Datos del agent pool de Premier Planner")
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="composiciones", description="Muestra las composiciones guardadas de un mapa")
@app_commands.describe(
    mapa="Mapa del map pool",
    composicion="Composición específica que quieres mostrar (opcional)",
)
@app_commands.autocomplete(
    mapa=map_choices,
    composicion=composition_choices,
)
async def composiciones(
    interaction: discord.Interaction,
    mapa: str,
    composicion: str | None = None,
) -> None:
    await interaction.response.defer(thinking=True)
    try:
        map_id = int(mapa)
    except ValueError:
        await interaction.followup.send("Selecciona un mapa de las sugerencias.", ephemeral=True)
        return

    map_result = await db(
        lambda: supabase.table("maps").select("id,name,in_pool").eq("id", map_id).maybe_single().execute()
    )
    map_data = map_result.data
    if not map_data or not map_data.get("in_pool"):
        await interaction.followup.send("Ese mapa no está en el map pool.", ephemeral=True)
        return

    comps_result = await db(
        lambda: supabase.table("compositions")
        .select("id,name,notes,is_main")
        .eq("map_id", map_id)
        .order("is_main", desc=True)
        .order("created_at")
        .execute()
    )
    comps = rows(comps_result)
    if not comps:
        await interaction.followup.send(f"No hay composiciones para **{map_data['name']}**.")
        return

    if composicion is not None:
        try:
            composition_id = int(composicion)
        except ValueError:
            await interaction.followup.send(
                "Selecciona una composición de las sugerencias.",
                ephemeral=True,
            )
            return

        comps = [comp for comp in comps if comp["id"] == composition_id]
        if not comps:
            await interaction.followup.send(
                "Esa composición no pertenece al mapa seleccionado o ya no existe.",
                ephemeral=True,
            )
            return

    comp_ids = [c["id"] for c in comps]
    slots_result, players_result, agents_result = await asyncio.gather(
        db(lambda: supabase.table("composition_slots").select("composition_id,slot,player_id,agent_id").in_("composition_id", comp_ids).order("slot").execute()),
        db(lambda: supabase.table("players").select("id,name").execute()),
        db(lambda: supabase.table("agents").select("id,name").execute()),
    )
    players = {p["id"]: p["name"] for p in rows(players_result)}
    agents_by_id = {a["id"]: a["name"] for a in rows(agents_result)}
    slots = rows(slots_result)

    embeds: list[discord.Embed] = []
    for comp in comps:
        title = f"{'⭐ ' if comp['is_main'] else ''}{comp['name']}"
        embed = discord.Embed(title=title, color=discord.Color.gold() if comp["is_main"] else discord.Color.blurple())
        comp_slots = sorted(
            (s for s in slots if s["composition_id"] == comp["id"]),
            key=lambda s: s["slot"],
        )
        lines = []
        for slot in comp_slots:
            agent_name = agents_by_id.get(slot.get("agent_id"), "Sin agente")
            player_name = players.get(slot.get("player_id"), "Sin jugador")
            lines.append(f"**{slot['slot']}. {agent_name}** · {player_name}")
        embed.description = "\n".join(lines) or "Composición sin asignaciones."
        if comp.get("notes"):
            embed.add_field(name="Notas", value=trim(comp["notes"]), inline=False)
        embed.set_footer(text=f"Mapa: {map_data['name']}")
        embeds.append(embed)
    await send_embeds(interaction, embeds)


@bot.tree.command(
    name="calendario",
    description="Muestra el calendario completo de la temporada actual o próxima",
)
async def calendario(interaction: discord.Interaction) -> None:
    await interaction.response.defer(thinking=True)

    today = datetime.now(TIMEZONE).date()

    events_result, maps_result = await asyncio.gather(
        db(
            lambda: supabase.table("calendar_events")
            .select("*")
            .execute()
        ),
        db(
            lambda: supabase.table("maps")
            .select("id,name,in_pool")
            .order("name")
            .execute()
        ),
    )

    events = rows(events_result)

    maps = {
        map_data["id"]: map_data
        for map_data in rows(maps_result)
    }

    # ---------------------------------------------------------
    # Buscar la temporada actual o, si no existe, la próxima
    # ---------------------------------------------------------

    seasons: list[
        tuple[date, date, dict[str, Any]]
    ] = []

    for event in events:
        if event.get("type") != "season":
            continue

        start_date = parse_iso_date(
            event.get("start_date")
        )
        end_date = parse_iso_date(
            event.get("end_date")
        )

        if start_date and end_date:
            seasons.append(
                (
                    start_date,
                    end_date,
                    event,
                )
            )

    current_seasons = [
        season
        for season in seasons
        if season[0] <= today <= season[1]
    ]

    if current_seasons:
        # Si hubiera más de una temporada activa,
        # usamos la que comenzó más recientemente.
        (
            season_start,
            season_end,
            season_event,
        ) = max(
            current_seasons,
            key=lambda item: item[0],
        )

        season_status = "Temporada actual"

    else:
        future_seasons = [
            season
            for season in seasons
            if season[0] > today
        ]

        if not future_seasons:
            await interaction.followup.send(
                "No hay una temporada en progreso ni "
                "una próxima temporada configurada."
            )
            return

        (
            season_start,
            season_end,
            season_event,
        ) = min(
            future_seasons,
            key=lambda item: item[0],
        )

        season_status = "Próxima temporada"

    # ---------------------------------------------------------
    # Días disponibles de partido agrupados por mapa
    # ---------------------------------------------------------

    match_days_by_map: dict[
        int | None,
        list[tuple[date, str | None, str]],
    ] = {}

    for event in events:
        if event.get("type") != "match_days":
            continue

        map_id = event.get("map_id")

        for occurrence in event.get(
            "occurrences"
        ) or []:
            occurrence_date = parse_iso_date(
                occurrence.get("date")
            )

            if not occurrence_date:
                continue

            # Solo incluimos fechas dentro de la temporada.
            if not (
                season_start <= occurrence_date <= season_end
                and occurrence_date >= today
            ):
                continue

            occurrence_time = (
                str(occurrence.get("time"))[:5]
                if occurrence.get("time")
                else None
            )

            match_days_by_map.setdefault(
                map_id,
                [],
            ).append(
                (
                    occurrence_date,
                    occurrence_time,
                    event.get("title")
                    or "Día de partido",
                )
            )

    # ---------------------------------------------------------
    # Días elegidos para jugar agrupados por mapa
    # ---------------------------------------------------------

    selected_days_by_map: dict[
        int | None,
        list[tuple[date, str | None, str]],
    ] = {}

    for event in events:
        if event.get("type") != "play_day":
            continue

        selected_date = parse_iso_date(
            event.get("start_date")
        )

        if not selected_date:
            continue

        if not (
            season_start <= selected_date <= season_end
            and selected_date >= today
        ):
            continue

        map_id = event.get("map_id")

        selected_time = (
            str(event.get("event_time"))[:5]
            if event.get("event_time")
            else None
        )

        selected_days_by_map.setdefault(
            map_id,
            [],
        ).append(
            (
                selected_date,
                selected_time,
                event.get("title")
                or "Día elegido",
            )
        )

    # Obtenemos todos los mapas que tienen algún evento.
    all_map_ids = (
        set(match_days_by_map)
        | set(selected_days_by_map)
    )

    def map_sort_key(
        map_id: int | None,
    ) -> tuple[date, str, str]:
        """
        Ordena los mapas por la fecha y hora de su próximo evento.

        Si dos mapas tienen su próximo evento a la misma hora,
        se ordenan alfabéticamente.
        """
        map_data = (
            maps.get(map_id)
            if map_id is not None
            else None
        )

        map_name = (
            map_data.get("name")
            if map_data
            else "Sin mapa"
        )

        map_events: list[tuple[date, str]] = []

        # Días disponibles de partido.
        for (
            match_date,
            match_time,
            _title,
        ) in match_days_by_map.get(
            map_id,
            [],
        ):
            map_events.append(
                (
                    match_date,
                    match_time or "23:59",
                )
            )

        # Días elegidos para jugar.
        for (
            selected_date,
            selected_time,
            _title,
        ) in selected_days_by_map.get(
            map_id,
            [],
        ):
            map_events.append(
                (
                    selected_date,
                    selected_time or "23:59",
                )
            )

        next_event_date, next_event_time = (
            min(map_events)
            if map_events
            else (date.max, "23:59")
        )

        return (
            next_event_date,
            next_event_time,
            map_name.casefold(),
        )

    # ---------------------------------------------------------
    # Embed principal de la temporada
    # ---------------------------------------------------------

    season_embed = discord.Embed(
        title=f"🟣 {season_event['title']}",
        description=(
            f"**{season_status}**\n"
            f"{format_date(season_start)}"
            f" → "
            f"{format_date(season_end)}"
        ),
        color=discord.Color.purple(),
    )

    if season_event.get("notes"):
        season_embed.add_field(
            name="Notas de la temporada",
            value=trim(
                season_event["notes"]
            ),
            inline=False,
        )

    embeds: list[discord.Embed] = [
        season_embed
    ]

    if not all_map_ids:
        season_embed.add_field(
            name="Partidos",
            value=(
                "Todavía no hay días de partido "
                "configurados para esta temporada."
            ),
            inline=False,
        )

        await interaction.followup.send(
            embed=season_embed
        )
        return

    # ---------------------------------------------------------
    # Un embed independiente para cada mapa
    # ---------------------------------------------------------

    for map_id in sorted(
        all_map_ids,
        key=map_sort_key,
    ):
        map_data = (
            maps.get(map_id)
            if map_id is not None
            else None
        )

        map_name = (
            map_data["name"]
            if map_data
            else "Sin mapa"
        )

        map_embed = discord.Embed(
            title=f"🗺️ {map_name}",
            color=discord.Color.blurple(),
        )

        match_days = sorted(
            match_days_by_map.get(
                map_id,
                [],
            ),
            key=lambda item: (
                item[0],
                item[1] or "",
            ),
        )

        selected_days = sorted(
            selected_days_by_map.get(
                map_id,
                [],
            ),
            key=lambda item: (
                item[0],
                item[1] or "",
            ),
        )

        # ---------------------------------------------
        # Días disponibles del mapa
        # ---------------------------------------------

        if match_days:
            available_lines: list[str] = []

            for (
                match_date,
                match_time,
                _event_title,
            ) in match_days:
                line = (
                    f"• {format_date_with_weekday(match_date)}"
                )

                if match_time:
                    line += (
                        f" · **{match_time}**"
                    )

                available_lines.append(line)

            map_embed.add_field(
                name="🔵 Días de partido",
                value=trim(
                    "\n".join(
                        available_lines
                    )
                ),
                inline=False,
            )

        else:
            map_embed.add_field(
                name="🔵 Días de partido",
                value=(
                    "No hay días disponibles "
                    "configurados."
                ),
                inline=False,
            )

        # ---------------------------------------------
        # Día elegido para jugar
        # ---------------------------------------------

        if selected_days:
            selected_lines: list[str] = []

            for (
                selected_date,
                selected_time,
                selected_title,
            ) in selected_days:
                line = (
                    "✅ "
                    f"**{format_date_with_weekday(selected_date)}**"
                )

                if selected_time:
                    line += (
                        f" · **{selected_time}**"
                    )

                if selected_title:
                    line += (
                        f"\n{selected_title}"
                    )

                selected_lines.append(line)

            map_embed.add_field(
                name="🟢 Día elegido para jugar",
                value=trim(
                    "\n\n".join(
                        selected_lines
                    )
                ),
                inline=False,
            )

        embeds.append(map_embed)

    await send_embeds(
        interaction,
        embeds,
    )


@bot.tree.command(name="setmainchannel", description="Configura este canal para avisos de partidos")
@app_commands.guild_only()
async def setmainchannel(interaction: discord.Interaction) -> None:
    if interaction.user.id != OWNER_USER_ID:
        await interaction.response.send_message("No tienes permiso para configurar el canal.", ephemeral=True)
        return
    if interaction.guild_id is None or interaction.channel_id is None:
        await interaction.response.send_message("Usa este comando dentro de un canal de servidor.", ephemeral=True)
        return

    payload = {
        "guild_id": interaction.guild_id,
        "main_channel_id": interaction.channel_id,
        "configured_by": interaction.user.id,
        "updated_at": datetime.now(TIMEZONE).isoformat(),
    }
    result = await db(
        lambda: supabase.table("discord_bot_settings").upsert(payload, on_conflict="guild_id").execute()
    )
    if not result.data:
        await interaction.response.send_message("No se pudo guardar la configuración.", ephemeral=True)
        return
    await interaction.response.send_message(
        f"Canal principal configurado: <#{interaction.channel_id}>", ephemeral=True
    )


async def claim_notification(event_id: int, notification_type: str) -> bool:
    try:
        result = await db(
            lambda: supabase.table("discord_notifications_sent")
            .insert({"event_id": event_id, "notification_type": notification_type})
            .execute()
        )
        return bool(result.data)
    except Exception as exc:
        message = str(exc).lower()
        if "duplicate" in message or "23505" in message:
            return False
        raise


async def release_notification(event_id: int, notification_type: str) -> None:
    await db(
        lambda: supabase.table("discord_notifications_sent")
        .delete()
        .eq("event_id", event_id)
        .eq("notification_type", notification_type)
        .execute()
    )


async def send_play_day_notification(event: dict[str, Any], notification_type: str) -> None:
    settings_result, map_result = await asyncio.gather(
        db(lambda: supabase.table("discord_bot_settings").select("guild_id,main_channel_id").execute()),
        db(lambda: supabase.table("maps").select("id,name").eq("id", event["map_id"]).maybe_single().execute()) if event.get("map_id") else asyncio.sleep(0, result=None),
    )
    settings = rows(settings_result)
    map_data = map_result.data if map_result else None
    event_time = str(event.get("event_time") or "")[:5]

    title = "📅 Partido dentro de 3 días" if notification_type == "three_days" else "🎮 Hoy jugamos"
    embed = discord.Embed(title=title, color=discord.Color.green())
    embed.add_field(name="Evento", value=event["title"], inline=False)
    if map_data:
        embed.add_field(name="Mapa", value=map_data["name"], inline=True)
    embed.add_field(name="Fecha", value=format_date(event["start_date"]), inline=True)
    if event_time:
        embed.add_field(name="Hora", value=event_time, inline=True)
    if event.get("notes"):
        embed.add_field(name="Notas", value=trim(event["notes"]), inline=False)

    delivered = False
    for setting in settings:
        try:
            channel = bot.get_channel(setting["main_channel_id"])
            if channel is None:
                channel = await bot.fetch_channel(setting["main_channel_id"])
            if isinstance(channel, discord.abc.Messageable):
                await channel.send(embed=embed)
                delivered = True
        except (discord.Forbidden, discord.NotFound, discord.HTTPException) as exc:
            log.warning("No se pudo avisar al canal %s: %s", setting["main_channel_id"], exc)

    if not delivered:
        raise RuntimeError("No se pudo entregar la notificación en ningún canal configurado")


@tasks.loop(minutes=15)
async def notification_worker() -> None:
    now = datetime.now(TIMEZONE)
    today = now.date()
    result = await db(
        lambda: supabase.table("calendar_events")
        .select("*")
        .eq("type", "play_day")
        .gte("start_date", today.isoformat())
        .lte("start_date", (today + timedelta(days=3)).isoformat())
        .execute()
    )

    for event in rows(result):
        event_date = parse_iso_date(event.get("start_date"))
        if not event_date:
            continue
        days_left = (event_date - today).days
        notification_type: str | None = None
        if days_left == 3:
            notification_type = "three_days"
        elif days_left == 0 and (now.hour, now.minute) >= (
            MORNING_HOUR,
            MORNING_MINUTE,
        ):
            notification_type = "same_day"
        if not notification_type:
            continue

        claimed = await claim_notification(event["id"], notification_type)
        if not claimed:
            continue
        try:
            await send_play_day_notification(event, notification_type)
        except Exception:
            await release_notification(event["id"], notification_type)
            log.exception("Error enviando aviso del evento %s", event["id"])


@notification_worker.before_loop
async def before_notification_worker() -> None:
    await bot.wait_until_ready()


@notification_worker.error
async def notification_worker_error(error: BaseException) -> None:
    log.exception("Error en la tarea de notificaciones", exc_info=error)


if __name__ == "__main__":
    bot.run(DISCORD_TOKEN, log_handler=None)