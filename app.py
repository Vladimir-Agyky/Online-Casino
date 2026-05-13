import hashlib
import itertools
import json
import math
import os
import random
import secrets
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "casino.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("CASINO_SECRET_KEY", "dev-fake-money-casino-key")

RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
SUITS = ["S", "H", "D", "C"]
RANK_VALUE = {rank: index + 2 for index, rank in enumerate(RANKS)}
HILO_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
HILO_VALUE = {rank: index + 1 for index, rank in enumerate(HILO_RANKS)}
HILO_HOUSE_EDGE = 0.01
HILO_MAX_SKIPS = 52
MINES_GRID_SIZE = 25
MINES_RTP = 0.99
TABLE_CHOICES = [1, 2, 3]
LIVE_ROUND_SECONDS = 10
RED_ROULETTE = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
BLACK_ROULETTE = {n for n in range(1, 37)} - RED_ROULETTE
ROULETTE_WHEEL_ORDER = [
    0,
    32,
    15,
    19,
    4,
    21,
    2,
    25,
    17,
    34,
    6,
    27,
    13,
    36,
    11,
    30,
    8,
    23,
    10,
    5,
    24,
    16,
    33,
    1,
    20,
    14,
    31,
    9,
    22,
    18,
    29,
    7,
    28,
    12,
    35,
    3,
    26,
]
PLINKO_RANGES = {
    "low": {
        8: (0.5, 5.6),
        9: (0.7, 5.6),
        10: (0.5, 8.9),
        11: (0.7, 8.4),
        12: (0.5, 10.0),
        13: (0.7, 8.1),
        14: (0.5, 7.1),
        15: (0.7, 15.0),
        16: (0.5, 16.0),
    },
    "medium": {
        8: (0.4, 13.0),
        9: (0.5, 18.0),
        10: (0.4, 22.0),
        11: (0.5, 24.0),
        12: (0.3, 33.0),
        13: (0.4, 43.0),
        14: (0.2, 58.0),
        15: (0.3, 88.0),
        16: (0.5, 110.0),
    },
    "high": {
        8: (0.2, 29.0),
        9: (0.2, 43.0),
        10: (0.2, 76.0),
        11: (0.2, 120.0),
        12: (0.2, 170.0),
        13: (0.2, 260.0),
        14: (0.2, 420.0),
        15: (0.2, 620.0),
        16: (0.2, 1000.0),
    },
}
PLINKO_TARGET_RTP = {"low": 0.84, "medium": 0.86, "high": 0.88}
PLINKO_RISK_SHAPE = {"low": 1.25, "medium": 2.0, "high": 3.2}
PLINKO_EDGE_BOOST = {"low": 1.5, "medium": 4.8, "high": 18.0}
PLINKO_MIN_MULTIPLIER = {"low": 0.35, "medium": 0.18, "high": 0.08}
STARTING_BALANCE = 10000
BLACKJACK_TABLE_KEY = "blackjack:main"
HOLDEM_TABLE_KEY = "holdem:main"
SMALL_BLIND = 10
BIG_BLIND = 20
SLOT_SYMBOLS = [
    {"key": "seven", "label": "7", "weight": 2, "pay": 120},
    {"key": "diamond", "label": "D", "weight": 4, "pay": 45},
    {"key": "star", "label": "S", "weight": 7, "pay": 18},
    {"key": "bell", "label": "B", "weight": 10, "pay": 10},
    {"key": "cherry", "label": "C", "weight": 15, "pay": 5},
    {"key": "lemon", "label": "L", "weight": 22, "pay": 3},
    {"key": "bar", "label": "BAR", "weight": 12, "pay": 8},
]
SLOT_BONUS_SPINS = 10
SLOT_BONUS_COST_MULTIPLIER = 35
GAME_STATS_ENDPOINTS = {
    "baccarat": ("baccarat", "Baccarat"),
    "dragon_tiger": ("dragon_tiger", "Dragon Tiger"),
    "roulette": ("roulette", "Roulette"),
    "limbo": ("limbo", "Limbo"),
    "plinko": ("plinko", "Plinko"),
    "mines": ("mines", "Mines"),
    "hilo": ("hilo", "Hi-Lo"),
    "slots": ("slots", "Slots"),
    "blackjack": ("blackjack", "Blackjack"),
    "holdem": ("holdem", "Texas Hold'em"),
}
GAME_NAME_SLUGS = {
    "Baccarat": "baccarat",
    "Dragon Tiger": "dragon_tiger",
    "Roulette": "roulette",
    "Limbo": "limbo",
    "Plinko": "plinko",
    "Mines": "mines",
    "Hi-Lo": "hilo",
    "Slots": "slots",
    "Blackjack": "blackjack",
    "Texas Hold'em": "holdem",
}


def utc_now():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def utc_from_iso(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", ""))
    except (TypeError, ValueError):
        return datetime.utcnow()


def utc_in(seconds):
    return (datetime.utcnow() + timedelta(seconds=seconds)).isoformat(timespec="seconds") + "Z"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            balance INTEGER NOT NULL DEFAULT 0,
            disabled INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS fair_rounds (
            id TEXT PRIMARY KEY,
            game TEXT NOT NULL,
            server_seed_hash TEXT NOT NULL,
            server_seed TEXT NOT NULL,
            client_seed TEXT NOT NULL,
            nonce INTEGER NOT NULL,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS game_states (
            name TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """
    )
    admin = db.execute("SELECT id FROM users WHERE username = ?", ("admin",)).fetchone()
    if admin is None:
        db.execute(
            """
            INSERT INTO users (username, password_hash, role, balance, disabled, created_at)
            VALUES (?, ?, 'admin', ?, 0, ?)
            """,
            ("admin", hash_password("admin123"), STARTING_BALANCE * 10, utc_now()),
        )
    db.commit()


@app.before_request
def load_current_user():
    g.user = None
    user_id = session.get("user_id")
    if user_id is not None:
        g.user = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if g.user is None or g.user["disabled"]:
            session.clear()
            g.user = None


@app.context_processor
def inject_globals():
    stats_page = GAME_STATS_ENDPOINTS.get(request.endpoint)
    return {
        "current_user": g.get("user"),
        "format_chips": format_chips,
        "stats_game": stats_page[0] if stats_page else None,
        "stats_game_label": stats_page[1] if stats_page else None,
    }


def format_chips(value):
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return "0"


def hash_password(password):
    return generate_password_hash(password, method="pbkdf2:sha256")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login", next=request.path))
        if g.user["role"] != "admin":
            flash("Admin access required.", "error")
            return redirect(url_for("lobby"))
        return view(*args, **kwargs)

    return wrapped


def parse_positive_int(value, minimum=1, maximum=1_000_000):
    try:
        amount = int(float(value))
    except (TypeError, ValueError):
        raise ValueError("Enter a whole chip amount.")
    if amount < minimum:
        raise ValueError(f"Minimum is {minimum} chip.")
    if amount > maximum:
        raise ValueError(f"Maximum is {format_chips(maximum)} chips.")
    return amount


def change_balance(user_id, amount, reason):
    db = get_db()
    db.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (int(amount), user_id))
    db.execute(
        "INSERT INTO transactions (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)",
        (user_id, int(amount), reason, utc_now()),
    )


def get_balance(user_id):
    row = get_db().execute("SELECT balance FROM users WHERE id = ?", (user_id,)).fetchone()
    return int(row["balance"]) if row else 0


def is_game_transaction(reason):
    lowered = reason.lower()
    return not (lowered.startswith("admin ") or lowered.startswith("raindrop "))


def transaction_game_name(reason):
    lowered = reason.lower()
    for suffix in (" payout", " bet", " blind", " call", " raise", " pot"):
        if lowered.endswith(suffix):
            return reason[: -len(suffix)]
    return reason


def game_slug(game_name):
    if game_name in GAME_NAME_SLUGS:
        return GAME_NAME_SLUGS[game_name]
    return game_name.lower().replace(" ", "_").replace("-", "_").replace("'", "")


def profit_rounds_for_user(user_id, game_filter=None):
    rows = get_db().execute(
        """
        SELECT amount, reason, created_at
        FROM transactions
        WHERE user_id = ?
        ORDER BY id ASC
        LIMIT 800
        """,
        (user_id,),
    ).fetchall()
    rounds = []
    current = None

    def finish_current():
        nonlocal current
        if current is not None:
            current["net"] = current["payout"] - current["stake"]
            rounds.append(current)
            current = None

    for row in rows:
        amount = int(row["amount"])
        reason = row["reason"]
        if not is_game_transaction(reason):
            continue
        game = transaction_game_name(reason)
        if game_filter and game_slug(game) != game_filter:
            continue
        if amount < 0:
            if current is None:
                current = {"game": game, "stake": abs(amount), "payout": 0, "created_at": row["created_at"]}
            elif current["payout"] == 0 and current["game"] == game:
                current["stake"] += abs(amount)
            else:
                finish_current()
                current = {"game": game, "stake": abs(amount), "payout": 0, "created_at": row["created_at"]}
        elif amount > 0:
            if current is None:
                current = {"game": game, "stake": 0, "payout": amount, "created_at": row["created_at"]}
            else:
                current["payout"] += amount
                current["game"] = current["game"] or game
            finish_current()
    finish_current()
    return rounds


def debit_or_error(user_id, amount, reason):
    if get_balance(user_id) < amount:
        return "Not enough fake chips for that bet."
    change_balance(user_id, -amount, reason)
    return None


def seed_hash(server_seed):
    return hashlib.sha256(server_seed.encode("utf-8")).hexdigest()


def new_pending_seed(game):
    server_seed = secrets.token_hex(32)
    return {
        "id": secrets.token_hex(10),
        "game": game,
        "server_seed": server_seed,
        "server_seed_hash": seed_hash(server_seed),
        "nonce": secrets.randbelow(2_000_000_000),
        "created_at": utc_now(),
    }


def fair_digest(server_seed, client_seed, nonce, game, salt="main"):
    payload = f"{server_seed}:{client_seed}:{nonce}:{game}:{salt}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def fair_rng(server_seed, client_seed, nonce, game, salt="main"):
    digest = fair_digest(server_seed, client_seed, nonce, game, salt)
    return random.Random(int(digest, 16))


def begin_fair(game, client_seed):
    pending = new_pending_seed(game)
    client_seed = (client_seed or "").strip() or "client-seed"
    rng = fair_rng(pending["server_seed"], client_seed, pending["nonce"], game)
    return {"pending": pending, "client_seed": client_seed, "rng": rng}


def finish_fair(game, pending, client_seed, result):
    db = get_db()
    public_result = dict(result)
    public_result.pop("deck", None)
    db.execute(
        """
        INSERT OR REPLACE INTO fair_rounds
            (id, game, server_seed_hash, server_seed, client_seed, nonce, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pending["id"],
            game,
            pending["server_seed_hash"],
            pending["server_seed"],
            client_seed,
            pending["nonce"],
            json.dumps(public_result),
            utc_now(),
        ),
    )
    return {
        "id": pending["id"],
        "game": game,
        "server_seed_hash": pending["server_seed_hash"],
        "server_seed": pending["server_seed"],
        "client_seed": client_seed,
        "nonce": pending["nonce"],
        "result": public_result,
    }


def new_deck(rng):
    deck = [{"rank": rank, "suit": suit} for suit in SUITS for rank in RANKS]
    rng.shuffle(deck)
    return deck


def card_label(card):
    return f"{card['rank']}{card['suit']}"


def card_rank_value(card):
    return RANK_VALUE[card["rank"]]


def blackjack_total(hand):
    total = 0
    aces = 0
    for card in hand:
        rank = card["rank"]
        if rank == "A":
            aces += 1
            total += 11
        elif rank in {"K", "Q", "J"}:
            total += 10
        else:
            total += int(rank)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def baccarat_value(card):
    if card["rank"] == "A":
        return 1
    if card["rank"] in {"10", "J", "Q", "K"}:
        return 0
    return int(card["rank"])


def baccarat_total(hand):
    return sum(baccarat_value(card) for card in hand) % 10


def roulette_color(number):
    if number == 0:
        return "green"
    return "red" if number in RED_ROULETTE else "black"


def roulette_wheel_slots(result_number=None):
    slots = []
    count = len(ROULETTE_WHEEL_ORDER)
    for index, number in enumerate(ROULETTE_WHEEL_ORDER):
        slots.append(
            {
                "number": number,
                "color": roulette_color(number),
                "angle": round((360 / count) * index, 3),
                "counter_angle": round((360 / count) * index * -1, 3),
                "is_result": result_number == number,
            }
        )
    return slots


def format_multiplier(value):
    rounded = round(float(value), 2)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def plinko_multipliers(rows, risk):
    center = rows / 2
    power = PLINKO_RISK_SHAPE[risk]
    edge_boost = PLINKO_EDGE_BOOST[risk]
    floor = PLINKO_MIN_MULTIPLIER[risk]
    raw = []
    for slot in range(rows + 1):
        distance = abs(slot - center) / center
        raw.append(floor + edge_boost * (distance**power))
    expected = sum(math.comb(rows, slot) * raw[slot] for slot in range(rows + 1)) / (2**rows)
    scale = PLINKO_TARGET_RTP[risk] / expected
    multipliers = []
    for value in raw:
        scaled = max(floor, value * scale)
        multipliers.append(round(scaled, 2))
    return multipliers


def get_state(name, default_factory):
    row = get_db().execute("SELECT state_json FROM game_states WHERE name = ?", (name,)).fetchone()
    if row:
        return json.loads(row["state_json"])
    state = default_factory()
    set_state(name, state)
    return state


def set_state(name, state):
    get_db().execute(
        """
        INSERT INTO game_states (name, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
        """,
        (name, json.dumps(state), utc_now()),
    )


def safe_user_snapshot(user_id):
    row = get_db().execute("SELECT username, balance FROM users WHERE id = ?", (user_id,)).fetchone()
    if row:
        return {"username": row["username"], "balance": int(row["balance"])}
    return {"username": "Unknown", "balance": 0}


def evaluate_five(cards):
    ranks = sorted([card_rank_value(card) for card in cards], reverse=True)
    counts = {rank: ranks.count(rank) for rank in set(ranks)}
    groups = sorted(counts.items(), key=lambda item: (item[1], item[0]), reverse=True)
    flush = len({card["suit"] for card in cards}) == 1
    unique = sorted(set(ranks), reverse=True)
    straight_high = None
    if len(unique) == 5:
        if unique[0] - unique[4] == 4:
            straight_high = unique[0]
        elif unique == [14, 5, 4, 3, 2]:
            straight_high = 5

    if flush and straight_high:
        return (8, [straight_high], "Straight flush")
    if groups[0][1] == 4:
        quad = groups[0][0]
        kicker = max(rank for rank in ranks if rank != quad)
        return (7, [quad, kicker], "Four of a kind")
    if groups[0][1] == 3 and groups[1][1] == 2:
        return (6, [groups[0][0], groups[1][0]], "Full house")
    if flush:
        return (5, ranks, "Flush")
    if straight_high:
        return (4, [straight_high], "Straight")
    if groups[0][1] == 3:
        trips = groups[0][0]
        kickers = sorted([rank for rank in ranks if rank != trips], reverse=True)
        return (3, [trips] + kickers, "Three of a kind")
    pairs = sorted([rank for rank, count in counts.items() if count == 2], reverse=True)
    if len(pairs) == 2:
        kicker = max(rank for rank in ranks if rank not in pairs)
        return (2, pairs + [kicker], "Two pair")
    if len(pairs) == 1:
        pair = pairs[0]
        kickers = sorted([rank for rank in ranks if rank != pair], reverse=True)
        return (1, [pair] + kickers, "One pair")
    return (0, ranks, "High card")


def evaluate_best(cards):
    best = None
    best_cards = None
    for combo in itertools.combinations(cards, 5):
        score = evaluate_five(list(combo))
        if best is None or (score[0], score[1]) > (best[0], best[1]):
            best = score
            best_cards = combo
    return {"score": [best[0]] + best[1], "name": best[2], "cards": [card_label(card) for card in best_cards]}


def settle_wager(user_id, bet, payout, game):
    if payout > 0:
        change_balance(user_id, payout, f"{game} payout")
    get_db().commit()
    return payout - bet


def table_number():
    try:
        selected = int(request.args.get("table", session.get("table_number", 1)))
    except (TypeError, ValueError):
        selected = 1
    if selected not in TABLE_CHOICES:
        selected = 1
    session["table_number"] = selected
    return selected


def table_key(prefix):
    return f"{prefix}:table:{table_number()}"


def road_table_number():
    try:
        selected = int(request.values.get("table", request.args.get("table", session.get("table_number", 1))))
    except (TypeError, ValueError):
        selected = 1
    if selected not in TABLE_CHOICES:
        selected = 1
    session["table_number"] = selected
    return selected


def road_state_name(game, table=None):
    selected = table if table in TABLE_CHOICES else road_table_number()
    return f"road:{game}:table:{selected}"


def add_road_result(game, winner, table=None):
    state = get_state(road_state_name(game, table), lambda: {"history": []})
    state.setdefault("history", []).append({"winner": winner, "created_at": utc_now()})
    state["history"] = state["history"][-90:]
    set_state(road_state_name(game, table), state)
    return state


def road_history(game, table=None):
    return get_state(road_state_name(game, table), lambda: {"history": []}).get("history", [])


def selected_table_from_request():
    if "table" not in request.values:
        return None
    return road_table_number()


def live_table_key(game, table):
    return f"live:{game}:table:{table}"


def default_live_table_state(game, table):
    return {
        "game": game,
        "table": table,
        "round": 0,
        "next_deal_at": utc_in(LIVE_ROUND_SECONDS),
        "current": None,
        "bets": {},
    }


def deal_baccarat_cards(rng):
    deck = new_deck(rng)
    player = [deck.pop(), deck.pop()]
    banker = [deck.pop(), deck.pop()]
    player_total = baccarat_total(player)
    banker_total = baccarat_total(banker)
    if player_total < 8 and banker_total < 8:
        player_third = None
        if player_total <= 5:
            player_third = deck.pop()
            player.append(player_third)
            player_total = baccarat_total(player)
        if player_third is None:
            if banker_total <= 5:
                banker.append(deck.pop())
        else:
            third_value = baccarat_value(player_third)
            if (
                banker_total <= 2
                or (banker_total == 3 and third_value != 8)
                or (banker_total == 4 and 2 <= third_value <= 7)
                or (banker_total == 5 and 4 <= third_value <= 7)
                or (banker_total == 6 and 6 <= third_value <= 7)
            ):
                banker.append(deck.pop())
        banker_total = baccarat_total(banker)
    if player_total > banker_total:
        winner = "player"
    elif banker_total > player_total:
        winner = "banker"
    else:
        winner = "tie"
    return {
        "player": player,
        "banker": banker,
        "player_total": player_total,
        "banker_total": banker_total,
        "winner": winner,
    }


def deal_dragon_tiger_cards(rng):
    deck = new_deck(rng)
    dragon = deck.pop()
    tiger = deck.pop()
    dragon_value = card_rank_value(dragon)
    tiger_value = card_rank_value(tiger)
    if dragon_value > tiger_value:
        winner = "dragon"
    elif tiger_value > dragon_value:
        winner = "tiger"
    else:
        winner = "tie"
    return {
        "dragon": dragon,
        "tiger": tiger,
        "dragon_total": dragon_value,
        "tiger_total": tiger_value,
        "winner": winner,
    }


def live_round_payout(game, wager, winner, bet):
    if game == "baccarat":
        if winner == "tie":
            return bet
        if wager == winner:
            return int(bet * 1.95) if winner == "banker" else bet * 2
        return 0
    if winner == "tie":
        return bet // 2
    return bet * 2 if wager == winner else 0


def live_table_state(game, table):
    key = live_table_key(game, table)
    row = get_db().execute("SELECT state_json FROM game_states WHERE name = ?", (key,)).fetchone()
    if row:
        return json.loads(row["state_json"])
    state = default_live_table_state(game, table)
    set_state(key, state)
    get_db().commit()
    return state


def advance_live_table(game, table):
    state = live_table_state(game, table)
    changed = False
    now = datetime.utcnow()
    steps = 0
    while utc_from_iso(state.get("next_deal_at")) <= now and steps < 12:
        bets = state.get("bets", {})
        seed_parts = [
            f"{uid}:{bet['username']}:{bet['wager']}:{bet['bet']}:{bet.get('client_seed') or ''}"
            for uid, bet in sorted(bets.items())
        ]
        client_seed = "|".join(seed_parts) if seed_parts else f"table-{table}-{state.get('round', 0) + 1}"
        ctx = begin_fair(game, client_seed)
        dealt = deal_baccarat_cards(ctx["rng"]) if game == "baccarat" else deal_dragon_tiger_cards(ctx["rng"])
        winner = dealt["winner"]
        settlements = []
        for uid, bet_info in bets.items():
            bet = int(bet_info["bet"])
            payout = live_round_payout(game, bet_info["wager"], winner, bet)
            net = payout - bet
            if payout > 0:
                change_balance(int(uid), payout, f"{'Baccarat' if game == 'baccarat' else 'Dragon Tiger'} payout")
            settlements.append(
                {
                    "user_id": uid,
                    "username": bet_info["username"],
                    "wager": bet_info["wager"],
                    "bet": bet,
                    "payout": payout,
                    "net": net,
                }
            )
        result_payload = {
            "player_name": ", ".join(item["username"] for item in settlements) if settlements else "Table",
            "table": table,
            "round": int(state.get("round", 0)) + 1,
            "winner": winner,
            "bet": sum(item["bet"] for item in settlements),
            "payout": sum(item["payout"] for item in settlements),
            "net": sum(item["net"] for item in settlements),
            "settlements": settlements,
        }
        if game == "baccarat":
            result_payload.update(
                {
                    "player": [card_label(card) for card in dealt["player"]],
                    "banker": [card_label(card) for card in dealt["banker"]],
                    "player_total": dealt["player_total"],
                    "banker_total": dealt["banker_total"],
                }
            )
        else:
            result_payload.update({"dragon": card_label(dealt["dragon"]), "tiger": card_label(dealt["tiger"])})
        fair = finish_fair(game, ctx["pending"], ctx["client_seed"], result_payload)
        state["round"] = int(state.get("round", 0)) + 1
        state["current"] = {
            **dealt,
            "round": state["round"],
            "settlements": settlements,
            "fair": fair,
            "created_at": utc_now(),
        }
        state["bets"] = {}
        add_road_result(game, winner, table)
        state["next_deal_at"] = (utc_from_iso(state.get("next_deal_at")) + timedelta(seconds=LIVE_ROUND_SECONDS)).isoformat(timespec="seconds") + "Z"
        changed = True
        steps += 1
    if utc_from_iso(state.get("next_deal_at")) <= now:
        state["next_deal_at"] = utc_in(LIVE_ROUND_SECONDS)
        changed = True
    if changed:
        set_state(live_table_key(game, table), state)
        get_db().commit()
    return state


def live_public_state(game, table, user_id):
    state = advance_live_table(game, table)
    current = state.get("current")
    pending_bet = (state.get("bets") or {}).get(str(user_id))
    countdown = max(0, int((utc_from_iso(state.get("next_deal_at")) - datetime.utcnow()).total_seconds()))
    return {
        "game": game,
        "table": table,
        "round": state.get("round", 0),
        "countdown": countdown,
        "next_deal_at": state.get("next_deal_at"),
        "current": current,
        "pending_bet": pending_bet,
        "history": road_history(game, table),
        "my_balance": get_balance(user_id),
        "me": str(user_id),
    }


def place_live_table_bet(game, table, user_id, username, bet, wager, client_seed):
    state = advance_live_table(game, table)
    if str(user_id) in state.get("bets", {}):
        return None, "You already have a bet locked for the next round."
    if max(0, int((utc_from_iso(state.get("next_deal_at")) - datetime.utcnow()).total_seconds())) <= 0:
        state = advance_live_table(game, table)
    error = debit_or_error(user_id, bet, f"{'Baccarat' if game == 'baccarat' else 'Dragon Tiger'} bet")
    if error:
        get_db().commit()
        return None, error
    state.setdefault("bets", {})[str(user_id)] = {
        "username": username,
        "bet": bet,
        "wager": wager,
        "client_seed": (client_seed or "").strip(),
        "created_at": utc_now(),
    }
    set_state(live_table_key(game, table), state)
    get_db().commit()
    return state, None


def table_summaries(game):
    rows = []
    for number in TABLE_CHOICES:
        if game == "blackjack":
            state = get_state(f"blackjack:table:{number}", default_blackjack_state)
            rows.append(
                {
                    "number": number,
                    "players": len(state.get("players", {})),
                    "capacity": 5,
                    "phase": state.get("phase", "waiting"),
                    "shoe": [],
                }
            )
        elif game == "holdem":
            state = get_state(f"holdem:table:{number}", default_holdem_state)
            rows.append(
                {
                    "number": number,
                    "players": len(state.get("players", {})),
                    "capacity": 8,
                    "phase": state.get("phase", "waiting"),
                    "shoe": [],
                }
            )
        elif game in {"baccarat", "dragon_tiger"}:
            advance_live_table(game, number)
            history = road_history(game, number)
            rows.append(
                {
                    "number": number,
                    "players": 0,
                    "capacity": None,
                    "phase": "live shoe",
                    "shoe": history[-12:],
                }
            )
    return rows


def raindrop_state():
    return get_state("raindrop:events", lambda: {"events": []})


def save_raindrop_state(state):
    state["events"] = state.get("events", [])[-60:]
    set_state("raindrop:events", state)


def settle_raindrops():
    state = raindrop_state()
    changed = False
    now = datetime.utcnow()
    for event in state.get("events", []):
        if event.get("status") != "open":
            continue
        if utc_from_iso(event.get("expires_at")) > now:
            continue
        joined = event.get("joined", [])
        amount = int(event.get("amount") or 0)
        if joined:
            share = amount // len(joined)
            paid_total = share * len(joined)
            for joined_user in joined:
                change_balance(int(joined_user["id"]), share, "Raindrop received")
            event["status"] = "paid"
            event["share"] = share
            event["paid_total"] = paid_total
            message = f"{event['creator_name']}'s raindrop paid {format_chips(share)} chips each to {len(joined)} players."
            get_db().execute(
                "INSERT INTO chat_messages (user_id, username, message, created_at) VALUES (?, ?, ?, ?)",
                (event["creator_id"], "Raindrop", message, utc_now()),
            )
        else:
            change_balance(int(event["creator_id"]), amount, "Raindrop refunded")
            event["status"] = "refunded"
            event["share"] = 0
            event["paid_total"] = 0
        event["settled_at"] = utc_now()
        changed = True
    if changed:
        save_raindrop_state(state)
        get_db().commit()
    return state


def open_raindrops():
    state = settle_raindrops()
    return [event for event in state.get("events", []) if event.get("status") == "open"]


@app.route("/")
@login_required
def lobby():
    games = [
        ("Texas Hold'em", "holdem", "Shared poker table with live polling."),
        ("Blackjack", "blackjack", "Dealer table for up to five players."),
        ("Baccarat", "baccarat", "Player, banker, and tie betting."),
        ("Dragon Tiger", "dragon_tiger", "One-card showdown."),
        ("Roulette", "roulette", "European wheel with inside and outside bets."),
        ("Limbo", "limbo", "Multiplier chase with hash-based results."),
        ("Plinko", "plinko", "Peg board with rows, risk, and edge multipliers."),
        ("Mines", "mines", "Twenty-five tiles, gems, bombs, and cashouts."),
        ("Slots", "slots", "Buy spins, chase features, and roll for a fake jackpot."),
        ("Hi-Lo", "hilo", "Call the next card higher or lower."),
    ]
    recent = get_db().execute(
        "SELECT * FROM fair_rounds ORDER BY created_at DESC LIMIT 6"
    ).fetchall()
    return render_template("lobby.html", games=games, recent=recent, raindrops=open_raindrops()[:3])


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if len(username) < 3 or len(password) < 4:
            flash("Use at least 3 characters for username and 4 for password.", "error")
            return render_template("register.html")
        try:
            db = get_db()
            db.execute(
                """
                INSERT INTO users (username, password_hash, role, balance, disabled, created_at)
                VALUES (?, ?, 'user', ?, 0, ?)
                """,
                (username, hash_password(password), STARTING_BALANCE, utc_now()),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("That username is already taken.", "error")
            return render_template("register.html")
        flash("Account created. Sign in to play.", "success")
        return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
            return render_template("login.html")
        if user["disabled"]:
            flash("That account is disabled.", "error")
            return render_template("login.html")
        session.clear()
        session["user_id"] = user["id"]
        return redirect(request.args.get("next") or url_for("lobby"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/admin", methods=["GET", "POST"])
@admin_required
def admin():
    db = get_db()
    if request.method == "POST":
        user_id = request.form.get("user_id")
        action = request.form.get("action")
        target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if target is None:
            flash("User not found.", "error")
            return redirect(url_for("admin"))
        if action == "set_balance":
            try:
                amount = parse_positive_int(request.form.get("balance"), minimum=0, maximum=100_000_000)
            except ValueError as exc:
                flash(str(exc), "error")
                return redirect(url_for("admin"))
            delta = amount - int(target["balance"])
            change_balance(target["id"], delta, f"Admin set balance by {g.user['username']}")
            flash(f"{target['username']} balance updated.", "success")
        elif action == "toggle_disabled":
            disabled = 0 if target["disabled"] else 1
            if target["id"] == g.user["id"] and disabled:
                flash("You cannot disable your own admin account.", "error")
                return redirect(url_for("admin"))
            db.execute("UPDATE users SET disabled = ? WHERE id = ?", (disabled, target["id"]))
            flash(f"{target['username']} account status updated.", "success")
        elif action == "set_role":
            role = request.form.get("role")
            if role not in {"user", "admin"}:
                flash("Invalid role.", "error")
                return redirect(url_for("admin"))
            db.execute("UPDATE users SET role = ? WHERE id = ?", (role, target["id"]))
            flash(f"{target['username']} role updated.", "success")
        elif action == "reset_password":
            password = request.form.get("password", "")
            if len(password) < 4:
                flash("Password must be at least 4 characters.", "error")
                return redirect(url_for("admin"))
            db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(password), target["id"]),
            )
            flash(f"{target['username']} password reset.", "success")
        db.commit()
        return redirect(url_for("admin"))

    users = db.execute("SELECT * FROM users ORDER BY role DESC, username ASC").fetchall()
    transactions = db.execute(
        """
        SELECT transactions.*, users.username
        FROM transactions
        JOIN users ON users.id = transactions.user_id
        ORDER BY transactions.created_at DESC, transactions.id DESC
        LIMIT 40
        """
    ).fetchall()
    return render_template("admin.html", users=users, transactions=transactions)


@app.route("/api/me")
@login_required
def api_me():
    return jsonify(
        {
            "username": g.user["username"],
            "role": g.user["role"],
            "balance": get_balance(g.user["id"]),
        }
    )


@app.route("/api/chat", methods=["GET", "POST"])
@login_required
def api_chat():
    db = get_db()
    if request.method == "POST":
        message = " ".join((request.form.get("message") or "").split())
        if not message:
            return jsonify({"error": "Type a message first."}), 400
        if len(message) > 240:
            return jsonify({"error": "Chat messages must be 240 characters or less."}), 400
        db.execute(
            "INSERT INTO chat_messages (user_id, username, message, created_at) VALUES (?, ?, ?, ?)",
            (g.user["id"], g.user["username"], message, utc_now()),
        )
        db.commit()
    rows = db.execute(
        "SELECT id, username, message, created_at FROM chat_messages ORDER BY id DESC LIMIT 80"
    ).fetchall()
    return jsonify(
        {
            "messages": [
                {
                    "id": row["id"],
                    "username": row["username"],
                    "message": row["message"],
                    "created_at": row["created_at"],
                }
                for row in reversed(rows)
            ]
        }
    )


@app.route("/api/raindrop", methods=["POST"])
@login_required
def api_raindrop():
    try:
        amount = parse_positive_int(request.form.get("amount"), minimum=1, maximum=1_000_000)
        count = parse_positive_int(request.form.get("count"), minimum=1, maximum=25)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if get_balance(g.user["id"]) < amount:
        return jsonify({"error": "Not enough fake chips for that raindrop."}), 400
    rows = get_db().execute(
        """
        SELECT id, username
        FROM users
        WHERE disabled = 0 AND id != ?
        ORDER BY RANDOM()
        LIMIT ?
        """,
        (g.user["id"], count),
    ).fetchall()
    if not rows:
        return jsonify({"error": "There are no other enabled users to receive the raindrop."}), 400
    share = amount // len(rows)
    if share <= 0:
        return jsonify({"error": "Increase the amount so every receiver gets at least 1 chip."}), 400
    total = share * len(rows)
    change_balance(g.user["id"], -total, "Raindrop sent")
    recipients = []
    for row in rows:
        change_balance(row["id"], share, "Raindrop received")
        recipients.append(row["username"])
    message = f"{g.user['username']} made it rain {format_chips(total)} chips: {format_chips(share)} each to {', '.join(recipients)}"
    get_db().execute(
        "INSERT INTO chat_messages (user_id, username, message, created_at) VALUES (?, ?, ?, ?)",
        (g.user["id"], "Raindrop", message, utc_now()),
    )
    get_db().commit()
    return jsonify({"amount": total, "share": share, "recipients": recipients, "balance": get_balance(g.user["id"])})


@app.route("/raindrops", methods=["GET", "POST"])
@login_required
def raindrops():
    if request.method == "POST":
        try:
            amount = parse_positive_int(request.form.get("amount"), minimum=1, maximum=1_000_000)
            hours = parse_positive_int(request.form.get("hours"), minimum=1, maximum=168)
        except ValueError as exc:
            flash(str(exc), "error")
            return redirect(url_for("raindrops"))
        error = debit_or_error(g.user["id"], amount, "Raindrop sent")
        if error:
            flash(error, "error")
            get_db().commit()
            return redirect(url_for("raindrops"))
        state = settle_raindrops()
        event = {
            "id": secrets.token_hex(8),
            "creator_id": g.user["id"],
            "creator_name": g.user["username"],
            "amount": amount,
            "hours": hours,
            "created_at": utc_now(),
            "expires_at": utc_in(hours * 3600),
            "joined": [],
            "status": "open",
        }
        state.setdefault("events", []).append(event)
        save_raindrop_state(state)
        get_db().execute(
            "INSERT INTO chat_messages (user_id, username, message, created_at) VALUES (?, ?, ?, ?)",
            (g.user["id"], "Raindrop", f"{g.user['username']} opened a {format_chips(amount)} chip raindrop. Join from the Raindrop tab.", utc_now()),
        )
        get_db().commit()
        flash("Raindrop scheduled. It pays only to players who join before the timer ends.", "success")
        return redirect(url_for("raindrops"))
    return render_template("raindrops.html", events=reversed(settle_raindrops().get("events", [])))


@app.route("/api/raindrops/<event_id>/join", methods=["POST"])
@login_required
def api_raindrop_join(event_id):
    state = settle_raindrops()
    for event in state.get("events", []):
        if event.get("id") != event_id:
            continue
        if event.get("status") != "open":
            return jsonify({"error": "That raindrop is already closed."}), 400
        if int(event["creator_id"]) == int(g.user["id"]):
            return jsonify({"error": "You cannot join your own raindrop."}), 400
        joined = event.setdefault("joined", [])
        if any(int(item["id"]) == int(g.user["id"]) for item in joined):
            return jsonify({"error": "You already joined this raindrop."}), 400
        joined.append({"id": g.user["id"], "username": g.user["username"], "joined_at": utc_now()})
        save_raindrop_state(state)
        get_db().commit()
        return jsonify({"event": event, "joined": len(joined)})
    return jsonify({"error": "Raindrop not found."}), 404


@app.route("/api/profit-loss")
@login_required
def api_profit_loss():
    requested_game = request.args.get("game", "").strip()
    game_filter = requested_game if requested_game in set(GAME_NAME_SLUGS.values()) else None
    rounds = profit_rounds_for_user(g.user["id"], game_filter)
    game_label = next(
        (label for slug, label in GAME_STATS_ENDPOINTS.values() if slug == game_filter),
        "All Games",
    )
    total = 0
    points = [{"index": 0, "value": 0, "net": 0, "game": "Start", "stake": 0, "payout": 0}]
    wagered = 0
    payouts = 0
    wins = 0
    losses = 0
    pushes = 0
    best = 0
    worst = 0
    for item in rounds:
        net = int(item["net"])
        total += net
        wagered += int(item["stake"])
        payouts += int(item["payout"])
        wins += 1 if net > 0 else 0
        losses += 1 if net < 0 else 0
        pushes += 1 if net == 0 else 0
        best = max(best, total)
        worst = min(worst, total)
        points.append(
            {
                "index": len(points),
                "value": total,
                "net": net,
                "game": item["game"],
                "stake": item["stake"],
                "payout": item["payout"],
                "created_at": item["created_at"],
            }
        )
    roi = round((total / wagered) * 100, 2) if wagered else 0
    return jsonify(
        {
            "points": points[-120:],
            "game": game_filter or "all",
            "game_label": game_label,
            "profit": total,
            "wagered": wagered,
            "payouts": payouts,
            "rounds": len(rounds),
            "wins": wins,
            "losses": losses,
            "pushes": pushes,
            "roi": roi,
            "best": best,
            "worst": worst,
        }
    )


@app.route("/fairness")
@login_required
def fairness():
    rounds = get_db().execute(
        "SELECT * FROM fair_rounds ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    return render_template("fairness.html", rounds=rounds)


@app.route("/baccarat", methods=["GET", "POST"])
@login_required
def baccarat():
    selected_table = selected_table_from_request()
    if request.method == "POST":
        selected_table = selected_table or road_table_number()
        try:
            bet = parse_positive_int(request.form.get("bet"))
        except ValueError as exc:
            flash(str(exc), "error")
            return redirect(url_for("baccarat", table=selected_table))
        wager = request.form.get("wager")
        if wager not in {"player", "banker", "tie"}:
            flash("Choose Player, Banker, or Tie.", "error")
            return redirect(url_for("baccarat", table=selected_table))
        _state, error = place_live_table_bet(
            "baccarat",
            selected_table,
            g.user["id"],
            g.user["username"],
            bet,
            wager,
            request.form.get("client_seed"),
        )
        if error:
            flash(error, "error")
        else:
            flash("Bet locked for the next Baccarat round.", "success")
        return redirect(url_for("baccarat", table=selected_table))
    return render_template(
        "baccarat.html",
        table_number=selected_table,
        tables=table_summaries("baccarat"),
    )


@app.route("/dragon-tiger", methods=["GET", "POST"])
@login_required
def dragon_tiger():
    selected_table = selected_table_from_request()
    if request.method == "POST":
        selected_table = selected_table or road_table_number()
        try:
            bet = parse_positive_int(request.form.get("bet"))
        except ValueError as exc:
            flash(str(exc), "error")
            return redirect(url_for("dragon_tiger", table=selected_table))
        wager = request.form.get("wager")
        if wager not in {"dragon", "tiger", "tie"}:
            flash("Choose Dragon, Tiger, or Tie.", "error")
            return redirect(url_for("dragon_tiger", table=selected_table))
        _state, error = place_live_table_bet(
            "dragon_tiger",
            selected_table,
            g.user["id"],
            g.user["username"],
            bet,
            wager,
            request.form.get("client_seed"),
        )
        if error:
            flash(error, "error")
        else:
            flash("Bet locked for the next Dragon Tiger round.", "success")
        return redirect(url_for("dragon_tiger", table=selected_table))
    return render_template(
        "dragon_tiger.html",
        table_number=selected_table,
        tables=table_summaries("dragon_tiger"),
    )


@app.route("/api/roads/<game>")
@login_required
def api_roads(game):
    if game not in {"baccarat", "dragon_tiger"}:
        return jsonify({"error": "Unknown road game."}), 404
    selected_table = road_table_number()
    advance_live_table(game, selected_table)
    return jsonify({"history": road_history(game, selected_table), "table": selected_table})


@app.route("/api/live/<game>/state")
@login_required
def api_live_table_state(game):
    if game not in {"baccarat", "dragon_tiger"}:
        return jsonify({"error": "Unknown live table."}), 404
    selected_table = road_table_number()
    return jsonify(live_public_state(game, selected_table, g.user["id"]))


@app.route("/api/live/<game>/bet", methods=["POST"])
@login_required
def api_live_table_bet(game):
    if game not in {"baccarat", "dragon_tiger"}:
        return jsonify({"error": "Unknown live table."}), 404
    selected_table = road_table_number()
    allowed = {"player", "banker", "tie"} if game == "baccarat" else {"dragon", "tiger", "tie"}
    wager = request.form.get("wager")
    if wager not in allowed:
        return jsonify({"error": "Choose a valid betting side."}), 400
    try:
        bet = parse_positive_int(request.form.get("bet"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    _state, error = place_live_table_bet(
        game,
        selected_table,
        g.user["id"],
        g.user["username"],
        bet,
        wager,
        request.form.get("client_seed"),
    )
    if error:
        return jsonify({"error": error}), 400
    return jsonify(live_public_state(game, selected_table, g.user["id"]))


@app.route("/api/baccarat/no-bet", methods=["POST"])
@login_required
def api_baccarat_no_bet():
    selected_table = road_table_number()
    return jsonify(live_public_state("baccarat", selected_table, g.user["id"]))


@app.route("/api/dragon-tiger/no-bet", methods=["POST"])
@login_required
def api_dragon_no_bet():
    selected_table = road_table_number()
    return jsonify(live_public_state("dragon_tiger", selected_table, g.user["id"]))


@app.route("/roulette", methods=["GET", "POST"])
@login_required
def roulette():
    result = None
    if request.method == "POST":
        try:
            bet = parse_positive_int(request.form.get("bet"))
        except ValueError as exc:
            flash(str(exc), "error")
            return redirect(url_for("roulette"))
        bet_type = request.form.get("bet_type")
        allowed = {
            "red",
            "black",
            "odd",
            "even",
            "low",
            "high",
            "dozen1",
            "dozen2",
            "dozen3",
            "column1",
            "column2",
            "column3",
            "number",
        }
        if bet_type not in allowed:
            flash("Choose a roulette bet.", "error")
            return redirect(url_for("roulette"))
        chosen_number = None
        if bet_type == "number":
            try:
                chosen_number = parse_positive_int(request.form.get("number"), minimum=0, maximum=36)
            except ValueError as exc:
                flash(str(exc), "error")
                return redirect(url_for("roulette"))
        error = debit_or_error(g.user["id"], bet, "Roulette bet")
        if error:
            flash(error, "error")
            get_db().commit()
            return redirect(url_for("roulette"))
        ctx = begin_fair("roulette", request.form.get("client_seed"))
        number = ctx["rng"].randrange(37)
        color = roulette_color(number)
        win = False
        odds = 1
        if bet_type == "red":
            win = number in RED_ROULETTE
        elif bet_type == "black":
            win = number in BLACK_ROULETTE
        elif bet_type == "odd":
            win = number != 0 and number % 2 == 1
        elif bet_type == "even":
            win = number != 0 and number % 2 == 0
        elif bet_type == "low":
            win = 1 <= number <= 18
        elif bet_type == "high":
            win = 19 <= number <= 36
        elif bet_type == "dozen1":
            win = 1 <= number <= 12
            odds = 2
        elif bet_type == "dozen2":
            win = 13 <= number <= 24
            odds = 2
        elif bet_type == "dozen3":
            win = 25 <= number <= 36
            odds = 2
        elif bet_type == "column1":
            win = number != 0 and number % 3 == 1
            odds = 2
        elif bet_type == "column2":
            win = number != 0 and number % 3 == 2
            odds = 2
        elif bet_type == "column3":
            win = number != 0 and number % 3 == 0
            odds = 2
        elif bet_type == "number":
            win = number == chosen_number
            odds = 35
        payout = bet * (odds + 1) if win else 0
        net = settle_wager(g.user["id"], bet, payout, "Roulette")
        fair = finish_fair(
            "roulette",
            ctx["pending"],
            ctx["client_seed"],
            {
                "bet_type": bet_type,
                "chosen_number": chosen_number,
                "number": number,
                "color": color,
                "win": win,
                "payout": payout,
                "bet": bet,
                "net": net,
                "player_name": g.user["username"],
            },
        )
        get_db().commit()
        result = {
            "bet": bet,
            "bet_type": bet_type,
            "chosen_number": chosen_number,
            "number": number,
            "color": color,
            "win": win,
            "payout": payout,
            "net": net,
            "fair": fair,
        }
    result_number = result["number"] if result else None
    roulette_slots = roulette_wheel_slots(result_number)
    return render_template(
        "roulette.html",
        result=result,
        roulette_slots=roulette_slots,
        result_angle=next((slot["angle"] for slot in roulette_slots if slot["is_result"]), 0),
    )


def limbo_crash(server_seed, client_seed, nonce):
    digest = fair_digest(server_seed, client_seed, nonce, "limbo", "crash")
    integer = int(digest[:13], 16)
    max_integer = float(16**13)
    roll = integer / max_integer
    multiplier = 0.99 / max(1.0 - roll, 0.000001)
    return min(100000.0, max(1.0, int(multiplier * 100) / 100.0))


@app.route("/limbo", methods=["GET", "POST"])
@login_required
def limbo():
    result = None
    if request.method == "POST":
        try:
            bet = parse_positive_int(request.form.get("bet"))
            target = float(request.form.get("target", "2"))
        except (ValueError, TypeError):
            flash("Enter a valid bet and target multiplier.", "error")
            return redirect(url_for("limbo"))
        if target < 1.01 or target > 1000:
            flash("Target must be between 1.01x and 1000x.", "error")
            return redirect(url_for("limbo"))
        error = debit_or_error(g.user["id"], bet, "Limbo bet")
        if error:
            flash(error, "error")
            get_db().commit()
            return redirect(url_for("limbo"))
        ctx = begin_fair("limbo", request.form.get("client_seed"))
        crash = limbo_crash(ctx["pending"]["server_seed"], ctx["client_seed"], ctx["pending"]["nonce"])
        win = crash >= target
        payout = int(bet * target) if win else 0
        net = settle_wager(g.user["id"], bet, payout, "Limbo")
        fair = finish_fair(
            "limbo",
            ctx["pending"],
            ctx["client_seed"],
            {
                "target": target,
                "crash": crash,
                "win": win,
                "payout": payout,
                "bet": bet,
                "net": net,
                "player_name": g.user["username"],
            },
        )
        get_db().commit()
        result = {"bet": bet, "target": target, "crash": crash, "win": win, "payout": payout, "net": net, "fair": fair}
    return render_template("limbo.html", result=result)


@app.route("/api/limbo/play", methods=["POST"])
@login_required
def api_limbo_play():
    try:
        bet = parse_positive_int(request.form.get("bet"))
        target = float(request.form.get("target", "2"))
    except (ValueError, TypeError):
        return jsonify({"error": "Enter a valid bet and target multiplier."}), 400
    if target < 1.01 or target > 1000:
        return jsonify({"error": "Target must be between 1.01x and 1000x."}), 400
    error = debit_or_error(g.user["id"], bet, "Limbo bet")
    if error:
        get_db().commit()
        return jsonify({"error": error}), 400
    ctx = begin_fair("limbo", request.form.get("client_seed"))
    crash = limbo_crash(ctx["pending"]["server_seed"], ctx["client_seed"], ctx["pending"]["nonce"])
    win = crash >= target
    payout = int(bet * target) if win else 0
    net = settle_wager(g.user["id"], bet, payout, "Limbo")
    fair = finish_fair(
        "limbo",
        ctx["pending"],
        ctx["client_seed"],
        {
            "target": target,
            "crash": crash,
            "win": win,
            "payout": payout,
            "bet": bet,
            "net": net,
            "player_name": g.user["username"],
        },
    )
    get_db().commit()
    return jsonify(
        {
            "bet": bet,
            "target": target,
            "crash": crash,
            "win": win,
            "payout": payout,
            "net": net,
            "balance": get_balance(g.user["id"]),
            "fair": fair,
        }
    )


@app.route("/plinko", methods=["GET", "POST"])
@login_required
def plinko():
    result = None
    rows = 12
    risk = "medium"
    multipliers = plinko_multipliers(rows, risk)
    if request.method == "POST":
        try:
            bet = parse_positive_int(request.form.get("bet"))
            rows = parse_positive_int(request.form.get("rows"), minimum=8, maximum=16)
        except ValueError as exc:
            flash(str(exc), "error")
            return redirect(url_for("plinko"))
        risk = request.form.get("risk", "medium")
        if risk not in PLINKO_RANGES:
            flash("Choose Low, Medium, or High risk.", "error")
            return redirect(url_for("plinko"))
        error = debit_or_error(g.user["id"], bet, "Plinko bet")
        if error:
            flash(error, "error")
            get_db().commit()
            return redirect(url_for("plinko"))
        ctx = begin_fair("plinko", request.form.get("client_seed"))
        path = [ctx["rng"].randrange(2) for _ in range(rows)]
        slot = sum(path)
        multipliers = plinko_multipliers(rows, risk)
        multiplier = multipliers[slot]
        payout = int(bet * multiplier)
        net = settle_wager(g.user["id"], bet, payout, "Plinko")
        fair = finish_fair(
            "plinko",
            ctx["pending"],
            ctx["client_seed"],
            {
                "risk": risk,
                "rows": rows,
                "path": path,
                "slot": slot,
                "multiplier": multiplier,
                "payout": payout,
                "bet": bet,
                "net": net,
                "player_name": g.user["username"],
            },
        )
        get_db().commit()
        result = {
            "bet": bet,
            "risk": risk,
            "rows": rows,
            "path": path,
            "slot": slot,
            "multiplier": multiplier,
            "payout": payout,
            "net": net,
            "fair": fair,
        }
    return render_template(
        "plinko.html",
        result=result,
        rows=rows,
        risk=risk,
        multipliers=multipliers,
        format_multiplier=format_multiplier,
    )


@app.route("/api/plinko/drop", methods=["POST"])
@login_required
def api_plinko_drop():
    try:
        bet = parse_positive_int(request.form.get("bet"))
        rows = parse_positive_int(request.form.get("rows"), minimum=8, maximum=16)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    risk = request.form.get("risk", "medium")
    if risk not in PLINKO_RANGES:
        return jsonify({"error": "Choose Low, Medium, or High risk."}), 400
    error = debit_or_error(g.user["id"], bet, "Plinko bet")
    if error:
        get_db().commit()
        return jsonify({"error": error}), 400

    ctx = begin_fair("plinko", request.form.get("client_seed"))
    path = [ctx["rng"].randrange(2) for _ in range(rows)]
    slot = sum(path)
    multipliers = plinko_multipliers(rows, risk)
    multiplier = multipliers[slot]
    payout = int(bet * multiplier)
    net = settle_wager(g.user["id"], bet, payout, "Plinko")
    fair = finish_fair(
        "plinko",
        ctx["pending"],
        ctx["client_seed"],
        {
            "risk": risk,
            "rows": rows,
            "path": path,
            "slot": slot,
            "multiplier": multiplier,
            "payout": payout,
            "bet": bet,
            "net": net,
            "player_name": g.user["username"],
        },
    )
    get_db().commit()
    return jsonify(
        {
            "bet": bet,
            "risk": risk,
            "rows": rows,
            "path": path,
            "slot": slot,
            "multipliers": multipliers,
            "multiplier": multiplier,
            "multiplier_label": format_multiplier(multiplier),
            "payout": payout,
            "net": net,
            "balance": get_balance(g.user["id"]),
            "fair": fair,
        }
    )


@app.route("/api/plinko/multipliers")
@login_required
def api_plinko_multipliers():
    try:
        rows = parse_positive_int(request.args.get("rows"), minimum=8, maximum=16)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    risk = request.args.get("risk", "medium")
    if risk not in PLINKO_RANGES:
        return jsonify({"error": "Choose Low, Medium, or High risk."}), 400
    return jsonify({"rows": rows, "risk": risk, "multipliers": plinko_multipliers(rows, risk)})


def mines_multiplier(mine_count, revealed_count):
    revealed_count = int(revealed_count)
    mine_count = int(mine_count)
    safe_tiles = MINES_GRID_SIZE - mine_count
    if revealed_count <= 0:
        return 1.0
    if revealed_count > safe_tiles:
        return 0
    survival = math.comb(safe_tiles, revealed_count) / math.comb(MINES_GRID_SIZE, revealed_count)
    return round(MINES_RTP / survival, 4)


def mines_next_multiplier(mine_count, revealed_count):
    safe_tiles = MINES_GRID_SIZE - int(mine_count)
    if revealed_count >= safe_tiles:
        return None
    return mines_multiplier(mine_count, revealed_count + 1)


def mines_default_state():
    return {
        "active": False,
        "bet": 0,
        "mine_count": 3,
        "revealed": [],
        "mines": [],
        "multiplier": 1.0,
        "last": None,
    }


def mines_state(user_id):
    return get_state(f"mines:{user_id}", mines_default_state)


def mines_public(state):
    public = dict(state)
    public.pop("pending", None)
    public.pop("client_seed", None)
    public["revealed"] = list(state.get("revealed") or [])
    public["mine_count"] = int(state.get("mine_count") or 3)
    public["multiplier"] = float(state.get("multiplier") or 1.0)
    public["cashout"] = int(int(state.get("bet") or 0) * public["multiplier"]) if state.get("active") else 0
    public["next_multiplier"] = mines_next_multiplier(public["mine_count"], len(public["revealed"])) if state.get("active") else None
    if state.get("active"):
        public["mines"] = []
    else:
        public["mines"] = list(state.get("mines") or [])
    return public


def finish_mines_round(state, outcome, payout, selected=None):
    bet = int(state.get("bet") or 0)
    net = payout - bet
    fair = finish_fair(
        "mines",
        state["pending"],
        state["client_seed"],
        {
            "player_name": g.user["username"],
            "bet": bet,
            "mine_count": state["mine_count"],
            "revealed": state.get("revealed", []),
            "mines": state.get("mines", []),
            "selected": selected,
            "outcome": outcome,
            "multiplier": round(float(state.get("multiplier") or 1.0), 4),
            "payout": payout,
            "net": net,
        },
    )
    state["active"] = False
    state["last"] = {
        "outcome": outcome,
        "bet": bet,
        "payout": payout,
        "net": net,
        "multiplier": round(float(state.get("multiplier") or 1.0), 4),
        "selected": selected,
        "fair": fair,
    }
    state["pending"] = None
    state["client_seed"] = ""
    return state


@app.route("/mines")
@login_required
def mines():
    return render_template("mines.html", state=mines_public(mines_state(g.user["id"])))


@app.route("/api/mines/state")
@login_required
def api_mines_state():
    return jsonify({"state": mines_public(mines_state(g.user["id"])), "balance": get_balance(g.user["id"])})


@app.route("/api/mines/start", methods=["POST"])
@login_required
def api_mines_start():
    state = mines_state(g.user["id"])
    if state.get("active"):
        return jsonify({"error": "Cash out or hit a mine before starting another round."}), 400
    try:
        bet = parse_positive_int(request.form.get("bet"))
        mine_count = parse_positive_int(request.form.get("mines"), minimum=1, maximum=24)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    error = debit_or_error(g.user["id"], bet, "Mines bet")
    if error:
        get_db().commit()
        return jsonify({"error": error}), 400
    ctx = begin_fair("mines", request.form.get("client_seed"))
    mine_positions = sorted(ctx["rng"].sample(range(MINES_GRID_SIZE), mine_count))
    state = {
        "active": True,
        "bet": bet,
        "mine_count": mine_count,
        "revealed": [],
        "mines": mine_positions,
        "multiplier": 1.0,
        "pending": ctx["pending"],
        "client_seed": ctx["client_seed"],
        "last": None,
    }
    set_state(f"mines:{g.user['id']}", state)
    get_db().commit()
    return jsonify({"state": mines_public(state), "balance": get_balance(g.user["id"])})


@app.route("/api/mines/reveal", methods=["POST"])
@login_required
def api_mines_reveal():
    try:
        tile = parse_positive_int(request.form.get("tile"), minimum=0, maximum=MINES_GRID_SIZE - 1)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return reveal_mines_tile(tile)


def reveal_mines_tile(tile):
    state = mines_state(g.user["id"])
    if not state.get("active"):
        return jsonify({"error": "Start a Mines round first."}), 400
    if tile in state.get("revealed", []):
        return jsonify({"error": "That tile is already open."}), 400
    if tile in state.get("mines", []):
        state = finish_mines_round(state, "lose", 0, selected=tile)
        set_state(f"mines:{g.user['id']}", state)
        get_db().commit()
        return jsonify({"state": mines_public(state), "balance": get_balance(g.user["id"]), "outcome": "lose"})
    state.setdefault("revealed", []).append(tile)
    state["revealed"].sort()
    state["multiplier"] = mines_multiplier(state["mine_count"], len(state["revealed"]))
    safe_tiles = MINES_GRID_SIZE - int(state["mine_count"])
    outcome = "gem"
    if len(state["revealed"]) >= safe_tiles:
        payout = int(int(state["bet"]) * float(state["multiplier"]))
        change_balance(g.user["id"], payout, "Mines payout")
        state = finish_mines_round(state, "cashout", payout, selected=tile)
        outcome = "cashout"
    set_state(f"mines:{g.user['id']}", state)
    get_db().commit()
    return jsonify({"state": mines_public(state), "balance": get_balance(g.user["id"]), "outcome": outcome})


@app.route("/api/mines/random", methods=["POST"])
@login_required
def api_mines_random():
    state = mines_state(g.user["id"])
    if not state.get("active"):
        return jsonify({"error": "Start a Mines round first."}), 400
    unopened = [tile for tile in range(MINES_GRID_SIZE) if tile not in state.get("revealed", [])]
    if not unopened:
        return jsonify({"error": "No unopened tiles remain."}), 400
    return reveal_mines_tile(secrets.choice(unopened))


@app.route("/api/mines/cashout", methods=["POST"])
@login_required
def api_mines_cashout():
    state = mines_state(g.user["id"])
    if not state.get("active"):
        return jsonify({"error": "No active Mines round."}), 400
    payout = int(int(state["bet"]) * float(state.get("multiplier") or 1.0))
    if payout > 0:
        change_balance(g.user["id"], payout, "Mines payout")
    state = finish_mines_round(state, "cashout", payout)
    set_state(f"mines:{g.user['id']}", state)
    get_db().commit()
    return jsonify({"state": mines_public(state), "balance": get_balance(g.user["id"]), "outcome": "cashout"})


def slot_weighted_symbol(rng):
    total = sum(symbol["weight"] for symbol in SLOT_SYMBOLS)
    pick = rng.uniform(0, total)
    cursor = 0
    for symbol in SLOT_SYMBOLS:
        cursor += symbol["weight"]
        if pick <= cursor:
            return symbol
    return SLOT_SYMBOLS[-1]


def slot_spin_result(rng, bonus=False):
    reels = [slot_weighted_symbol(rng) for _ in range(5)]
    counts = {symbol["key"]: 0 for symbol in SLOT_SYMBOLS}
    for symbol in reels:
        counts[symbol["key"]] += 1
    best_key, best_count = max(counts.items(), key=lambda item: item[1])
    symbol = next(item for item in SLOT_SYMBOLS if item["key"] == best_key)
    multiplier = 0
    label = "No hit"
    if best_count >= 5:
        multiplier = symbol["pay"]
        label = f"Five {symbol['label']}"
    elif best_count == 4:
        multiplier = max(2, round(symbol["pay"] * 0.2, 2))
        label = f"Four {symbol['label']}"
    elif best_count == 3:
        multiplier = max(0.5, round(symbol["pay"] * 0.06, 2))
        label = f"Three {symbol['label']}"
    scatters = counts.get("star", 0)
    free_spins = 10 if scatters >= 3 else 0
    if bonus and multiplier:
        multiplier = round(multiplier * 1.25, 2)
    jackpot = best_key == "seven" and best_count == 5
    return {
        "reels": [{"key": symbol["key"], "label": symbol["label"]} for symbol in reels],
        "multiplier": multiplier,
        "label": "Jackpot" if jackpot else label,
        "free_spins": free_spins,
        "jackpot": jackpot,
    }


@app.route("/slots")
@login_required
def slots():
    return render_template(
        "slots.html",
        symbols=SLOT_SYMBOLS,
        bonus_spins=SLOT_BONUS_SPINS,
        bonus_cost_multiplier=SLOT_BONUS_COST_MULTIPLIER,
    )


@app.route("/api/slots/spin", methods=["POST"])
@login_required
def api_slots_spin():
    try:
        bet = parse_positive_int(request.form.get("bet"), minimum=1, maximum=100_000)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    mode = request.form.get("mode", "base")
    bonus = mode == "bonus"
    spins = SLOT_BONUS_SPINS if bonus else 1
    total_cost = bet * (SLOT_BONUS_COST_MULTIPLIER if bonus else 1)
    error = debit_or_error(g.user["id"], total_cost, "Slots bet")
    if error:
        get_db().commit()
        return jsonify({"error": error}), 400
    ctx = begin_fair("slots", request.form.get("client_seed"))
    results = []
    payout = 0
    awarded_free_spins = 0
    jackpot = False
    for index in range(spins):
        spin_rng = fair_rng(ctx["pending"]["server_seed"], ctx["client_seed"], ctx["pending"]["nonce"], "slots", f"spin-{index}")
        spin = slot_spin_result(spin_rng, bonus=bonus)
        spin_payout = int(bet * float(spin["multiplier"]))
        spin["payout"] = spin_payout
        payout += spin_payout
        awarded_free_spins += int(spin.get("free_spins") or 0)
        jackpot = jackpot or bool(spin.get("jackpot"))
        results.append(spin)
    net = payout - total_cost
    if payout > 0:
        change_balance(g.user["id"], payout, "Slots payout")
    fair = finish_fair(
        "slots",
        ctx["pending"],
        ctx["client_seed"],
        {
            "player_name": g.user["username"],
            "bet": total_cost,
            "base_bet": bet,
            "mode": mode,
            "spins": spins,
            "results": results,
            "payout": payout,
            "net": net,
            "multiplier": round(payout / total_cost, 4) if total_cost else 0,
            "jackpot": jackpot,
        },
    )
    get_db().commit()
    return jsonify(
        {
            "bet": total_cost,
            "base_bet": bet,
            "mode": mode,
            "spins": spins,
            "results": results,
            "payout": payout,
            "net": net,
            "multiplier": round(payout / total_cost, 4) if total_cost else 0,
            "free_spins": awarded_free_spins,
            "jackpot": jackpot,
            "balance": get_balance(g.user["id"]),
            "fair": fair,
        }
    )


def hilo_card_value(card):
    return HILO_VALUE[card["rank"]]


def hilo_draw_card(rng):
    return {"rank": rng.choice(HILO_RANKS), "suit": rng.choice(SUITS)}


def hilo_build_queue(rng, count=120):
    return [hilo_draw_card(rng) for _ in range(count)]


def hilo_multiplier(current, guess):
    value = hilo_card_value(current)
    if guess == "higher":
        winning_ranks = len(HILO_RANKS) - value + 1
    else:
        winning_ranks = value
    probability = winning_ranks / len(HILO_RANKS)
    multiplier = (1 - HILO_HOUSE_EDGE) / probability
    return {
        "chance": round(probability * 100, 2),
        "multiplier": round(multiplier, 4),
        "winning_ranks": winning_ranks,
    }


def hilo_options(current):
    return {
        "higher": hilo_multiplier(current, "higher"),
        "lower": hilo_multiplier(current, "lower"),
    }


def hilo_default_state(user_id):
    return {
        "active": False,
        "current": None,
        "bet": 0,
        "multiplier": 1.0,
        "history": [],
        "last": None,
    }


def get_hilo_state(user_id):
    state = get_state(f"hilo:{user_id}", lambda: hilo_default_state(user_id))
    last_fair = (state.get("last") or {}).get("fair") or {}
    if "active" not in state or (not state.get("active") and last_fair.get("game") == "hilo_initial"):
        state = hilo_default_state(user_id)
        set_state(f"hilo:{user_id}", state)
    get_db().commit()
    return state


def hilo_public_state(state):
    current = state.get("current")
    bet = int(state.get("bet") or 0)
    multiplier = float(state.get("multiplier") or 1.0)
    public = dict(state)
    public.pop("queue", None)
    public.pop("pending", None)
    public.pop("client_seed", None)
    public["has_card"] = current is not None
    public["current"] = current or {"hidden": True}
    public["options"] = hilo_options(current) if current else None
    public["cashout"] = int(bet * multiplier) if state.get("active") else 0
    public["history"] = list(reversed(state.get("history", [])[-9:]))
    return public


def hilo_finish_round(state, outcome, payout, extra_result=None):
    extra_result = extra_result or {}
    bet = int(state.get("bet") or 0)
    result_json = {
        "outcome": outcome,
        "player_name": g.user["username"],
        "bet": bet,
        "payout": payout,
        "net": payout - bet,
        "multiplier": round(float(state.get("multiplier") or 1.0), 4),
        "current": card_label(state.get("current")),
        "history": [
            {
                "action": item.get("action"),
                "guess": item.get("guess"),
                "previous": card_label(item["previous"]) if item.get("previous") else None,
                "next": card_label(item["next"]) if item.get("next") else None,
                "multiplier": item.get("multiplier"),
                "outcome": item.get("outcome"),
            }
            for item in state.get("history", [])
        ],
    }
    result_json.update(extra_result)
    fair = finish_fair("hilo", state["pending"], state["client_seed"], result_json)
    net = payout - bet
    state["active"] = False
    state["bet"] = 0
    state["queue"] = []
    state["pending"] = None
    state["client_seed"] = ""
    state["last"] = {
        "outcome": outcome,
        "bet": bet,
        "payout": payout,
        "net": net,
        "multiplier": result_json["multiplier"],
        "fair": fair,
    }
    return net, fair


@app.route("/hilo", methods=["GET", "POST"])
@login_required
def hilo():
    key = f"hilo:{g.user['id']}"
    state = get_hilo_state(g.user["id"])
    if request.method == "POST":
        action = request.form.get("action", "start")
        if action == "start":
            if state.get("active"):
                flash("Cash out or finish the active Hi-Lo round first.", "error")
                return redirect(url_for("hilo"))
            try:
                bet = parse_positive_int(request.form.get("bet"))
            except ValueError as exc:
                flash(str(exc), "error")
                return redirect(url_for("hilo"))
            error = debit_or_error(g.user["id"], bet, "Hi-Lo bet")
            if error:
                flash(error, "error")
                get_db().commit()
                return redirect(url_for("hilo"))
            ctx = begin_fair("hilo", request.form.get("client_seed"))
            queue = hilo_build_queue(ctx["rng"])
            state = {
                "active": True,
                "current": queue.pop(0),
                "queue": queue,
                "bet": bet,
                "multiplier": 1.0,
                "history": [],
                "skips": 0,
                "pending": ctx["pending"],
                "client_seed": ctx["client_seed"],
                "last": None,
            }
            flash("Hi-Lo round started.", "success")
        elif action in {"higher", "lower"}:
            if not state.get("active"):
                flash("Start a Hi-Lo round first.", "error")
                return redirect(url_for("hilo"))
            queue = state.get("queue") or []
            if not queue:
                payout = int(int(state.get("bet") or 0) * float(state.get("multiplier") or 1.0))
                if payout > 0:
                    change_balance(g.user["id"], payout, "Hi-Lo payout")
                hilo_finish_round(state, "cashout", payout, {"reason": "card queue complete"})
                flash("Full card queue complete. Cashout paid.", "success")
            else:
                previous = state["current"]
                next_card = queue.pop(0)
                option = hilo_multiplier(previous, action)
                current_value = hilo_card_value(previous)
                next_value = hilo_card_value(next_card)
                won = next_value >= current_value if action == "higher" else next_value <= current_value
                if won:
                    state["multiplier"] = round(float(state.get("multiplier") or 1.0) * option["multiplier"], 4)
                    state["current"] = next_card
                    state["queue"] = queue
                    state.setdefault("history", []).append(
                        {
                            "action": "guess",
                            "guess": action,
                            "previous": previous,
                            "next": next_card,
                            "outcome": "win",
                            "chance": option["chance"],
                            "multiplier": state["multiplier"],
                        }
                    )
                else:
                    state["current"] = next_card
                    state["queue"] = queue
                    state.setdefault("history", []).append(
                        {
                            "action": "guess",
                            "guess": action,
                            "previous": previous,
                            "next": next_card,
                            "outcome": "lose",
                            "chance": option["chance"],
                            "multiplier": state.get("multiplier", 1.0),
                        }
                    )
                    hilo_finish_round(
                        state,
                        "lose",
                        0,
                        {
                            "guess": action,
                            "previous": card_label(previous),
                            "next": card_label(next_card),
                        },
                    )
                    flash("Wrong call. The Hi-Lo wager was lost.", "error")
        elif action == "skip":
            if not state.get("active"):
                flash("Start a Hi-Lo round first.", "error")
                return redirect(url_for("hilo"))
            if int(state.get("skips") or 0) >= HILO_MAX_SKIPS:
                flash("Skip limit reached for this round.", "error")
                return redirect(url_for("hilo"))
            queue = state.get("queue") or []
            if not queue:
                flash("No more cards to skip.", "error")
                return redirect(url_for("hilo"))
            previous = state["current"]
            next_card = queue.pop(0)
            state["current"] = next_card
            state["queue"] = queue
            state["skips"] = int(state.get("skips") or 0) + 1
            state.setdefault("history", []).append(
                {
                    "action": "skip",
                    "previous": previous,
                    "next": next_card,
                    "outcome": "skip",
                    "multiplier": state.get("multiplier", 1.0),
                }
            )
        elif action == "cashout":
            if not state.get("active"):
                flash("There is no active Hi-Lo round to cash out.", "error")
                return redirect(url_for("hilo"))
            bet = int(state.get("bet") or 0)
            payout = int(bet * float(state.get("multiplier") or 1.0))
            if payout > 0:
                change_balance(g.user["id"], payout, "Hi-Lo payout")
            net, _fair = hilo_finish_round(state, "cashout", payout)
            flash(f"Cashed out for {format_chips(payout)} chips ({net:+d}).", "success")
        elif action == "reset":
            if state.get("active"):
                flash("Cash out or finish the active Hi-Lo round first.", "error")
                return redirect(url_for("hilo"))
            state = hilo_default_state(g.user["id"])
        else:
            flash("Unknown Hi-Lo action.", "error")
            return redirect(url_for("hilo"))
        set_state(key, state)
        get_db().commit()
        return redirect(url_for("hilo"))
    return render_template("hilo.html", state=hilo_public_state(state))


@app.route("/hilo/reset", methods=["POST"])
@login_required
def hilo_reset():
    state = get_hilo_state(g.user["id"])
    if state.get("active"):
        flash("Cash out or finish the active Hi-Lo round first.", "error")
    else:
        state = hilo_default_state(g.user["id"])
        set_state(f"hilo:{g.user['id']}", state)
        get_db().commit()
    return redirect(url_for("hilo"))


def default_blackjack_state():
    return {
        "phase": "waiting",
        "players": {},
        "dealer": {"hand": []},
        "deck": [],
        "turn_order": [],
        "turn_index": 0,
        "round": 0,
        "pending": new_pending_seed("blackjack"),
        "fair": None,
        "log": ["Table open."],
    }


def blackjack_state():
    return get_state(table_key("blackjack"), default_blackjack_state)


def reset_blackjack_for_betting(state):
    for player in state["players"].values():
        player.update(
            {
                "bet": 0,
                "pair_bet": 0,
                "plus3_bet": 0,
                "side_payout": 0,
                "side_results": [],
                "client_seed": "",
                "hand": [],
                "split_hands": [],
                "active_hand": 0,
                "status": "seated",
                "result": "",
                "payout": 0,
            }
        )
    state.update(
        {
            "phase": "waiting",
            "dealer": {"hand": []},
            "deck": [],
            "turn_order": [],
            "turn_index": 0,
            "pending": new_pending_seed("blackjack"),
            "fair": None,
            "log": ["New shoe ready."],
        }
    )


def blackjack_seated_user(state, user_id):
    return state["players"].get(str(user_id))


def blackjack_three_card_side(player_cards, dealer_upcard):
    cards = player_cards[:2] + [dealer_upcard]
    if len(cards) < 3 or not dealer_upcard:
        return {"name": "No result", "odds": 0}
    ranks = sorted([card_rank_value(card) for card in cards])
    suits = {card["suit"] for card in cards}
    same_rank = len({card["rank"] for card in cards}) == 1
    flush = len(suits) == 1
    straight = ranks == list(range(ranks[0], ranks[0] + 3)) or ranks == [2, 3, 14]
    if same_rank and flush:
        return {"name": "Suited trips", "odds": 100}
    if straight and flush:
        return {"name": "Straight flush", "odds": 40}
    if same_rank:
        return {"name": "Trips", "odds": 30}
    if straight:
        return {"name": "Straight", "odds": 10}
    if flush:
        return {"name": "Flush", "odds": 5}
    return {"name": "No 21+3", "odds": 0}


def blackjack_pair_side(player_cards):
    if len(player_cards) < 2:
        return {"name": "No pair", "odds": 0}
    first, second = player_cards[:2]
    if first["rank"] != second["rank"]:
        return {"name": "No pair", "odds": 0}
    if first["suit"] == second["suit"]:
        return {"name": "Perfect pair", "odds": 25}
    if (first["suit"] in {"H", "D"}) == (second["suit"] in {"H", "D"}):
        return {"name": "Colored pair", "odds": 12}
    return {"name": "Mixed pair", "odds": 6}


def blackjack_apply_side_bets(player, dealer_upcard):
    player["side_results"] = []
    player["side_payout"] = 0
    if int(player.get("pair_bet") or 0) > 0:
        pair = blackjack_pair_side(player["hand"])
        payout = int(player["pair_bet"]) * (pair["odds"] + 1) if pair["odds"] else 0
        player["side_payout"] += payout
        player["side_results"].append({"name": pair["name"], "bet": int(player["pair_bet"]), "payout": payout})
    if int(player.get("plus3_bet") or 0) > 0:
        plus3 = blackjack_three_card_side(player["hand"], dealer_upcard)
        payout = int(player["plus3_bet"]) * (plus3["odds"] + 1) if plus3["odds"] else 0
        player["side_payout"] += payout
        player["side_results"].append({"name": plus3["name"], "bet": int(player["plus3_bet"]), "payout": payout})


def blackjack_current_hand(player):
    split_hands = player.get("split_hands") or []
    if split_hands:
        index = max(0, min(int(player.get("active_hand") or 0), len(split_hands) - 1))
        return split_hands[index]
    return {"cards": player.get("hand", []), "bet": int(player.get("bet") or 0), "status": player.get("status", "seated")}


def blackjack_can_split(player):
    cards = player.get("hand") or []
    return not player.get("split_hands") and len(cards) == 2 and cards[0]["rank"] == cards[1]["rank"]


def blackjack_advance_player_hand(player):
    split_hands = player.get("split_hands") or []
    if not split_hands:
        return True
    index = int(player.get("active_hand") or 0)
    if index + 1 < len(split_hands):
        player["active_hand"] = index + 1
        return False
    player["status"] = "stand"
    return True


def blackjack_settle_hand(cards, bet, dealer_total, dealer_blackjack):
    total = blackjack_total(cards)
    natural = total == 21 and len(cards) == 2
    payout = 0
    if total > 21:
        result = "Bust"
    elif dealer_blackjack and natural:
        payout = bet
        result = "Push"
    elif dealer_blackjack:
        result = "Dealer blackjack"
    elif natural:
        payout = bet + int(bet * 1.5)
        result = "Blackjack"
    elif dealer_total > 21:
        payout = bet * 2
        result = "Dealer bust"
    elif total > dealer_total:
        payout = bet * 2
        result = "Win"
    elif total == dealer_total:
        payout = bet
        result = "Push"
    else:
        result = "Lose"
    return {"cards": cards, "total": total, "bet": bet, "result": result, "payout": payout}


def blackjack_public(state, user_id):
    data = json.loads(json.dumps(state))
    if data["phase"] in {"playing", "dealer"} and data["dealer"]["hand"]:
        data["dealer"]["hand"] = [data["dealer"]["hand"][0], {"hidden": True}]
    data.pop("deck", None)
    if data.get("pending"):
        data["pending"] = {"server_seed_hash": data["pending"]["server_seed_hash"], "nonce": data["pending"]["nonce"]}
    for uid, player in data["players"].items():
        snapshot = safe_user_snapshot(int(uid))
        player["balance"] = snapshot["balance"]
        player["can_split"] = blackjack_can_split(player) and snapshot["balance"] >= int(player.get("bet") or 0)
        current_hand = blackjack_current_hand(player)
        player["can_double"] = player.get("status") == "playing" and len(current_hand.get("cards", [])) == 2 and snapshot["balance"] >= int(current_hand.get("bet") or 0)
    data["me"] = str(user_id)
    data["my_balance"] = get_balance(user_id)
    data["current_turn"] = data["turn_order"][data["turn_index"]] if data["phase"] == "playing" and data["turn_order"] else None
    return data


def next_blackjack_turn(state):
    while state["turn_index"] < len(state["turn_order"]):
        uid = state["turn_order"][state["turn_index"]]
        player = state["players"].get(uid)
        if player and player["status"] == "playing":
            return
        state["turn_index"] += 1
    resolve_blackjack(state)


def resolve_blackjack(state):
    state["phase"] = "dealer"
    dealer = state["dealer"]["hand"]
    dealer_blackjack = blackjack_total(dealer) == 21 and len(dealer) == 2
    live_players = [p for p in state["players"].values() if p.get("bet", 0) > 0]
    if any(player["status"] not in {"bust"} for player in live_players) and not dealer_blackjack:
        while blackjack_total(dealer) < 17:
            dealer.append(state["deck"].pop())
    dealer_total = blackjack_total(dealer)
    for uid, player in state["players"].items():
        if player.get("bet", 0) <= 0:
            continue
        hand_results = []
        if player.get("split_hands"):
            for hand in player["split_hands"]:
                result = blackjack_settle_hand(hand.get("cards", []), int(hand.get("bet") or 0), dealer_total, dealer_blackjack)
                hand.update({"status": "done", "result": result["result"], "payout": result["payout"]})
                hand_results.append(result)
        else:
            result = blackjack_settle_hand(player["hand"], int(player["bet"]), dealer_total, dealer_blackjack)
            hand_results.append(result)
        payout = sum(item["payout"] for item in hand_results) + int(player.get("side_payout") or 0)
        result = " / ".join(item["result"] for item in hand_results)
        player["status"] = "done"
        player["result"] = result
        player["payout"] = payout
        if payout:
            change_balance(int(uid), payout, "Blackjack payout")
    state["phase"] = "resolved"
    state["fair"] = finish_fair(
        "blackjack",
        state["pending"],
        state.get("client_seed", "table"),
        {
            "player_name": "Blackjack table",
            "net": 0,
            "dealer": [card_label(card) for card in state["dealer"]["hand"]],
            "players": {
                uid: {
                    "hand": [card_label(card) for card in player["hand"]],
                    "split_hands": [
                        {
                            "cards": [card_label(card) for card in hand.get("cards", [])],
                            "result": hand.get("result", ""),
                            "payout": hand.get("payout", 0),
                        }
                        for hand in player.get("split_hands", [])
                    ],
                    "side_results": player.get("side_results", []),
                    "result": player.get("result", ""),
                    "payout": player.get("payout", 0),
                }
                for uid, player in state["players"].items()
                if player.get("bet", 0) > 0
            },
        },
    )
    state["log"].append("Round settled and seed revealed.")


@app.route("/blackjack")
@login_required
def blackjack():
    selected_table = table_number() if "table" in request.args else None
    return render_template("blackjack.html", table_number=selected_table, tables=table_summaries("blackjack"))


@app.route("/api/blackjack/state")
@login_required
def api_blackjack_state():
    return jsonify(blackjack_public(blackjack_state(), g.user["id"]))


@app.route("/api/blackjack/join", methods=["POST"])
@login_required
def api_blackjack_join():
    state = blackjack_state()
    if str(g.user["id"]) not in state["players"]:
        if len(state["players"]) >= 5:
            return jsonify({"error": "This blackjack table is full."}), 400
        used = {player["seat"] for player in state["players"].values()}
        seat = next(number for number in range(1, 6) if number not in used)
        state["players"][str(g.user["id"])] = {
            "username": g.user["username"],
            "seat": seat,
            "bet": 0,
            "pair_bet": 0,
            "plus3_bet": 0,
            "side_payout": 0,
            "side_results": [],
            "client_seed": "",
            "hand": [],
            "split_hands": [],
            "active_hand": 0,
            "status": "seated",
            "result": "",
            "payout": 0,
        }
        state["log"].append(f"{g.user['username']} sat in seat {seat}.")
    set_state(table_key("blackjack"), state)
    get_db().commit()
    return jsonify(blackjack_public(state, g.user["id"]))


@app.route("/api/blackjack/leave", methods=["POST"])
@login_required
def api_blackjack_leave():
    state = blackjack_state()
    if state["phase"] not in {"waiting", "resolved"}:
        return jsonify({"error": "You can leave after the active blackjack hand ends."}), 400
    state["players"].pop(str(g.user["id"]), None)
    if not state["players"]:
        state = default_blackjack_state()
    set_state(table_key("blackjack"), state)
    get_db().commit()
    return jsonify(blackjack_public(state, g.user["id"]))


@app.route("/api/blackjack/bet", methods=["POST"])
@login_required
def api_blackjack_bet():
    state = blackjack_state()
    if state["phase"] == "resolved":
        reset_blackjack_for_betting(state)
    if state["phase"] not in {"waiting", "betting"}:
        return jsonify({"error": "Betting is closed for this hand."}), 400
    player = blackjack_seated_user(state, g.user["id"])
    if not player:
        return jsonify({"error": "Join the blackjack table first."}), 400
    try:
        bet = parse_positive_int(request.form.get("bet"), minimum=1, maximum=100_000)
        pair_bet = parse_positive_int(request.form.get("pair_bet") or 0, minimum=0, maximum=100_000)
        plus3_bet = parse_positive_int(request.form.get("plus3_bet") or 0, minimum=0, maximum=100_000)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    total_bet = bet + pair_bet + plus3_bet
    if get_balance(g.user["id"]) < total_bet:
        return jsonify({"error": "Not enough fake chips for that bet."}), 400
    player.update(
        {
            "bet": bet,
            "pair_bet": pair_bet,
            "plus3_bet": plus3_bet,
            "side_payout": 0,
            "side_results": [],
            "client_seed": request.form.get("client_seed", "").strip(),
            "status": "ready",
            "hand": [],
            "split_hands": [],
            "active_hand": 0,
            "result": "",
            "payout": 0,
        }
    )
    state["phase"] = "betting"
    state["log"].append(f"{g.user['username']} placed {format_chips(total_bet)}.")
    set_state(table_key("blackjack"), state)
    get_db().commit()
    return jsonify(blackjack_public(state, g.user["id"]))


@app.route("/api/blackjack/start", methods=["POST"])
@login_required
def api_blackjack_start():
    state = blackjack_state()
    if state["phase"] == "resolved":
        reset_blackjack_for_betting(state)
    if state["phase"] not in {"waiting", "betting"}:
        return jsonify({"error": "A blackjack hand is already running."}), 400
    active = [(uid, player) for uid, player in state["players"].items() if player.get("bet", 0) > 0]
    if not active:
        return jsonify({"error": "At least one seated player needs a bet."}), 400
    for uid, player in active:
        total_bet = int(player["bet"]) + int(player.get("pair_bet") or 0) + int(player.get("plus3_bet") or 0)
        if get_balance(int(uid)) < total_bet:
            return jsonify({"error": f"{player['username']} no longer has enough chips."}), 400
    client_seed = "|".join(
        f"{uid}:{player.get('client_seed') or player['username']}:{player['bet']}:{player.get('pair_bet', 0)}:{player.get('plus3_bet', 0)}"
        for uid, player in sorted(active)
    )
    rng = fair_rng(state["pending"]["server_seed"], client_seed, state["pending"]["nonce"], "blackjack")
    state["client_seed"] = client_seed
    state["deck"] = new_deck(rng)
    state["dealer"] = {"hand": []}
    state["round"] += 1
    for uid, player in active:
        total_bet = int(player["bet"]) + int(player.get("pair_bet") or 0) + int(player.get("plus3_bet") or 0)
        change_balance(int(uid), -total_bet, "Blackjack bet")
        player["hand"] = []
        player["split_hands"] = []
        player["active_hand"] = 0
        player["status"] = "playing"
        player["result"] = ""
        player["payout"] = 0
        player["side_payout"] = 0
        player["side_results"] = []
    ordered = [uid for uid, player in sorted(active, key=lambda item: item[1]["seat"])]
    for _ in range(2):
        for uid in ordered:
            state["players"][uid]["hand"].append(state["deck"].pop())
        state["dealer"]["hand"].append(state["deck"].pop())
    for uid in ordered:
        blackjack_apply_side_bets(state["players"][uid], state["dealer"]["hand"][0])
    for uid in ordered:
        if blackjack_total(state["players"][uid]["hand"]) == 21:
            state["players"][uid]["status"] = "stand"
    state["turn_order"] = [uid for uid in ordered if state["players"][uid]["status"] == "playing"]
    state["turn_index"] = 0
    state["phase"] = "playing"
    state["log"].append(f"Blackjack round {state['round']} started.")
    if blackjack_total(state["dealer"]["hand"]) == 21 or not state["turn_order"]:
        resolve_blackjack(state)
    else:
        next_blackjack_turn(state)
    set_state(table_key("blackjack"), state)
    get_db().commit()
    return jsonify(blackjack_public(state, g.user["id"]))


@app.route("/api/blackjack/action", methods=["POST"])
@login_required
def api_blackjack_action():
    state = blackjack_state()
    if state["phase"] != "playing" or not state["turn_order"]:
        return jsonify({"error": "No blackjack action is available."}), 400
    current_uid = state["turn_order"][state["turn_index"]]
    if current_uid != str(g.user["id"]):
        return jsonify({"error": "It is not your turn."}), 400
    action = request.form.get("action")
    player = state["players"][current_uid]
    current = blackjack_current_hand(player)
    cards = current.get("cards", [])
    hand_bet = int(current.get("bet") or player.get("bet") or 0)
    if action == "hit":
        cards.append(state["deck"].pop())
        total = blackjack_total(cards)
        if total > 21:
            if player.get("split_hands"):
                current["status"] = "bust"
            else:
                player["status"] = "bust"
            if blackjack_advance_player_hand(player):
                state["turn_index"] += 1
        elif total == 21:
            if player.get("split_hands"):
                current["status"] = "stand"
            else:
                player["status"] = "stand"
            if blackjack_advance_player_hand(player):
                state["turn_index"] += 1
    elif action == "stand":
        if player.get("split_hands"):
            current["status"] = "stand"
        else:
            player["status"] = "stand"
        if blackjack_advance_player_hand(player):
            state["turn_index"] += 1
    elif action == "double":
        if len(cards) != 2:
            return jsonify({"error": "Double is only available on the first two cards of a hand."}), 400
        if get_balance(g.user["id"]) < hand_bet:
            return jsonify({"error": "Not enough fake chips to double."}), 400
        change_balance(g.user["id"], -hand_bet, "Blackjack bet")
        if player.get("split_hands"):
            current["bet"] = hand_bet * 2
        else:
            player["bet"] = int(player["bet"]) + hand_bet
        cards.append(state["deck"].pop())
        if blackjack_total(cards) > 21:
            if player.get("split_hands"):
                current["status"] = "bust"
            else:
                player["status"] = "bust"
        else:
            if player.get("split_hands"):
                current["status"] = "stand"
            else:
                player["status"] = "stand"
        if blackjack_advance_player_hand(player):
            state["turn_index"] += 1
    elif action == "split":
        if not blackjack_can_split(player):
            return jsonify({"error": "Split is only available when your first two cards have the same rank."}), 400
        if get_balance(g.user["id"]) < int(player["bet"]):
            return jsonify({"error": "Not enough fake chips to split."}), 400
        change_balance(g.user["id"], -int(player["bet"]), "Blackjack bet")
        first, second = player["hand"]
        player["split_hands"] = [
            {"cards": [first, state["deck"].pop()], "bet": int(player["bet"]), "status": "playing", "result": "", "payout": 0},
            {"cards": [second, state["deck"].pop()], "bet": int(player["bet"]), "status": "playing", "result": "", "payout": 0},
        ]
        player["active_hand"] = 0
        player["status"] = "playing"
        player["bet"] = int(player["bet"]) * 2
    else:
        return jsonify({"error": "Unknown blackjack action."}), 400
    next_blackjack_turn(state)
    set_state(table_key("blackjack"), state)
    get_db().commit()
    return jsonify(blackjack_public(state, g.user["id"]))


def default_holdem_state():
    return {
        "phase": "waiting",
        "players": {},
        "deck": [],
        "community": [],
        "pot": 0,
        "current_bet": 0,
        "dealer_seat": 0,
        "turn_user": None,
        "acted": [],
        "round": 0,
        "pending": new_pending_seed("texas_holdem"),
        "fair": None,
        "log": ["Poker table open."],
    }


def holdem_state():
    return get_state(table_key("holdem"), default_holdem_state)


def holdem_order(state):
    return [uid for uid, player in sorted(state["players"].items(), key=lambda item: item[1]["seat"])]


def active_holdem_uids(state):
    return [uid for uid in holdem_order(state) if state["players"][uid].get("status") == "active"]


def next_uid_after(state, seat, candidates=None):
    ordered = holdem_order(state)
    if candidates is None:
        candidates = ordered
    candidates = set(candidates)
    after = [uid for uid in ordered if state["players"][uid]["seat"] > seat] + [uid for uid in ordered if state["players"][uid]["seat"] <= seat]
    for uid in after:
        if uid in candidates:
            return uid
    return None


def reset_holdem_after_result(state):
    for player in state["players"].values():
        player.update({"hand": [], "status": "seated", "bet_current": 0, "total_bet": 0, "client_seed": ""})
    state.update(
        {
            "phase": "waiting",
            "deck": [],
            "community": [],
            "pot": 0,
            "current_bet": 0,
            "turn_user": None,
            "acted": [],
            "pending": new_pending_seed("texas_holdem"),
            "fair": None,
            "log": ["New Hold'em hand ready."],
        }
    )


def holdem_public(state, user_id):
    data = json.loads(json.dumps(state))
    data.pop("deck", None)
    if data.get("pending"):
        data["pending"] = {"server_seed_hash": data["pending"]["server_seed_hash"], "nonce": data["pending"]["nonce"]}
    reveal = data["phase"] in {"showdown", "resolved"}
    for uid, player in data["players"].items():
        snapshot = safe_user_snapshot(int(uid))
        player["balance"] = snapshot["balance"]
        if uid != str(user_id) and not reveal:
            player["hand"] = [{"hidden": True}, {"hidden": True}] if player.get("hand") else []
    data["me"] = str(user_id)
    data["my_balance"] = get_balance(user_id)
    return data


def holdem_finish_by_fold(state):
    winners = active_holdem_uids(state)
    if not winners:
        state["phase"] = "resolved"
        return
    winner = winners[0]
    payout = int(state["pot"])
    change_balance(int(winner), payout, "Texas Hold'em pot")
    state["players"][winner]["result"] = f"Won {format_chips(payout)} by fold"
    state["phase"] = "resolved"
    state["turn_user"] = None
    state["fair"] = finish_fair(
        "texas_holdem",
        state["pending"],
        state.get("client_seed", "table"),
        {
            "player_name": state["players"][winner]["username"],
            "net": payout,
            "winner": state["players"][winner]["username"],
            "pot": state["pot"],
            "community": [card_label(card) for card in state["community"]],
            "mode": "fold",
        },
    )
    state["log"].append(f"{state['players'][winner]['username']} wins the pot.")


def holdem_showdown(state):
    active = active_holdem_uids(state)
    scores = {}
    for uid in active:
        player = state["players"][uid]
        best = evaluate_best(player["hand"] + state["community"])
        player["best_hand"] = best
        scores[uid] = best["score"]
    max_score = max(scores.values())
    winners = [uid for uid, score in scores.items() if score == max_score]
    share = state["pot"] // len(winners)
    remainder = state["pot"] % len(winners)
    for index, uid in enumerate(winners):
        payout = share + (remainder if index == 0 else 0)
        change_balance(int(uid), payout, "Texas Hold'em pot")
        state["players"][uid]["result"] = f"Won {format_chips(payout)} with {state['players'][uid]['best_hand']['name']}"
    for uid in active:
        if uid not in winners:
            state["players"][uid]["result"] = state["players"][uid]["best_hand"]["name"]
    state["phase"] = "showdown"
    state["turn_user"] = None
    state["fair"] = finish_fair(
        "texas_holdem",
        state["pending"],
        state.get("client_seed", "table"),
        {
            "player_name": ", ".join(state["players"][uid]["username"] for uid in winners),
            "net": state["pot"],
            "winners": [state["players"][uid]["username"] for uid in winners],
            "pot": state["pot"],
            "community": [card_label(card) for card in state["community"]],
            "hands": {
                uid: [card_label(card) for card in state["players"][uid]["hand"]]
                for uid in state["players"]
            },
        },
    )
    state["log"].append("Showdown complete and seed revealed.")


def holdem_advance_street(state):
    active = active_holdem_uids(state)
    if len(active) <= 1:
        holdem_finish_by_fold(state)
        return
    if state["phase"] == "preflop":
        state["deck"].pop()
        state["community"].extend([state["deck"].pop(), state["deck"].pop(), state["deck"].pop()])
        state["phase"] = "flop"
    elif state["phase"] == "flop":
        state["deck"].pop()
        state["community"].append(state["deck"].pop())
        state["phase"] = "turn"
    elif state["phase"] == "turn":
        state["deck"].pop()
        state["community"].append(state["deck"].pop())
        state["phase"] = "river"
    elif state["phase"] == "river":
        holdem_showdown(state)
        return
    for uid in active:
        state["players"][uid]["bet_current"] = 0
    state["current_bet"] = 0
    state["acted"] = []
    dealer_seat = state["dealer_seat"]
    state["turn_user"] = next_uid_after(state, dealer_seat, active)
    state["log"].append(state["phase"].title() + " dealt.")


def holdem_betting_complete(state):
    active = active_holdem_uids(state)
    if len(active) <= 1:
        return True
    return all(uid in state["acted"] and state["players"][uid]["bet_current"] == state["current_bet"] for uid in active)


def holdem_next_turn(state, current_uid):
    active = active_holdem_uids(state)
    if len(active) <= 1:
        holdem_finish_by_fold(state)
        return
    if holdem_betting_complete(state):
        holdem_advance_street(state)
        return
    current_seat = state["players"][current_uid]["seat"]
    state["turn_user"] = next_uid_after(state, current_seat, active)


@app.route("/texas-holdem")
@login_required
def holdem():
    selected_table = table_number() if "table" in request.args else None
    return render_template("holdem.html", table_number=selected_table, tables=table_summaries("holdem"))


@app.route("/api/holdem/state")
@login_required
def api_holdem_state():
    return jsonify(holdem_public(holdem_state(), g.user["id"]))


@app.route("/api/holdem/join", methods=["POST"])
@login_required
def api_holdem_join():
    state = holdem_state()
    if str(g.user["id"]) not in state["players"]:
        if len(state["players"]) >= 8:
            return jsonify({"error": "This Hold'em table is full."}), 400
        used = {player["seat"] for player in state["players"].values()}
        seat = next(number for number in range(1, 9) if number not in used)
        state["players"][str(g.user["id"])] = {
            "username": g.user["username"],
            "seat": seat,
            "hand": [],
            "status": "seated",
            "bet_current": 0,
            "total_bet": 0,
            "client_seed": "",
            "result": "",
        }
        state["log"].append(f"{g.user['username']} joined seat {seat}.")
    set_state(table_key("holdem"), state)
    get_db().commit()
    return jsonify(holdem_public(state, g.user["id"]))


@app.route("/api/holdem/leave", methods=["POST"])
@login_required
def api_holdem_leave():
    state = holdem_state()
    if state["phase"] not in {"waiting", "resolved", "showdown"}:
        return jsonify({"error": "You can leave after the current poker hand ends."}), 400
    state["players"].pop(str(g.user["id"]), None)
    if not state["players"]:
        state = default_holdem_state()
    set_state(table_key("holdem"), state)
    get_db().commit()
    return jsonify(holdem_public(state, g.user["id"]))


@app.route("/api/holdem/seed", methods=["POST"])
@login_required
def api_holdem_seed():
    state = holdem_state()
    if state["phase"] in {"resolved", "showdown"}:
        reset_holdem_after_result(state)
    if state["phase"] != "waiting":
        return jsonify({"error": "Client seeds can only be set before the hand."}), 400
    player = state["players"].get(str(g.user["id"]))
    if not player:
        return jsonify({"error": "Join the poker table first."}), 400
    player["client_seed"] = request.form.get("client_seed", "").strip()
    state["log"].append(f"{g.user['username']} updated a client seed.")
    set_state(table_key("holdem"), state)
    get_db().commit()
    return jsonify(holdem_public(state, g.user["id"]))


@app.route("/api/holdem/start", methods=["POST"])
@login_required
def api_holdem_start():
    state = holdem_state()
    if state["phase"] in {"resolved", "showdown"}:
        reset_holdem_after_result(state)
    if state["phase"] != "waiting":
        return jsonify({"error": "A Hold'em hand is already running."}), 400
    if str(g.user["id"]) not in state["players"]:
        return jsonify({"error": "Join the table first."}), 400
    capable = [uid for uid in holdem_order(state) if get_balance(int(uid)) >= BIG_BLIND]
    if len(capable) < 2:
        return jsonify({"error": "Need at least two players with 20 chips."}), 400
    for uid, player in state["players"].items():
        player.update({"hand": [], "status": "active" if uid in capable else "seated", "bet_current": 0, "total_bet": 0, "result": "", "best_hand": None})
    previous_dealer = state.get("dealer_seat", 0)
    first_dealer = next_uid_after(state, previous_dealer, capable)
    dealer_seat = state["players"][first_dealer]["seat"]
    if len(capable) == 2:
        small_blind_uid = first_dealer
        big_blind_uid = next_uid_after(state, dealer_seat, capable)
    else:
        small_blind_uid = next_uid_after(state, dealer_seat, capable)
        big_blind_uid = next_uid_after(state, state["players"][small_blind_uid]["seat"], capable)
    client_seed = "|".join(
        f"{uid}:{state['players'][uid].get('client_seed') or state['players'][uid]['username']}"
        for uid in sorted(capable)
    )
    rng = fair_rng(state["pending"]["server_seed"], client_seed, state["pending"]["nonce"], "texas_holdem")
    state["client_seed"] = client_seed
    state["deck"] = new_deck(rng)
    state["community"] = []
    state["pot"] = 0
    state["current_bet"] = BIG_BLIND
    state["dealer_seat"] = dealer_seat
    state["round"] += 1
    for uid in capable:
        for _ in range(2):
            state["players"][uid]["hand"].append(state["deck"].pop())
    for uid, blind in [(small_blind_uid, SMALL_BLIND), (big_blind_uid, BIG_BLIND)]:
        change_balance(int(uid), blind * -1, "Texas Hold'em blind")
        state["players"][uid]["bet_current"] += blind
        state["players"][uid]["total_bet"] += blind
        state["pot"] += blind
    state["phase"] = "preflop"
    state["acted"] = []
    state["turn_user"] = next_uid_after(state, state["players"][big_blind_uid]["seat"], capable)
    state["fair"] = None
    state["log"].append(f"Hold'em hand {state['round']} started.")
    set_state(table_key("holdem"), state)
    get_db().commit()
    return jsonify(holdem_public(state, g.user["id"]))


@app.route("/api/holdem/action", methods=["POST"])
@login_required
def api_holdem_action():
    state = holdem_state()
    uid = str(g.user["id"])
    if state["phase"] not in {"preflop", "flop", "turn", "river"}:
        return jsonify({"error": "No poker action is available."}), 400
    if state["turn_user"] != uid:
        return jsonify({"error": "It is not your turn."}), 400
    player = state["players"][uid]
    action = request.form.get("action")
    to_call = max(0, int(state["current_bet"]) - int(player["bet_current"]))
    if action == "fold":
        player["status"] = "folded"
        if uid not in state["acted"]:
            state["acted"].append(uid)
        state["log"].append(f"{player['username']} folded.")
    elif action in {"call", "check"}:
        if action == "check" and to_call > 0:
            return jsonify({"error": "You must call, raise, or fold."}), 400
        if get_balance(g.user["id"]) < to_call:
            return jsonify({"error": "Not enough chips to call."}), 400
        if to_call:
            change_balance(g.user["id"], -to_call, "Texas Hold'em call")
            player["bet_current"] += to_call
            player["total_bet"] += to_call
            state["pot"] += to_call
            state["log"].append(f"{player['username']} called {format_chips(to_call)}.")
        else:
            state["log"].append(f"{player['username']} checked.")
        if uid not in state["acted"]:
            state["acted"].append(uid)
    elif action == "raise":
        try:
            raise_amount = parse_positive_int(request.form.get("raise"), minimum=BIG_BLIND, maximum=100_000)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        total = to_call + raise_amount
        if get_balance(g.user["id"]) < total:
            return jsonify({"error": "Not enough chips to raise."}), 400
        change_balance(g.user["id"], -total, "Texas Hold'em raise")
        player["bet_current"] += total
        player["total_bet"] += total
        state["current_bet"] = player["bet_current"]
        state["pot"] += total
        state["acted"] = [uid]
        state["log"].append(f"{player['username']} raised {format_chips(raise_amount)}.")
    else:
        return jsonify({"error": "Unknown poker action."}), 400
    holdem_next_turn(state, uid)
    set_state(table_key("holdem"), state)
    get_db().commit()
    return jsonify(holdem_public(state, g.user["id"]))


@app.template_filter("json_loads")
def json_loads_filter(value):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}


with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False, host="127.0.0.1", port=int(os.environ.get("PORT", "3333")))
