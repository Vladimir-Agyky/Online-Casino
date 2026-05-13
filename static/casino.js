const suitEntity = {
    S: "&spades;",
    H: "&hearts;",
    D: "&diams;",
    C: "&clubs;",
};
const CARD_DRAW_MS = 1550;
const CARD_DRAW_STEP_MS = 850;
const RESULT_REVEAL_BUFFER_MS = 260;
let balanceLockedUntil = 0;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function chips(value) {
    return Number(value || 0).toLocaleString();
}

function setLiveBalance(value) {
    const balance = document.querySelector(".chip-balance");
    if (balance) {
        balance.textContent = chips(value);
    }
}

function lockBalance(ms = 0) {
    balanceLockedUntil = Date.now() + ms;
}

function initBalancePolling() {
    const balance = document.querySelector(".chip-balance");
    if (!balance) return;
    async function refreshBalance() {
        try {
            if (Date.now() < balanceLockedUntil) return;
            const data = await getJson("/api/me");
            setLiveBalance(data.balance);
        } catch (_error) {
            clearInterval(timer);
        }
    }
    const timer = setInterval(refreshBalance, 3000);
    refreshBalance();
}

function signedChips(value) {
    const number = Number(value || 0);
    return `${number >= 0 ? "+" : "-"}${chips(Math.abs(number))}`;
}

function showRoundToast({ multiplier = 0, net = 0, label = "Result" } = {}) {
    const stack = document.querySelector("[data-toast-stack]");
    if (!stack) return;
    const number = Number(net || 0);
    const now = Date.now();
    const latest = stack.lastElementChild;
    if (latest && now - Number(latest.dataset.createdAt || 0) < 650) {
        const count = Number(latest.dataset.count || 1) + 1;
        const currentNet = Number(latest.dataset.net || 0) + number;
        latest.dataset.count = String(count);
        latest.dataset.net = String(currentNet);
        latest.className = `round-toast compact ${currentNet >= 0 ? "win" : "lose"}`;
        latest.innerHTML = `
            <strong>${count} quick results</strong>
            <span>${signedChips(currentNet)} chips</span>
        `;
        return;
    }
    while (stack.children.length >= 3) {
        stack.firstElementChild.remove();
    }
    const toast = document.createElement("div");
    toast.className = `round-toast ${number >= 0 ? "win" : "lose"}`;
    toast.dataset.createdAt = String(now);
    toast.dataset.count = "1";
    toast.dataset.net = String(number);
    toast.innerHTML = `
        <strong>${escapeHtml(label)} ${Number(multiplier || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}x</strong>
        <span>${signedChips(number)} chips</span>
    `;
    stack.appendChild(toast);
    playTone(number >= 0 ? "win" : "lose");
    window.setTimeout(() => toast.remove(), 3800);
}

function playTone(kind = "win") {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = kind === "lose" ? 140 : 660;
        gain.gain.setValueAtTime(0.001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.2);
    } catch (_error) {
        // Sound is optional and browser-dependent.
    }
}

function playDialTone(duration = 1300) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(180, context.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(720, context.currentTime + duration / 1000);
        gain.gain.setValueAtTime(0.001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration / 1000);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + duration / 1000);
    } catch (_error) {
        // Sound is optional and browser-dependent.
    }
}

function initRoundToasts() {
    document.querySelectorAll("[data-toast-result]").forEach((item) => {
        const delayRaw = getComputedStyle(item).getPropertyValue("--result-delay") || "0";
        const delay = Number.parseFloat(delayRaw) || 0;
        window.setTimeout(() => {
            showRoundToast({
                multiplier: item.dataset.toastMultiplier || 0,
                net: item.dataset.toastNet || 0,
                label: Number(item.dataset.toastNet || 0) >= 0 ? "Win" : "Loss",
            });
        }, delay + 430);
    });
}

function cardDrawIndex(card) {
    const raw = card.style.getPropertyValue("--draw-index") || getComputedStyle(card).getPropertyValue("--draw-index");
    const number = Number.parseFloat(raw);
    return Number.isFinite(number) ? number : 0;
}

function deferCardResults(scope = document) {
    const cards = [...scope.querySelectorAll(".playing-card.draw-card, .playing-card.new-card")];
    if (!cards.length) return;
    const targets = [
        ...scope.querySelectorAll("[data-card-result]"),
        ...scope.querySelectorAll(".baccarat-stage .result-banner, .baccarat-stage .fair-box"),
        ...scope.querySelectorAll(".dragon-stage .result-banner, .dragon-stage .fair-box"),
        ...scope.querySelectorAll(".hilo-stage .result-banner, .hilo-stage .fair-box"),
    ];
    if (!targets.length) return;
    const maxIndex = cards.reduce((highest, card) => Math.max(highest, cardDrawIndex(card)), 0);
    const delay = Math.round(maxIndex * CARD_DRAW_STEP_MS + CARD_DRAW_MS + RESULT_REVEAL_BUFFER_MS);
    targets.forEach((target) => {
        target.classList.add("result-reveal-pending");
        target.style.setProperty("--result-delay", `${delay}ms`);
    });
}

function cardHtml(card, mini = false, animate = false, order = 0) {
    const animationClass = animate ? "new-card" : "";
    const style = animate ? `style="--draw-index: ${order}"` : "";
    if (!card || card.hidden) {
        return `<div class="playing-card card-back ${mini ? "mini" : ""} ${animationClass}" ${style}><span>?</span></div>`;
    }
    const red = card.suit === "H" || card.suit === "D";
    return `
        <div class="playing-card ${red ? "red-card" : "black-card"} ${mini ? "mini" : ""} ${animationClass}" ${style}>
            <span class="card-rank">${escapeHtml(card.rank)}</span>
            <span class="card-suit">${suitEntity[card.suit] || ""}</span>
        </div>
    `;
}

function cardKey(card, scope, index) {
    if (!card || card.hidden) return `${scope}:${index}:hidden`;
    return `${scope}:${index}:${card.rank}${card.suit}`;
}

function handHtml(cards, mini = false, scope = "", seenCards = null, orderForIndex = null) {
    if (!cards || !cards.length) {
        return `<div class="muted-line">No cards</div>`;
    }
    return `<div class="card-row">${cards.map((card, index) => {
        let animate = false;
        if (seenCards && scope) {
            const key = cardKey(card, scope, index);
            animate = !seenCards.has(key);
            seenCards.add(key);
        }
        const order = orderForIndex ? orderForIndex(index, card) : index;
        return cardHtml(card, mini, animate, order);
    }).join("")}</div>`;
}

function handTotal(cards) {
    if (!cards || cards.some((card) => card.hidden)) return "";
    let total = 0;
    let aces = 0;
    for (const card of cards) {
        if (card.rank === "A") {
            total += 11;
            aces += 1;
        } else if (["K", "Q", "J"].includes(card.rank)) {
            total += 10;
        } else {
            total += Number(card.rank);
        }
    }
    while (total > 21 && aces) {
        total -= 10;
        aces -= 1;
    }
    return total;
}

async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    return response.json();
}

async function postForm(url, data = {}) {
    const response = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(data),
    });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || "Request failed.");
    }
    return payload;
}

function newestLog(log) {
    return (log || []).slice(-8).reverse().map((entry) => `<div>${escapeHtml(entry)}</div>`).join("");
}

function fairPanel(data) {
    const hash = data.pending?.server_seed_hash || data.fair?.server_seed_hash || "";
    const seed = data.fair?.server_seed || "";
    const revealAttr = seed ? " data-card-result" : "";
    return `
        <div class="control-card"${revealAttr}>
            <div class="section-kicker">Fair seed</div>
            <div class="fair-box">
                <div><span>Server hash</span><code>${escapeHtml(hash)}</code></div>
                ${seed ? `<div><span>Server seed</span><code>${escapeHtml(seed)}</code></div>` : ""}
                <div><span>Nonce</span><code>${escapeHtml(data.pending?.nonce ?? data.fair?.nonce ?? "")}</code></div>
            </div>
        </div>
    `;
}

function fairProofHtml(fair) {
    if (!fair) return "";
    return `
        <div class="fair-box">
            <div><span>Round</span><strong>${escapeHtml(fair.id)}</strong></div>
            <div><span>Server hash</span><code>${escapeHtml(fair.server_seed_hash)}</code></div>
            <div><span>Server seed</span><code>${escapeHtml(fair.server_seed)}</code></div>
            <div><span>Client seed</span><code>${escapeHtml(fair.client_seed)}</code></div>
            <div><span>Nonce</span><code>${escapeHtml(fair.nonce)}</code></div>
        </div>
    `;
}

function initBlackjack() {
    const root = document.getElementById("blackjackApp");
    if (!root) return;
    let lastError = "";
    let betDraft = localStorage.getItem("blackjackBet") || "100";
    let pairDraft = localStorage.getItem("blackjackPairBet") || "0";
    let plus3Draft = localStorage.getItem("blackjackPlus3Bet") || "0";
    let seedDraft = "";
    const seenCards = new Set();

    async function refresh() {
        const data = await getJson("/api/blackjack/state");
        render(data);
    }

    function blackjackHandDisplay(player, uid, data, dealtOrder, dealtCount) {
        const splitHands = player.split_hands || [];
        if (splitHands.length) {
            return `
                <div class="split-hand-stack">
                    ${splitHands.map((hand, handIndex) => `
                        <div class="split-hand ${handIndex === Number(player.active_hand || 0) && player.status === "playing" ? "active" : ""}">
                            <small>Hand ${handIndex + 1} / Bet ${chips(hand.bet || 0)}</small>
                            ${handHtml(
                                hand.cards || [],
                                true,
                                `bj-${data.round}-player-${uid}-split-${handIndex}`,
                                seenCards,
                                (index) => (dealtOrder.get(uid) ?? 0) + (handIndex * 2) + index + dealtCount
                            )}
                            <span>${hand.cards?.length ? `Total ${handTotal(hand.cards)}` : escapeHtml(hand.status || "")} ${hand.result ? `/ ${escapeHtml(hand.result)}` : ""}</span>
                        </div>
                    `).join("")}
                </div>
            `;
        }
        return handHtml(
            player.hand,
            true,
            `bj-${data.round}-player-${uid}`,
            seenCards,
            (index) => index === 0
                ? (dealtOrder.get(uid) ?? 0)
                : dealtCount + 1 + (dealtOrder.get(uid) ?? 0)
        );
    }

    function render(data) {
        setLiveBalance(data.my_balance);
        const players = Object.entries(data.players || {}).sort((a, b) => a[1].seat - b[1].seat);
        const occupied = new Map(players.map(([uid, player]) => [player.seat, [uid, player]]));
        const me = data.players?.[data.me];
        const currentTurn = data.current_turn;
        const dealerTotal = handTotal(data.dealer?.hand || []);
        const dealtPlayers = players.filter(([, player]) => player.hand?.length);
        const dealtCount = Math.max(dealtPlayers.length, 1);
        const dealtOrder = new Map(dealtPlayers.map(([uid], index) => [uid, index]));
        const seats = [];
        for (let seat = 1; seat <= 5; seat += 1) {
            const entry = occupied.get(seat);
            if (!entry) {
                seats.push(`<div class="player-seat"><small>Seat ${seat}</small><div class="muted-line">Open</div></div>`);
                continue;
            }
            const [uid, player] = entry;
            const total = player.split_hands?.length ? "" : handTotal(player.hand);
            const side = (player.side_results || []).map((item) => `${escapeHtml(item.name)} ${item.payout ? `+${chips(item.payout)}` : "miss"}`).join(" / ");
            seats.push(`
                <div class="player-seat ${uid === data.me ? "is-me" : ""} ${uid === currentTurn ? "is-turn" : ""}">
                    <small>Seat ${player.seat}</small>
                    <div class="player-name">
                        <span>${escapeHtml(player.username)}</span>
                        <span>${chips(player.balance)}</span>
                    </div>
                    ${blackjackHandDisplay(player, uid, data, dealtOrder, dealtCount)}
                    <div class="player-status" data-card-result>
                        ${total ? `Total ${total}` : escapeHtml(player.status || "seated")}
                        ${player.bet ? ` / Bet ${chips(player.bet)}` : ""}
                    </div>
                    ${side ? `<div class="player-side" data-card-result>${side}</div>` : ""}
                    ${player.result ? `<strong class="player-result" data-card-result>${escapeHtml(player.result)} ${player.payout ? `+${chips(player.payout)}` : ""}</strong>` : ""}
                </div>
            `);
        }

        root.innerHTML = `
            <div class="table-meta">
                <div><span>Phase</span><strong>${escapeHtml(data.phase)}</strong></div>
                <div><span>Seats</span><strong>${players.length}/5</strong></div>
                <div><span>Turn</span><strong>${currentTurn ? escapeHtml(data.players[currentTurn].username) : "Table"}</strong></div>
                <div><span>Your chips</span><strong>${chips(data.my_balance)}</strong></div>
            </div>
            <div class="dealer-zone">
                <small data-card-result>Dealer ${dealerTotal ? `/ ${dealerTotal}` : ""}</small>
                ${handHtml(
                    data.dealer?.hand || [],
                    false,
                    `bj-${data.round}-dealer`,
                    seenCards,
                    (index) => index === 0 ? dealtCount : (dealtCount * 2) + 1
                )}
            </div>
            <div class="seat-grid">${seats.join("")}</div>
            <div class="blackjack-action-dock">
                ${blackjackControls(data, me)}
                ${lastError ? `<div class="flash error">${escapeHtml(lastError)}</div>` : ""}
            </div>
            <div class="online-controls">
                ${fairPanel(data)}
                <div class="control-card">
                    <div class="section-kicker">Table log</div>
                    <div class="log-box">${newestLog(data.log)}</div>
                </div>
            </div>
        `;
        deferCardResults(root);
    }

    function blackjackControls(data, me) {
        const canBet = ["waiting", "betting", "resolved"].includes(data.phase);
        if (!me && canBet) {
            return `
                <form class="blackjack-bet-strip" data-bj-form="deal" data-joined="0">
                    <div class="control-row blackjack-bets">
                        <label>Bet<input name="bet" type="number" min="1" value="${escapeHtml(betDraft)}"></label>
                        <label>Pair<input name="pair_bet" type="number" min="0" value="${escapeHtml(pairDraft)}"></label>
                        <label>21+3<input name="plus3_bet" type="number" min="0" value="${escapeHtml(plus3Draft)}"></label>
                        <label>Client seed<input name="client_seed" value="${escapeHtml(seedDraft || "blackjack")}"></label>
                    </div>
                    <button class="button primary" type="submit">Deal</button>
                </form>
            `;
        }
        if (!me) {
            return `<div class="muted-line">A hand is running. Join before the next deal.</div>`;
        }
        const myTurn = data.current_turn === data.me;
        let html = "";
        if (canBet) {
            const betValue = betDraft || me.bet || 100;
            const pairValue = pairDraft || me.pair_bet || 0;
            const plus3Value = plus3Draft || me.plus3_bet || 0;
            const seedValue = seedDraft || me.client_seed || `${me.username}-blackjack`;
            html += `
                <form class="blackjack-bet-strip" data-bj-form="deal" data-joined="1">
                    <div class="control-row blackjack-bets">
                        <label>Bet<input name="bet" type="number" min="1" value="${escapeHtml(betValue)}"></label>
                        <label>Pair<input name="pair_bet" type="number" min="0" value="${escapeHtml(pairValue)}"></label>
                        <label>21+3<input name="plus3_bet" type="number" min="0" value="${escapeHtml(plus3Value)}"></label>
                        <label>Client seed<input name="client_seed" value="${escapeHtml(seedValue)}"></label>
                    </div>
                    <div class="control-row">
                        <button class="button primary" type="submit">Deal</button>
                        <button class="button ghost" type="button" data-bj="leave">Leave</button>
                    </div>
                </form>
            `;
        }
        if (myTurn) {
            html += `
                <div class="blackjack-action-row">
                    <button class="button primary" data-bj="hit">Hit</button>
                    <button class="button secondary" data-bj="stand">Stand</button>
                    <button class="button secondary" data-bj="double" ${me.can_double ? "" : "disabled"}>Double</button>
                    <button class="button secondary" data-bj="split" ${me.can_split ? "" : "disabled"}>Split</button>
                </div>
            `;
        }
        if (!html) {
            html = `<div class="muted-line">Waiting on the table.</div>`;
        }
        return html;
    }

    root.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-bj]")?.dataset.bj;
        if (!action) return;
        try {
            lastError = "";
            if (action === "join") await postForm("/api/blackjack/join");
            if (action === "leave") await postForm("/api/blackjack/leave");
            if (action === "hit") await postForm("/api/blackjack/action", { action: "hit" });
            if (action === "stand") await postForm("/api/blackjack/action", { action: "stand" });
            if (action === "double") await postForm("/api/blackjack/action", { action: "double" });
            if (action === "split") await postForm("/api/blackjack/action", { action: "split" });
            await refresh();
        } catch (error) {
            lastError = error.message;
            await refresh();
        }
    });

    root.addEventListener("submit", async (event) => {
        const form = event.target.closest("[data-bj-form='deal']");
        if (!form) return;
        event.preventDefault();
        try {
            lastError = "";
            const formData = Object.fromEntries(new FormData(form));
            betDraft = formData.bet || betDraft;
            pairDraft = formData.pair_bet || pairDraft;
            plus3Draft = formData.plus3_bet || plus3Draft;
            seedDraft = formData.client_seed || seedDraft;
            localStorage.setItem("blackjackBet", betDraft);
            localStorage.setItem("blackjackPairBet", pairDraft);
            localStorage.setItem("blackjackPlus3Bet", plus3Draft);
            if (form.dataset.joined === "0") {
                await postForm("/api/blackjack/join");
            }
            await postForm("/api/blackjack/bet", formData);
            await postForm("/api/blackjack/start");
            await refresh();
        } catch (error) {
            lastError = error.message;
            await refresh();
        }
    });

    root.addEventListener("input", (event) => {
        const target = event.target;
        if (target?.name === "bet") {
            betDraft = target.value;
            localStorage.setItem("blackjackBet", betDraft);
        }
        if (target?.name === "pair_bet") {
            pairDraft = target.value;
            localStorage.setItem("blackjackPairBet", pairDraft);
        }
        if (target?.name === "plus3_bet") {
            plus3Draft = target.value;
            localStorage.setItem("blackjackPlus3Bet", plus3Draft);
        }
        if (target?.name === "client_seed") {
            seedDraft = target.value;
        }
    });

    refresh();
    setInterval(refresh, 2200);
}

function initHoldem() {
    const root = document.getElementById("holdemApp");
    if (!root) return;
    let lastError = "";
    const seenCards = new Set();

    async function refresh() {
        const data = await getJson("/api/holdem/state");
        render(data);
    }

    function render(data) {
        setLiveBalance(data.my_balance);
        const players = Object.entries(data.players || {}).sort((a, b) => a[1].seat - b[1].seat);
        const occupied = new Map(players.map(([uid, player]) => [player.seat, [uid, player]]));
        const me = data.players?.[data.me];
        const dealtPlayers = players.filter(([, player]) => player.hand?.length);
        const dealtCount = Math.max(dealtPlayers.length, 1);
        const dealtOrder = new Map(dealtPlayers.map(([uid], index) => [uid, index]));
        const seats = [];
        for (let seat = 1; seat <= 8; seat += 1) {
            const entry = occupied.get(seat);
            if (!entry) {
                seats.push(`<div class="player-seat"><small>Seat ${seat}</small><div class="muted-line">Open</div></div>`);
                continue;
            }
            const [uid, player] = entry;
            seats.push(`
                <div class="player-seat ${uid === data.me ? "is-me" : ""} ${uid === data.turn_user ? "is-turn" : ""}">
                    <small>Seat ${player.seat}${player.seat === data.dealer_seat ? " / Button" : ""}</small>
                    <div class="player-name">
                        <span>${escapeHtml(player.username)}</span>
                        <span>${chips(player.balance)}</span>
                    </div>
                    ${handHtml(
                        player.hand,
                        true,
                        `holdem-${data.round}-player-${uid}`,
                        seenCards,
                        (index) => (index * dealtCount) + (dealtOrder.get(uid) ?? 0)
                    )}
                    <div class="player-status" data-card-result>
                        ${escapeHtml(player.status || "seated")}
                        ${player.bet_current ? ` / Bet ${chips(player.bet_current)}` : ""}
                    </div>
                    ${player.result ? `<strong class="player-result" data-card-result>${escapeHtml(player.result)}</strong>` : ""}
                    ${player.best_hand ? `<small>${escapeHtml(player.best_hand.name)}</small>` : ""}
                </div>
            `);
        }

        root.innerHTML = `
            <div class="table-meta">
                <div><span>Phase</span><strong>${escapeHtml(data.phase)}</strong></div>
                <div><span>Pot</span><strong>${chips(data.pot)}</strong></div>
                <div><span>Current bet</span><strong>${chips(data.current_bet)}</strong></div>
                <div><span>Your chips</span><strong>${chips(data.my_balance)}</strong></div>
            </div>
            <div class="community-zone">
                <small>Community</small>
                ${handHtml(data.community || [], false, `holdem-${data.round}-community`, seenCards)}
            </div>
            <div class="seat-grid">${seats.join("")}</div>
            <div class="online-controls">
                <div class="control-card">
                    <div class="section-kicker">Actions</div>
                    ${holdemControls(data, me)}
                    ${lastError ? `<div class="flash error">${escapeHtml(lastError)}</div>` : ""}
                </div>
                ${fairPanel(data)}
                <div class="control-card">
                    <div class="section-kicker">Table log</div>
                    <div class="log-box">${newestLog(data.log)}</div>
                </div>
            </div>
        `;
        deferCardResults(root);
    }

    function holdemControls(data, me) {
        if (!me) {
            return `<button class="button primary" data-holdem="join">Join table</button>`;
        }
        const lobbyPhase = ["waiting", "resolved", "showdown"].includes(data.phase);
        if (lobbyPhase) {
            return `
                <form class="stacked-form" data-holdem-form="seed">
                    <label>Client seed<input name="client_seed" value="${escapeHtml(me.client_seed || `${me.username}-holdem`)}"></label>
                    <div class="control-row">
                        <button class="button secondary" type="submit">Save seed</button>
                        <button class="button primary" type="button" data-holdem="start">Start hand</button>
                        <button class="button ghost" type="button" data-holdem="leave">Leave</button>
                    </div>
                </form>
            `;
        }
        if (data.turn_user === data.me) {
            const toCall = Math.max(0, Number(data.current_bet || 0) - Number(me.bet_current || 0));
            return `
                <div class="control-row">
                    <button class="button ghost" data-holdem="fold">Fold</button>
                    <button class="button secondary" data-holdem="${toCall ? "call" : "check"}">${toCall ? `Call ${chips(toCall)}` : "Check"}</button>
                </div>
                <form class="control-row" data-holdem-form="raise">
                    <label>Raise<input name="raise" type="number" min="20" value="20"></label>
                    <button class="button primary" type="submit">Raise</button>
                </form>
            `;
        }
        return `<div class="muted-line">Waiting for ${data.turn_user ? escapeHtml(data.players[data.turn_user]?.username || "player") : "the table"}.</div>`;
    }

    root.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-holdem]")?.dataset.holdem;
        if (!action) return;
        try {
            lastError = "";
            if (action === "join") await postForm("/api/holdem/join");
            if (action === "leave") await postForm("/api/holdem/leave");
            if (action === "start") await postForm("/api/holdem/start");
            if (["fold", "call", "check"].includes(action)) await postForm("/api/holdem/action", { action });
            await refresh();
        } catch (error) {
            lastError = error.message;
            await refresh();
        }
    });

    root.addEventListener("submit", async (event) => {
        const seedForm = event.target.closest("[data-holdem-form='seed']");
        const raiseForm = event.target.closest("[data-holdem-form='raise']");
        if (!seedForm && !raiseForm) return;
        event.preventDefault();
        try {
            lastError = "";
            if (seedForm) {
                await postForm("/api/holdem/seed", Object.fromEntries(new FormData(seedForm)));
            }
            if (raiseForm) {
                const data = Object.fromEntries(new FormData(raiseForm));
                await postForm("/api/holdem/action", { action: "raise", raise: data.raise });
            }
            await refresh();
        } catch (error) {
            lastError = error.message;
            await refresh();
        }
    });

    refresh();
    setInterval(refresh, 2200);
}

function initRouletteBoard() {
    const form = document.querySelector("[data-roulette-form]");
    const board = document.querySelector("[data-roulette-board]");
    if (!form || !board) return;
    const typeInput = form.querySelector("input[name='bet_type']");
    const numberInput = form.querySelector("input[name='number']");

    function selectButton(button) {
        board.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
        typeInput.value = button.dataset.betType;
        if (button.dataset.number) {
            numberInput.value = button.dataset.number;
        }
    }

    board.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-bet-type]");
        if (!button) return;
        selectButton(button);
    });

    const initialSelector = typeInput.value === "number"
        ? `[data-bet-type="number"][data-number="${numberInput.value}"]`
        : `[data-bet-type="${typeInput.value}"]`;
    const initialButton = board.querySelector(initialSelector) || board.querySelector("[data-bet-type='red']");
    if (initialButton) selectButton(initialButton);
}

function initPlinko() {
    const rowInput = document.querySelector("[data-plinko-rows]");
    const rowLabel = document.querySelector("[data-plinko-row-label]");
    const riskInputs = document.querySelectorAll("input[name='risk']");
    const form = document.querySelector("[data-plinko-form]");
    const board = document.querySelector("[data-plinko-board]");
    const resultBox = document.querySelector("[data-plinko-result]");
    if (!board) return;
    let multiplierTimer = null;

    function renderPegs(rows) {
        const pegs = board.querySelector(".plinko-pegs");
        if (!pegs) return;
        let html = "";
        for (let row = 1; row <= rows; row += 1) {
            for (let peg = 0; peg <= row; peg += 1) {
                html += `<span style="--top: ${(((row - 1) * 100) / rows).toFixed(3)}%; --peg: ${peg}; --count: ${row + 1}"></span>`;
            }
        }
        pegs.innerHTML = html;
    }

    function renderPockets(multipliers, slot) {
        const pockets = board.querySelector(".plinko-pockets");
        if (!pockets) return;
        board.style.setProperty("--pocket-count", multipliers.length);
        pockets.innerHTML = multipliers.map((multiplier, index) => (
            `<span class="${index === slot ? "hit" : ""}">${Number(multiplier).toLocaleString(undefined, { maximumFractionDigits: 2 })}x</span>`
        )).join("");
    }

    function currentRisk() {
        return document.querySelector("input[name='risk']:checked")?.value || "medium";
    }

    async function refreshPlinkoBoard() {
        const rows = Number(rowInput?.value || board.dataset.rows || 12);
        if (rowLabel) rowLabel.textContent = String(rows);
        board.dataset.rows = String(rows);
        renderPegs(rows);
        try {
            const data = await getJson(`/api/plinko/multipliers?rows=${encodeURIComponent(rows)}&risk=${encodeURIComponent(currentRisk())}`);
            renderPockets(data.multipliers || [], null);
        } catch (_error) {
            // The board can still play with the server-side values on submit.
        }
    }

    function scheduleBoardRefresh() {
        window.clearTimeout(multiplierTimer);
        multiplierTimer = window.setTimeout(refreshPlinkoBoard, 80);
    }

    if (rowInput && rowLabel) {
        rowInput.addEventListener("input", scheduleBoardRefresh);
    }
    riskInputs.forEach((input) => input.addEventListener("change", scheduleBoardRefresh));

    function revealPocket(slot) {
        const pockets = board.querySelectorAll(".plinko-pockets span");
        pockets.forEach((pocket) => pocket.classList.remove("hit", "impact"));
        const pocket = pockets[slot];
        if (pocket) {
            pocket.classList.add("hit", "impact");
            window.setTimeout(() => pocket.classList.remove("impact"), 520);
        }
    }

    async function animateBall(path, rows, slot, onImpact = () => {}) {
        const ball = document.createElement("div");
        ball.className = "plinko-ball active-ball";
        board.appendChild(ball);
        const boardBox = board.getBoundingClientRect();
        const width = boardBox.width;
        const height = boardBox.height;
        const top = 26;
        const bottom = height - 54;
        const rowGap = (bottom - top) / rows;
        const slotGap = width / (rows + 1);
        const points = [{ x: width / 2, y: top }];
        let position = 0;
        for (let row = 1; row <= rows; row += 1) {
            position += path[row - 1];
            const rowWidth = row * slotGap;
            points.push({
                x: width / 2 - rowWidth / 2 + position * slotGap,
                y: top + row * rowGap,
            });
        }
        points.push({ x: slotGap * (slot + 0.5), y: bottom + 26 });

        const finalTransform = `translate(${slotGap * (slot + 0.5) - 9}px, ${bottom + 17}px) scale(1.08)`;
        const dropAnimation = ball.animate(
            points.map((point, index) => {
                const bounce = index === 0 || index === points.length - 1 ? 0 : (index % 2 === 0 ? -5 : 6);
                return {
                    transform: index === points.length - 1
                        ? finalTransform
                        : `translate(${point.x - 9}px, ${point.y - 9 + bounce}px) scale(1)`,
                    offset: index / (points.length - 1),
                };
            }),
            {
                duration: Math.max(1100, rows * 130),
                easing: "cubic-bezier(.2,.75,.24,1)",
                fill: "forwards",
            }
        );
        await dropAnimation.finished.catch(() => {});
        await new Promise((resolve) => window.setTimeout(resolve, 15));
        onImpact();
        const impactAnimation = ball.animate(
            [
                { transform: finalTransform, opacity: 1 },
                { transform: `translate(${slotGap * (slot + 0.5) - 9}px, ${bottom - 1}px) scale(1.14)`, opacity: 1, offset: 0.38 },
                { transform: finalTransform, opacity: 1, offset: 0.72 },
                { transform: finalTransform, opacity: 0 },
            ],
            {
                duration: 520,
                easing: "cubic-bezier(.2,.85,.24,1)",
                fill: "forwards",
            }
        );
        await impactAnimation.finished.catch(() => {});
        ball.remove();
    }

    function showPlinkoResult(data) {
        if (!resultBox) return;
        const stateClass = data.net > 0 ? "win" : (data.net === 0 ? "push" : "lose");
        resultBox.innerHTML = `
            <div class="result-banner ${stateClass}">
                <strong>${escapeHtml(data.multiplier_label)}x landed</strong>
                <span>${data.net >= 0 ? "+" : ""}${chips(data.net)} chips</span>
            </div>
            ${fairProofHtml(data.fair)}
        `;
    }

    function runExistingDrop() {
        const existingBall = board.querySelector("[data-plinko-ball]");
        let path = [];
        try {
            path = JSON.parse(board.dataset.path || "[]");
        } catch (_error) {
            path = [];
        }
        if (!path.length || !existingBall) return;
        const existingResultHtml = resultBox ? resultBox.innerHTML : "";
        if (resultBox) resultBox.innerHTML = "";
        existingBall.remove();
        animateBall(
            path,
            Number(board.dataset.rows || path.length),
            Number(board.dataset.slot || 0),
            () => revealPocket(Number(board.dataset.slot || 0))
        ).then(() => {
            if (resultBox && existingResultHtml) {
                resultBox.innerHTML = existingResultHtml;
            }
        });
    }

    async function dropOnce() {
        lockBalance(5000);
        const data = await postForm("/api/plinko/drop", Object.fromEntries(new FormData(form)));
        lockBalance(Math.max(1800, Number(data.rows || 12) * 150 + 900));
        board.dataset.rows = data.rows;
        if (rowInput) rowInput.value = data.rows;
        if (rowLabel) rowLabel.textContent = String(data.rows);
        board.dataset.path = JSON.stringify(data.path);
        board.dataset.slot = data.slot;
        renderPegs(data.rows);
        renderPockets(data.multipliers, null);
        await animateBall(data.path, data.rows, data.slot, () => revealPocket(data.slot));
        balanceLockedUntil = 0;
        setLiveBalance(data.balance);
        showPlinkoResult(data);
        showRoundToast({ multiplier: data.multiplier, net: data.net, label: data.net >= 0 ? "Win" : "Loss" });
        if (window.refreshStatsGraph) window.refreshStatsGraph();
        return data;
    }

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await dropOnce();
            } catch (error) {
                balanceLockedUntil = 0;
                if (resultBox) {
                    resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                }
            }
        });
        const autoButton = document.querySelector("[data-plinko-auto]");
        if (autoButton) {
            autoButton.addEventListener("click", async () => {
                const count = Math.max(1, Math.min(100, Number(document.querySelector("[data-plinko-auto-count]")?.value || 1)));
                autoButton.disabled = true;
                autoButton.textContent = "Running";
                for (let index = 0; index < count; index += 1) {
                    try {
                        await dropOnce();
                    } catch (error) {
                        balanceLockedUntil = 0;
                        if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                        break;
                    }
                }
                autoButton.disabled = false;
                autoButton.textContent = "Auto Drop";
            });
        }
    }

    runExistingDrop();
    refreshPlinkoBoard().catch(() => {});
}

function initStatsModal() {
    const modal = document.querySelector("[data-stats-modal]");
    const openButtons = document.querySelectorAll("[data-stats-open]");
    if (!modal || !openButtons.length) return;
    const dialog = modal.querySelector(".stats-dialog");
    const dragHandle = modal.querySelector("[data-stats-drag]");
    const chart = modal.querySelector("[data-stats-chart]");
    const plot = modal.querySelector("[data-stats-plot]");
    const tooltip = modal.querySelector("[data-stats-tooltip]");
    const hoverLine = modal.querySelector("[data-stats-hover]");
    const title = modal.querySelector("[data-stats-title]");
    const profit = modal.querySelector("[data-stats-profit]");
    const wagered = modal.querySelector("[data-stats-wagered]");
    const payouts = modal.querySelector("[data-stats-payouts]");
    const rounds = modal.querySelector("[data-stats-rounds]");
    const record = modal.querySelector("[data-stats-record]");
    const roi = modal.querySelector("[data-stats-roi]");
    let currentGame = "";
    let currentLabel = "";
    let activePoints = [];
    let activeCoords = [];
    let dragState = null;
    let movedDialog = false;

    function renderStats(data) {
        const points = data.points?.length ? data.points : [{ index: 0, value: 0, net: 0, game: "Start", stake: 0, payout: 0 }];
        const values = points.map((point) => Number(point.value || 0));
        const rawMin = Math.min(0, ...values);
        const rawMax = Math.max(0, ...values);
        const rawRange = rawMax - rawMin || Math.max(1, Math.abs(rawMax), Math.abs(rawMin));
        const padding = Math.max(rawRange * 0.16, 1);
        const min = rawMin - padding;
        const max = rawMax + padding;
        const range = max - min || 1;
        activePoints = points;
        activeCoords = values.map((pointValue, index) => {
            const x = points.length === 1 ? 4 : 4 + (index / (points.length - 1)) * 92;
            const y = 42 - ((pointValue - min) / range) * 32 + 4;
            return { x, y };
        });
        const coords = activeCoords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
        const zeroY = 42 - ((0 - min) / range) * 32 + 4;
        const lastPoint = activeCoords.at(-1) || { x: 4, y: 22 };
        const positive = Number(data.profit || 0) >= 0;
        const gradientId = `profitGlow-${currentGame || "all"}`;

        if (profit) {
            profit.textContent = signedChips(data.profit);
            profit.classList.toggle("positive", positive);
            profit.classList.toggle("negative", !positive);
        }
        if (wagered) wagered.textContent = chips(data.wagered);
        if (payouts) payouts.textContent = chips(data.payouts);
        if (rounds) rounds.textContent = chips(data.rounds);
        if (record) record.textContent = `${chips(data.wins)} / ${chips(data.losses)}`;
        if (roi) {
            roi.textContent = `${Number(data.roi || 0).toFixed(2)}%`;
            roi.classList.toggle("positive", Number(data.roi || 0) >= 0);
            roi.classList.toggle("negative", Number(data.roi || 0) < 0);
        }
        if (plot) {
            plot.innerHTML = `
                <svg viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stop-color="${positive ? "#00e701" : "#fe2247"}" stop-opacity="0.22" />
                            <stop offset="100%" stop-color="${positive ? "#00e701" : "#fe2247"}" stop-opacity="0.02" />
                        </linearGradient>
                    </defs>
                    <line class="profit-grid" x1="0" x2="100" y1="10" y2="10"></line>
                    <line class="profit-grid" x1="0" x2="100" y1="25" y2="25"></line>
                    <line class="profit-grid" x1="0" x2="100" y1="40" y2="40"></line>
                    <line class="profit-zero" x1="0" x2="100" y1="${zeroY.toFixed(2)}" y2="${zeroY.toFixed(2)}"></line>
                    <polygon class="profit-fill" fill="url(#${gradientId})" points="4,46 ${coords} 96,46"></polygon>
                    <polyline class="profit-line ${positive ? "positive" : "negative"}" points="${coords}"></polyline>
                    <circle class="profit-dot ${positive ? "positive" : "negative"}" cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="1.8"></circle>
                </svg>
                <div class="profit-axis">
                    <span>${signedChips(max)}</span>
                    <span>${signedChips(min)}</span>
                </div>
            `;
        }
    }

    async function loadStats() {
        const query = currentGame ? `?game=${encodeURIComponent(currentGame)}` : "";
        const data = await getJson(`/api/profit-loss${query}`);
        renderStats(data);
    }

    function openStats(button) {
        currentGame = button.dataset.statsGame || "";
        currentLabel = button.dataset.statsLabel || "Game";
        if (title) title.textContent = `${currentLabel} Graph`;
        modal.hidden = false;
        loadStats().catch(() => {});
    }

    function closeStats() {
        modal.hidden = true;
        if (tooltip) tooltip.hidden = true;
        if (hoverLine) hoverLine.hidden = true;
    }

    function moveDialog(left, top) {
        if (!dialog) return;
        const width = dialog.offsetWidth;
        const height = dialog.offsetHeight;
        const nextLeft = Math.max(10, Math.min(left, window.innerWidth - width - 10));
        const nextTop = Math.max(10, Math.min(top, window.innerHeight - height - 10));
        dialog.style.left = `${nextLeft}px`;
        dialog.style.top = `${nextTop}px`;
        dialog.style.right = "auto";
    }

    function showPointTooltip(event) {
        if (!chart || !tooltip || !hoverLine || !activePoints.length) return;
        const rect = chart.getBoundingClientRect();
        if (!rect.width) return;
        const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
        const index = activePoints.length === 1
            ? 0
            : Math.min(activePoints.length - 1, Math.max(0, Math.round((x / rect.width) * (activePoints.length - 1))));
        const point = activePoints[index];
        const coord = activeCoords[index] || { x: 4, y: 22 };
        const lineLeft = (coord.x / 100) * rect.width;
        const dotTop = (coord.y / 50) * rect.height;
        hoverLine.hidden = false;
        hoverLine.style.left = `${lineLeft}px`;
        hoverLine.style.setProperty("--dot-top", `${dotTop}px`);
        tooltip.hidden = false;
        tooltip.style.left = `${Math.max(8, Math.min(x + 12, rect.width - 188))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(dotTop + 12, rect.height - 120))}px`;
        tooltip.innerHTML = `
            <strong>${point.index ? `Round ${chips(point.index)}` : "Start"}</strong>
            <span>Cumulative ${signedChips(point.value)}</span>
            <span>This round ${signedChips(point.net)}</span>
            <span>${escapeHtml(point.game || currentLabel)}</span>
            <small>Bet ${chips(point.stake)} / Return ${chips(point.payout)}</small>
        `;
    }

    openButtons.forEach((button) => button.addEventListener("click", () => openStats(button)));
    modal.querySelectorAll("[data-stats-close]").forEach((button) => button.addEventListener("click", closeStats));
    if (dragHandle && dialog) {
        dragHandle.addEventListener("pointerdown", (event) => {
            if (event.target.closest("button")) return;
            const rect = dialog.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
            };
            movedDialog = true;
            dragHandle.setPointerCapture(event.pointerId);
        });
        dragHandle.addEventListener("pointermove", (event) => {
            if (!dragState || dragState.pointerId !== event.pointerId) return;
            moveDialog(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
        });
        dragHandle.addEventListener("pointerup", () => {
            dragState = null;
        });
        dragHandle.addEventListener("pointercancel", () => {
            dragState = null;
        });
        window.addEventListener("resize", () => {
            if (!movedDialog || !dialog || modal.hidden) return;
            const rect = dialog.getBoundingClientRect();
            moveDialog(rect.left, rect.top);
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) closeStats();
    });
    if (chart) {
        chart.addEventListener("mousemove", showPointTooltip);
        chart.addEventListener("mouseleave", () => {
            if (tooltip) tooltip.hidden = true;
            if (hoverLine) hoverLine.hidden = true;
        });
    }

    window.refreshStatsGraph = () => {
        if (!modal.hidden) loadStats().catch(() => {});
    };
    window.refreshProfitChart = window.refreshStatsGraph;
    setInterval(() => {
        if (!modal.hidden) window.refreshStatsGraph();
    }, 5000);
}

function initChat() {
    const windowEl = document.querySelector("[data-chat-window]");
    if (!windowEl) return;
    const messagesEl = windowEl.querySelector("[data-chat-messages]");
    const form = windowEl.querySelector("[data-chat-form]");
    const rainForm = windowEl.querySelector("[data-rain-form]");
    const toggle = windowEl.querySelector("[data-chat-toggle]");

    async function loadChat() {
        const data = await getJson("/api/chat");
        if (!messagesEl) return;
        messagesEl.innerHTML = (data.messages || []).map((item) => `
            <div class="chat-message">
                <strong>${escapeHtml(item.username)}</strong>
                <span>${escapeHtml(item.message)}</span>
            </div>
        `).join("");
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (toggle) {
        toggle.addEventListener("click", () => {
            windowEl.classList.toggle("is-collapsed");
            toggle.textContent = windowEl.classList.contains("is-collapsed") ? "Chat" : "Hide";
        });
    }
    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(form));
            try {
                await postForm("/api/chat", data);
                form.reset();
                await loadChat();
            } catch (_error) {
                // Keep chat quiet; game errors already surface near their controls.
            }
        });
    }
    if (rainForm) {
        rainForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                const data = Object.fromEntries(new FormData(rainForm));
                const payload = await postForm("/api/raindrop", data);
                setLiveBalance(payload.balance);
                rainForm.reset();
                await loadChat();
                showRoundToast({ multiplier: 1, net: -Number(payload.amount || 0), label: "Rain" });
            } catch (error) {
                showRoundToast({ multiplier: 0, net: 0, label: error.message });
            }
        });
    }
    loadChat().catch(() => {});
    setInterval(() => loadChat().catch(() => {}), 3500);
}

function initLimboAuto() {
    const form = document.querySelector("[data-limbo-form]");
    if (!form) return;
    const resultBox = document.querySelector("[data-limbo-result]");
    const meter = document.querySelector("[data-limbo-meter]");
    const crashText = document.querySelector("[data-limbo-crash]");

    function animateLimboRise(crash, target) {
        const duration = Math.min(2600, Math.max(1200, 850 + Math.log(Math.max(1.01, crash)) * 620));
        const finalValue = Math.max(1, Math.min(crash, Math.max(target, crash)));
        if (meter) {
            meter.classList.remove("win", "lose");
            meter.classList.add("is-running");
        }
        playDialTone(duration);
        return new Promise((resolve) => {
            const start = performance.now();
            function frame(now) {
                const progress = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - progress, 3);
                const value = 1 + (finalValue - 1) * eased;
                if (crashText) crashText.textContent = `${value.toFixed(2)}x`;
                if (progress < 1) {
                    requestAnimationFrame(frame);
                } else {
                    if (crashText) crashText.textContent = `${Number(crash).toFixed(2)}x`;
                    if (meter) meter.classList.remove("is-running");
                    resolve();
                }
            }
            requestAnimationFrame(frame);
        });
    }

    async function playOnce() {
        const data = await postForm("/api/limbo/play", Object.fromEntries(new FormData(form)));
        if (resultBox) resultBox.innerHTML = "";
        await animateLimboRise(Number(data.crash), Number(data.target));
        setLiveBalance(data.balance);
        if (meter) {
            meter.classList.toggle("win", data.win);
            meter.classList.toggle("lose", !data.win);
        }
        if (crashText) crashText.textContent = `${Number(data.crash).toFixed(2)}x`;
        if (resultBox) {
            resultBox.innerHTML = `
                <div class="result-banner ${data.win ? "win" : "lose"}">
                    <strong>${data.win ? "Hit" : "Crash"} at ${Number(data.crash).toFixed(2)}x</strong>
                    <span>${signedChips(data.net)} chips</span>
                </div>
                ${fairProofHtml(data.fair)}
            `;
        }
        showRoundToast({ multiplier: data.win ? data.target : data.crash, net: data.net, label: data.win ? "Win" : "Loss" });
        if (window.refreshStatsGraph) window.refreshStatsGraph();
        return data;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await playOnce();
        } catch (error) {
            if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
        }
    });

    const autoButton = document.querySelector("[data-limbo-auto]");
    if (autoButton) {
        autoButton.addEventListener("click", async () => {
            const count = Math.max(1, Math.min(100, Number(document.querySelector("[data-limbo-auto-count]")?.value || 1)));
            autoButton.disabled = true;
            autoButton.textContent = "Running";
            for (let index = 0; index < count; index += 1) {
                try {
                    await playOnce();
                    await new Promise((resolve) => window.setTimeout(resolve, 420));
                } catch (error) {
                    if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                    break;
                }
            }
            autoButton.disabled = false;
            autoButton.textContent = "Auto Bet";
        });
    }
}

function initMines() {
    const shell = document.querySelector("[data-game='mines']");
    if (!shell) return;
    const grid = shell.querySelector("[data-mines-grid]");
    const startForm = shell.querySelector("[data-mines-start]");
    const statusBox = shell.querySelector("[data-mines-status]");
    const resultBox = shell.querySelector("[data-mines-result]");
    const countInput = shell.querySelector("[data-mines-count]");
    const countLabel = shell.querySelector("[data-mines-count-label]");
    const cashoutButton = shell.querySelector("[data-mines-cashout]");
    const randomButton = shell.querySelector("[data-mines-random]");
    const autoButton = shell.querySelector("[data-mines-auto]");

    if (countInput && countLabel) {
        countInput.addEventListener("input", () => {
            countLabel.textContent = countInput.value;
        });
    }

    function renderState(state) {
        if (!state || !grid) return;
        const revealed = new Set(state.revealed || []);
        const mines = new Set(state.mines || []);
        grid.querySelectorAll("[data-tile]").forEach((button) => {
            const tile = Number(button.dataset.tile);
            button.disabled = !state.active || revealed.has(tile) || mines.has(tile);
            button.className = "";
            button.removeAttribute("data-preview");
            const label = button.querySelector("span");
            if (revealed.has(tile)) {
                button.classList.add("open", "gem");
                if (label) label.textContent = "G";
            } else if (mines.has(tile)) {
                button.classList.add("open", "mine");
                if (label) label.textContent = "M";
            } else if (label) {
                label.textContent = "";
                if (state.active && state.next_multiplier) {
                    const previewAmount = Math.floor(Number(state.bet || 0) * Number(state.next_multiplier || 1));
                    button.dataset.preview = `${Number(state.next_multiplier).toLocaleString(undefined, { maximumFractionDigits: 3 })}x / ${chips(previewAmount)}`;
                }
            }
        });
        if (statusBox) {
            const nextAmount = state.next_multiplier ? Math.floor(Number(state.bet || 0) * Number(state.next_multiplier || 1)) : 0;
            statusBox.innerHTML = `
                <div><span>Multiplier</span><strong>${Number(state.multiplier || 1).toLocaleString(undefined, { maximumFractionDigits: 4 })}x</strong></div>
                <div><span>Cashout</span><strong>${chips(state.cashout || 0)}</strong></div>
                <div><span>Next Tile</span><strong>${state.next_multiplier ? `${Number(state.next_multiplier).toLocaleString(undefined, { maximumFractionDigits: 4 })}x / ${chips(nextAmount)}` : "-"}</strong></div>
            `;
        }
        if (cashoutButton) cashoutButton.disabled = !state.active;
        if (randomButton) randomButton.disabled = !state.active;
    }

    async function refresh() {
        const data = await getJson("/api/mines/state");
        renderState(data.state);
        setLiveBalance(data.balance);
    }

    async function startRound(data) {
        const payload = await postForm("/api/mines/start", data);
        renderState(payload.state);
        setLiveBalance(payload.balance);
        if (resultBox) resultBox.innerHTML = "";
        return payload;
    }

    async function revealTile(tile, random = false) {
        const payload = random
            ? await postForm("/api/mines/random")
            : await postForm("/api/mines/reveal", { tile });
        renderState(payload.state);
        setLiveBalance(payload.balance);
        const state = payload.state;
        if (!state.active && state.last && resultBox) {
            const win = Number(state.last.net || 0) > 0;
            resultBox.innerHTML = `
                <div class="result-banner ${win ? "win" : "lose"}">
                    <strong>${state.last.outcome === "cashout" ? "Cashout" : "Mine"} at ${Number(state.last.multiplier || 1).toLocaleString(undefined, { maximumFractionDigits: 4 })}x</strong>
                    <span>${signedChips(state.last.net)} chips</span>
                </div>
                ${fairProofHtml(state.last.fair)}
            `;
            showRoundToast({ multiplier: state.last.multiplier, net: state.last.net, label: win ? "Win" : "Loss" });
            if (window.refreshStatsGraph) window.refreshStatsGraph();
        }
        return payload;
    }

    if (startForm) {
        startForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await startRound(Object.fromEntries(new FormData(startForm)));
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
        });
    }
    if (grid) {
        grid.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-tile]");
            if (!button || button.disabled) return;
            try {
                await revealTile(button.dataset.tile);
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
        });
    }
    if (cashoutButton) {
        cashoutButton.addEventListener("click", async () => {
            try {
                const payload = await postForm("/api/mines/cashout");
                renderState(payload.state);
                setLiveBalance(payload.balance);
                const win = Number(payload.state.last?.net || 0) > 0;
                if (resultBox) {
                    resultBox.innerHTML = `
                        <div class="result-banner ${win ? "win" : "lose"}">
                            <strong>Cashout at ${Number(payload.state.last.multiplier || 1).toLocaleString(undefined, { maximumFractionDigits: 4 })}x</strong>
                            <span>${signedChips(payload.state.last.net)} chips</span>
                        </div>
                        ${fairProofHtml(payload.state.last.fair)}
                    `;
                }
                showRoundToast({ multiplier: payload.state.last.multiplier, net: payload.state.last.net, label: win ? "Win" : "Loss" });
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
        });
    }
    if (randomButton) {
        randomButton.addEventListener("click", () => revealTile(null, true).catch((error) => {
            if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
        }));
    }
    if (autoButton) {
        autoButton.addEventListener("click", async () => {
            const picks = Math.max(1, Math.min(24, Number(shell.querySelector("[data-mines-auto-picks]")?.value || 1)));
            autoButton.disabled = true;
            autoButton.textContent = "Running";
            try {
                if (!grid.querySelector("button:not(:disabled)")) {
                    await startRound(Object.fromEntries(new FormData(startForm)));
                }
                for (let index = 0; index < picks; index += 1) {
                    const payload = await revealTile(null, true);
                    if (!payload.state.active) break;
                    await new Promise((resolve) => window.setTimeout(resolve, 300));
                }
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
            autoButton.disabled = false;
            autoButton.textContent = "Auto Random";
        });
    }
    refresh().catch(() => {});
}

function renderRoadGrid(grid, history) {
    const items = (history || []).slice(-54);
    const bead = items.map((item) => {
        const winner = item.winner || "?";
        return `<span class="${escapeHtml(winner)}">${escapeHtml(winner[0]).toUpperCase()}</span>`;
    }).join("");
    const streaks = [];
    for (const item of items) {
        const winner = item.winner || "tie";
        const last = streaks.at(-1);
        if (last && last.winner === winner && winner !== "tie") {
            last.count += 1;
        } else {
            streaks.push({ winner, count: 1 });
        }
    }
    const big = streaks.map((item) => `<span class="${escapeHtml(item.winner)}" style="--span:${Math.min(6, item.count)}">${escapeHtml(item.winner[0] || "?").toUpperCase()}</span>`).join("");
    const derived = items.slice(-24).map((item, index) => {
        const red = (index + item.winner.length) % 2 === 0;
        return `<span class="${red ? "banker" : "player"}"></span>`;
    }).join("");
    if (grid) {
        grid.innerHTML = `
            <div><strong>Bead</strong><div class="road-cells bead-road">${bead}</div></div>
            <div><strong>Big Road</strong><div class="road-cells big-road">${big}</div></div>
            <div><strong>Big Eye</strong><div class="road-cells mini-road">${derived}</div></div>
            <div><strong>Small</strong><div class="road-cells mini-road">${derived}</div></div>
            <div><strong>Cockroach</strong><div class="road-cells mini-road slash-road">${derived}</div></div>
        `;
    }
}

function liveBaccaratHand(title, cards = [], total = "") {
    const mainCards = cards.slice(0, 2).map((card, index) => cardHtml(card, false, true, index)).join("");
    const extraCards = cards.slice(2).map((card, index) => cardHtml(card, true, true, index + 2)).join("");
    return `
        <div class="live-hand">
            <h2>${title} <span data-card-result>${total}</span></h2>
            <div class="baccarat-card-layout">
                <div class="main-card-stack">${mainCards || `<div class="muted-line">Waiting</div>`}</div>
                <div class="third-card-row">${extraCards || `<span class="muted-line">No third card</span>`}</div>
            </div>
        </div>
    `;
}

function renderLiveCards(shell, data, lastRound) {
    const game = shell.dataset.liveTable;
    const cardsBox = shell.querySelector("[data-live-cards]");
    const resultBox = shell.querySelector("[data-live-result]");
    const current = data.current;
    if (!current || !cardsBox) {
        if (cardsBox) cardsBox.innerHTML = `<div class="loading-dot">First live round starts when the countdown ends.</div>`;
        return;
    }
    if (Number(current.round || 0) === lastRound.value) return;
    lastRound.value = Number(current.round || 0);
    if (game === "baccarat") {
        cardsBox.innerHTML = `
            ${liveBaccaratHand("Player", current.player || [], current.player_total ?? "")}
            <div class="versus">VS</div>
            ${liveBaccaratHand("Banker", current.banker || [], current.banker_total ?? "")}
        `;
    } else {
        cardsBox.innerHTML = `
            <div class="live-hand">
                <h2>Dragon <span data-card-result>${current.dragon_total ?? ""}</span></h2>
                <div class="main-card-stack">${cardHtml(current.dragon, false, true, 0)}</div>
            </div>
            <div class="versus">VS</div>
            <div class="live-hand">
                <h2>Tiger <span data-card-result>${current.tiger_total ?? ""}</span></h2>
                <div class="main-card-stack">${cardHtml(current.tiger, false, true, 1)}</div>
            </div>
        `;
    }
    const mine = (current.settlements || []).find((item) => String(item.user_id) === String(data.me));
    if (resultBox) {
        resultBox.innerHTML = `
            <div class="result-banner result-reveal-pending ${mine ? (mine.net > 0 ? "win" : mine.net === 0 ? "push" : "lose") : "push"}" data-card-result>
                <strong>${escapeHtml(current.winner || "").replace("_", " ").toUpperCase()} wins</strong>
                <span>${mine ? `${signedChips(mine.net)} chips` : "No bet this round"}</span>
            </div>
            ${fairProofHtml(current.fair)}
        `;
    }
    deferCardResults(shell);
    if (mine) {
        const cards = game === "baccarat" ? [...(current.player || []), ...(current.banker || [])] : [current.dragon, current.tiger];
        const delay = Math.round(cards.length * CARD_DRAW_STEP_MS + CARD_DRAW_MS + 450);
        window.setTimeout(() => {
            showRoundToast({ multiplier: mine.bet ? mine.payout / mine.bet : 0, net: mine.net, label: mine.net >= 0 ? "Win" : "Loss" });
            if (window.refreshStatsGraph) window.refreshStatsGraph();
        }, delay);
    }
}

function updateLiveStatus(shell, data) {
    const countdown = shell.querySelector("[data-live-countdown]");
    const status = shell.querySelector("[data-live-status]");
    const betState = shell.querySelector("[data-live-bet-state]");
    const seconds = Math.max(0, Number(data.countdown || 0));
    if (countdown) {
        countdown.style.setProperty("--progress", seconds / 10);
        const span = countdown.querySelector("span");
        if (span) span.textContent = String(seconds);
    }
    if (status) status.textContent = seconds > 0 ? "Betting open" : "Dealing";
    if (betState) {
        betState.textContent = data.pending_bet
            ? `Locked ${chips(data.pending_bet.bet)} on ${String(data.pending_bet.wager).replace("_", " ")}`
            : "No bet locked.";
    }
    setLiveBalance(data.my_balance);
}

function initLiveTables() {
    document.querySelectorAll("[data-live-table]").forEach((shell) => {
        const game = shell.dataset.liveTable;
        const table = shell.dataset.liveTableNumber || "1";
        const roadGrid = shell.querySelector("[data-road-grid]");
        const form = shell.querySelector("[data-live-bet-form]");
        const resultBox = shell.querySelector("[data-live-result]");
        const lastRound = { value: 0 };

        async function loadLive() {
            const data = await getJson(`/api/live/${encodeURIComponent(game)}/state?table=${encodeURIComponent(table)}`);
            updateLiveStatus(shell, data);
            renderRoadGrid(roadGrid, data.history || []);
            renderLiveCards(shell, data, lastRound);
        }

        if (form) {
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                try {
                    const payload = Object.fromEntries(new FormData(form));
                    payload.table = table;
                    const data = await postForm(`/api/live/${encodeURIComponent(game)}/bet`, payload);
                    updateLiveStatus(shell, data);
                    if (resultBox) resultBox.insertAdjacentHTML("afterbegin", `<div class="flash success">Bet locked for the next countdown round.</div>`);
                } catch (error) {
                    if (resultBox) resultBox.insertAdjacentHTML("afterbegin", `<div class="flash error">${escapeHtml(error.message)}</div>`);
                }
            });
        }
        loadLive().catch(() => {});
        setInterval(() => loadLive().catch(() => {}), 1000);
    });
}

function initRoads() {
    document.querySelectorAll("[data-road-game]").forEach((panel) => {
        const game = panel.dataset.roadGame;
        const table = panel.dataset.roadTable || "1";
        const grid = panel.querySelector("[data-road-grid]");
        const countdown = panel.querySelector("[data-road-countdown]");
        let seconds = 10;

        async function loadRoad() {
            const data = await getJson(`/api/roads/${encodeURIComponent(game)}?table=${encodeURIComponent(table)}`);
            renderRoadGrid(grid, data.history || []);
        }

        async function tickRound() {
            try {
                const data = await postForm(panel.dataset.roadAuto, { table });
                renderRoadGrid(grid, data.history || []);
            } catch (_error) {
                await loadRoad().catch(() => {});
            }
        }

        function renderCountdown() {
            if (!countdown) return;
            countdown.style.setProperty("--progress", seconds / 10);
            const span = countdown.querySelector("span");
            if (span) span.textContent = String(seconds);
        }

        loadRoad().catch(() => {});
        renderCountdown();
        setInterval(async () => {
            seconds -= 1;
            if (seconds <= 0) {
                seconds = 10;
                await tickRound();
            }
            renderCountdown();
        }, 1000);
    });
}

function initSlots() {
    const shell = document.querySelector("[data-game='slots']");
    if (!shell) return;
    const form = shell.querySelector("[data-slot-form]");
    const reels = [...shell.querySelectorAll(".slot-reel span")];
    const resultBox = shell.querySelector("[data-slot-result]");
    const bonusButton = shell.querySelector("[data-slot-bonus]");
    const autoButton = shell.querySelector("[data-slot-auto]");
    const symbolCycle = ["7", "D", "S", "B", "C", "L", "BAR"];

    function animateReels(result) {
        reels.forEach((reel, index) => {
            reel.parentElement.classList.add("spinning");
            let ticks = 0;
            const timer = window.setInterval(() => {
                reel.textContent = symbolCycle[(ticks + index) % symbolCycle.length];
                ticks += 1;
            }, 58);
            window.setTimeout(() => {
                window.clearInterval(timer);
                reel.textContent = result.reels?.[index]?.label || "-";
                reel.parentElement.classList.remove("spinning");
                reel.parentElement.classList.add("settled");
                window.setTimeout(() => reel.parentElement.classList.remove("settled"), 500);
            }, 650 + index * 140);
        });
        return new Promise((resolve) => window.setTimeout(resolve, 1450));
    }

    function renderResult(data) {
        if (!resultBox) return;
        const best = [...(data.results || [])].sort((a, b) => Number(b.payout || 0) - Number(a.payout || 0))[0];
        const stateClass = data.net > 0 ? "win" : (data.net === 0 ? "push" : "lose");
        resultBox.innerHTML = `
            <div class="result-banner ${stateClass} ${data.jackpot ? "jackpot" : ""}">
                <strong>${data.jackpot ? "Jackpot" : escapeHtml(best?.label || "Spin complete")} ${Number(data.multiplier || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}x</strong>
                <span>${signedChips(data.net)} chips${data.free_spins ? ` / +${chips(data.free_spins)} free spins` : ""}</span>
            </div>
            ${fairProofHtml(data.fair)}
        `;
    }

    async function spin(mode = "base", silentToast = false) {
        const payload = Object.fromEntries(new FormData(form));
        payload.mode = mode;
        const data = await postForm("/api/slots/spin", payload);
        const lastSpin = (data.results || []).at(-1) || {};
        await animateReels(lastSpin);
        setLiveBalance(data.balance);
        renderResult(data);
        if (!silentToast) {
            showRoundToast({ multiplier: data.multiplier, net: data.net, label: data.net >= 0 ? "Win" : "Loss" });
        }
        if (data.jackpot) playTone("win");
        if (window.refreshStatsGraph) window.refreshStatsGraph();
        return data;
    }

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                await spin("base");
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
        });
    }
    if (bonusButton) {
        bonusButton.addEventListener("click", async () => {
            bonusButton.disabled = true;
            try {
                await spin("bonus");
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
            bonusButton.disabled = false;
        });
    }
    if (autoButton) {
        autoButton.addEventListener("click", async () => {
            const count = Math.max(1, Math.min(100, Number(shell.querySelector("[data-slot-auto-count]")?.value || 1)));
            autoButton.disabled = true;
            autoButton.textContent = "Running";
            let totalNet = 0;
            let lastMultiplier = 0;
            for (let index = 0; index < count; index += 1) {
                try {
                    const data = await spin("base", true);
                    totalNet += Number(data.net || 0);
                    lastMultiplier = Number(data.multiplier || 0);
                } catch (error) {
                    if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                    break;
                }
            }
            showRoundToast({ multiplier: lastMultiplier, net: totalNet, label: totalNet >= 0 ? "Auto Win" : "Auto Loss" });
            autoButton.disabled = false;
            autoButton.textContent = "Auto Spin";
        });
    }
}

function initRaindrops() {
    document.querySelectorAll("[data-raindrop-join]").forEach((button) => {
        button.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await postForm(`/api/raindrops/${encodeURIComponent(button.dataset.raindropJoin)}/join`);
                button.textContent = "Joined";
                showRoundToast({ multiplier: 1, net: 0, label: "Joined" });
            } catch (error) {
                button.disabled = false;
                showRoundToast({ multiplier: 0, net: 0, label: error.message });
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initBalancePolling();
    initRouletteBoard();
    initPlinko();
    initStatsModal();
    initChat();
    initLimboAuto();
    initMines();
    initLiveTables();
    initRoads();
    initRaindrops();
    deferCardResults(document);
    initRoundToasts();
    const shell = document.querySelector("[data-game]");
    if (!shell) return;
    if (shell.dataset.game === "blackjack") initBlackjack();
    if (shell.dataset.game === "holdem") initHoldem();
    if (shell.dataset.game === "slots") initSlots();
});
