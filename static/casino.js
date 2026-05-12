const suitEntity = {
    S: "&spades;",
    H: "&hearts;",
    D: "&diams;",
    C: "&clubs;",
};
const CARD_DRAW_MS = 1200;
const CARD_DRAW_STEP_MS = 650;
const RESULT_REVEAL_BUFFER_MS = 180;

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

function initBalancePolling() {
    const balance = document.querySelector(".chip-balance");
    if (!balance) return;
    async function refreshBalance() {
        try {
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
    let lastError = "";
    let betDraft = localStorage.getItem("blackjackBet") || "100";
    let seedDraft = "";
    const seenCards = new Set();

    async function refresh() {
        const data = await getJson("/api/blackjack/state");
        render(data);
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
            const total = handTotal(player.hand);
            seats.push(`
                <div class="player-seat ${uid === data.me ? "is-me" : ""} ${uid === currentTurn ? "is-turn" : ""}">
                    <small>Seat ${player.seat}</small>
                    <div class="player-name">
                        <span>${escapeHtml(player.username)}</span>
                        <span>${chips(player.balance)}</span>
                    </div>
                    ${handHtml(
                        player.hand,
                        true,
                        `bj-${data.round}-player-${uid}`,
                        seenCards,
                        (index) => index === 0
                            ? (dealtOrder.get(uid) ?? 0)
                            : dealtCount + 1 + (dealtOrder.get(uid) ?? 0)
                    )}
                    <div class="player-status" data-card-result>
                        ${total ? `Total ${total}` : escapeHtml(player.status || "seated")}
                        ${player.bet ? ` / Bet ${chips(player.bet)}` : ""}
                    </div>
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
            <div class="online-controls">
                <div class="control-card">
                    <div class="section-kicker">Actions</div>
                    ${blackjackControls(data, me)}
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

    function blackjackControls(data, me) {
        const canBet = ["waiting", "betting", "resolved"].includes(data.phase);
        if (!me && canBet) {
            return `
                <form class="stacked-form" data-bj-form="deal" data-joined="0">
                    <div class="control-row">
                        <label>Bet<input name="bet" type="number" min="1" value="${escapeHtml(betDraft)}"></label>
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
            const seedValue = seedDraft || me.client_seed || `${me.username}-blackjack`;
            html += `
                <form class="stacked-form" data-bj-form="deal" data-joined="1">
                    <div class="control-row">
                        <label>Bet<input name="bet" type="number" min="1" value="${escapeHtml(betValue)}"></label>
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
                <div class="control-row">
                    <button class="button primary" data-bj="hit">Hit</button>
                    <button class="button secondary" data-bj="stand">Stand</button>
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
            seedDraft = formData.client_seed || seedDraft;
            localStorage.setItem("blackjackBet", betDraft);
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
        if (target?.name === "client_seed") {
            seedDraft = target.value;
        }
    });

    refresh();
    setInterval(refresh, 2200);
}

function initHoldem() {
    const root = document.getElementById("holdemApp");
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
    if (rowInput && rowLabel) {
        rowInput.addEventListener("input", () => {
            rowLabel.textContent = rowInput.value;
        });
    }

    const form = document.querySelector("[data-plinko-form]");
    const board = document.querySelector("[data-plinko-board]");
    const resultBox = document.querySelector("[data-plinko-result]");
    if (!board) return;

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
        await new Promise((resolve) => window.setTimeout(resolve, 90));
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

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                const data = await postForm("/api/plinko/drop", Object.fromEntries(new FormData(form)));
                setLiveBalance(data.balance);
                board.dataset.rows = data.rows;
                board.dataset.path = JSON.stringify(data.path);
                board.dataset.slot = data.slot;
                renderPegs(data.rows);
                renderPockets(data.multipliers, null);
                animateBall(data.path, data.rows, data.slot, () => revealPocket(data.slot)).then(() => showPlinkoResult(data));
                if (window.refreshStatsGraph) window.refreshStatsGraph();
            } catch (error) {
                if (resultBox) {
                    resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                }
            }
        });
    }

    runExistingDrop();
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
        const min = Math.min(0, ...values);
        const max = Math.max(0, ...values);
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

document.addEventListener("DOMContentLoaded", () => {
    initBalancePolling();
    initRouletteBoard();
    initPlinko();
    initStatsModal();
    deferCardResults(document);
    const shell = document.querySelector("[data-game]");
    if (!shell) return;
    if (shell.dataset.game === "blackjack") initBlackjack();
    if (shell.dataset.game === "holdem") initHoldem();
});
