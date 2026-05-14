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
const CHIP_VALUES = [100, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 150000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];
let selectedChip = Number(localStorage.getItem("selectedChip") || 500);

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

function parseChips(value) {
    return Number(String(value || "0").replace(/[^\d.-]/g, "")) || 0;
}

function chipLabel(value) {
    if (value >= 1000000) return `${Number(value / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
    if (value >= 1000) return `${Number(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
    return chips(value);
}

function formatChipLabel(amount) {
    return chipLabel(Number(amount || 0));
}

function currentBalance() {
    return parseChips(document.querySelector(".chip-balance")?.textContent);
}

function getSelectedChip() {
    const balance = currentBalance();
    if (balance > 0 && selectedChip > balance) {
        selectedChip = Math.max(0, Math.min(balance, CHIP_VALUES.filter((value) => value <= balance).at(-1) || balance));
    }
    return Number(selectedChip || 0);
}

function setSelectedChip(value) {
    const next = Math.max(0, Number(value || 0));
    const balance = currentBalance();
    selectedChip = balance > 0 ? Math.min(next, balance) : next;
    localStorage.setItem("selectedChip", String(selectedChip));
    updateAllChipSelections();
    return selectedChip;
}

function updateAllChipSelections() {
    document.querySelectorAll("[data-chip-value]").forEach((chip) => {
        chip.classList.toggle("selected", Number(chip.dataset.chipValue || 0) === Number(selectedChip || 0));
    });
    document.querySelectorAll("[data-selected-chip-label]").forEach((item) => {
        item.textContent = chips(getSelectedChip());
    });
}

function draftBetTotal(draft) {
    return Object.values(draft || {}).reduce((total, amount) => total + Number(amount || 0), 0);
}

function addChipToTarget(draft, targetKey, amount = getSelectedChip(), maxBalance = currentBalance()) {
    const value = Number(amount || 0);
    if (!targetKey || value <= 0) return { ok: false, error: "Select a chip first." };
        if (draftBetTotal(draft) + value > maxBalance) return { ok: false, error: "Insufficient balance for this bet slip." };
    draft[targetKey] = Number(draft[targetKey] || 0) + value;
    return { ok: true, amount: draft[targetKey] };
}

function clearDraftBets(draft) {
    Object.keys(draft || {}).forEach((key) => delete draft[key]);
}

function chipStackHtml(amount, { className = "", compact = false, label = true } = {}) {
    const value = Number(amount || 0);
    if (value <= 0) return "";
    const count = Math.max(1, Math.min(5, Math.ceil(Math.log10(value + 1) - 1)));
    const chipsHtml = Array.from({ length: count }, (_, index) => (
        `<span class="placed-chip chip-${index % 8}" style="--i:${index}"></span>`
    )).join("");
    return `
        <span class="chip-stack ${compact ? "compact" : ""} ${className}" title="${chips(value)}">
            <span class="chip-stack-pile">${chipsHtml}</span>
            ${label ? `<b>${formatChipLabel(value)}</b>` : ""}
        </span>
    `;
}

function renderChipStack(container, amount, options = {}) {
    if (!container) return;
    container.innerHTML = chipStackHtml(amount, options);
}

function setLiveBalance(value) {
    const balance = document.querySelector(".chip-balance");
    if (balance) {
        balance.textContent = chips(value);
    }
    refreshChipTrays(Number(value || 0));
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
                label: item.dataset.toastLabel || (Number(item.dataset.toastNet || 0) >= 0 ? "Win" : "Loss"),
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
        ...scope.querySelectorAll(".baccarat-stage .result-banner"),
        ...scope.querySelectorAll(".dragon-stage .result-banner"),
        ...scope.querySelectorAll(".hilo-stage .result-banner"),
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

function fairPayloadAttr(fair) {
    try {
        return escapeHtml(JSON.stringify(fair || {}));
    } catch (_error) {
        return "{}";
    }
}

function fairButtonHtml(fair, label = "Fairness") {
    if (!fair) return "";
    return `
        <div class="fair-launch">
            <button class="button ghost small" type="button" data-fair-open data-fair-payload="${fairPayloadAttr(fair)}">${escapeHtml(label)}</button>
        </div>
    `;
}

function fairPanel(data) {
    const payload = {
        id: data.fair?.id || data.pending?.id || data.round || "",
        game: data.fair?.game || data.pending?.game || "",
        server_seed_hash: data.pending?.server_seed_hash || data.fair?.server_seed_hash || "",
        server_seed: data.fair?.server_seed || "",
        client_seed: data.fair?.client_seed || data.client_seed || "",
        nonce: data.pending?.nonce ?? data.fair?.nonce ?? "",
        result: data.fair?.result || data.result || data.last || null,
    };
    const revealAttr = payload.server_seed ? " data-card-result" : "";
    return `
        <div class="fair-anchor"${revealAttr}>${fairButtonHtml(payload)}</div>
    `;
}

function fairProofHtml(fair) {
    return fairButtonHtml(fair);
}

function initChipBetting(scope = document) {
    const balance = parseChips(document.querySelector(".chip-balance")?.textContent);
    scope.querySelectorAll("input[name='bet']").forEach((input) => {
        if (input.type === "hidden" || input.dataset.noChip === "1") return;
        if (input.closest(".chip-bet-wrap")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "chip-bet-wrap";
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        const tray = document.createElement("div");
        tray.className = "chip-tray";
        tray.innerHTML = chipTrayHtml(balance);
        wrapper.appendChild(tray);
        tray.addEventListener("click", (event) => {
            const chip = event.target.closest("[data-chip-value]");
            const clear = event.target.closest("[data-chip-clear]");
            if (clear) {
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                return;
            }
            if (!chip) return;
            setSelectedChip(Number(chip.dataset.chipValue || 0));
        });
        input.addEventListener("input", () => {
            const value = parseChips(input.value);
            if (value > 0) setSelectedChip(value);
        });
        updateAllChipSelections();
    });
}

function chipTrayHtml(balance) {
    const usable = CHIP_VALUES.filter((value) => value <= Math.max(Number(balance || 0), 100));
    return usable.map((value, index) => (
        `<button type="button" class="bet-chip chip-${index % 8} ${Number(selectedChip) === value ? "selected" : ""}" data-chip-value="${value}" title="${chips(value)}">${chipLabel(value)}</button>`
    )).join("") + `<button type="button" class="chip-clear" data-chip-clear>Clear</button>`;
}

function refreshChipTrays(balance = parseChips(document.querySelector(".chip-balance")?.textContent)) {
    document.querySelectorAll(".chip-tray").forEach((tray) => {
        tray.innerHTML = chipTrayHtml(balance);
    });
    updateAllChipSelections();
}

function displayChip(amount, extraClass = "") {
    return chipStackHtml(amount, { className: extraClass, compact: true });
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
        root.dataset.balance = data.my_balance || 0;
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
                <div><span>Your Chips</span><strong>${chips(data.my_balance)}</strong></div>
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
                    <div class="section-kicker">Table Log</div>
                    <div class="log-box">${newestLog(data.log)}</div>
                </div>
            </div>
        `;
        deferCardResults(root);
        initChipBetting(root);
        root.querySelectorAll("[data-bj-form='deal']").forEach(syncBlackjackBetForm);
    }

    function blackjackDraftValue(key) {
        if (key === "bet") return parseChips(betDraft);
        if (key === "pair_bet") return parseChips(pairDraft);
        if (key === "plus3_bet") return parseChips(plus3Draft);
        return 0;
    }

    function setBlackjackDraftValue(key, value) {
        const next = String(Math.max(0, Number(value || 0)));
        if (key === "bet") {
            betDraft = next;
            localStorage.setItem("blackjackBet", betDraft);
        }
        if (key === "pair_bet") {
            pairDraft = next;
            localStorage.setItem("blackjackPairBet", pairDraft);
        }
        if (key === "plus3_bet") {
            plus3Draft = next;
            localStorage.setItem("blackjackPlus3Bet", plus3Draft);
        }
    }

    function blackjackDraftTotal() {
        return blackjackDraftValue("bet") + blackjackDraftValue("pair_bet") + blackjackDraftValue("plus3_bet");
    }

    function syncBlackjackBetForm(form = root.querySelector("[data-bj-form='deal']")) {
        if (!form) return;
        ["bet", "pair_bet", "plus3_bet"].forEach((key) => {
            const value = blackjackDraftValue(key);
            const input = form.querySelector(`[name='${key}']`);
            if (input && input.value !== String(value)) input.value = String(value);
            const total = form.querySelector(`[data-bj-spot-total='${key}']`);
            if (total) total.textContent = value ? chips(value) : "0";
            renderChipStack(form.querySelector(`[data-bj-spot-stack='${key}']`), value, { className: "blackjack-chip-stack", compact: true });
        });
        const totalNode = form.querySelector("[data-bj-total]");
        if (totalNode) totalNode.textContent = chips(blackjackDraftTotal());
    }

    function addBlackjackChip(key, form) {
        const amount = getSelectedChip();
        const nextTotal = blackjackDraftTotal() + amount;
        if (!amount) return;
        if (nextTotal > Number(root.dataset.balance || currentBalance())) {
            lastError = "Insufficient balance for this bet slip.";
            const error = form?.querySelector("[data-bj-draft-error]");
            if (error) error.textContent = lastError;
            syncBlackjackBetForm(form);
            return;
        }
        const error = form?.querySelector("[data-bj-draft-error]");
        if (error) error.textContent = "";
        setBlackjackDraftValue(key, blackjackDraftValue(key) + amount);
        syncBlackjackBetForm(form);
    }

    function blackjackBetSpotHtml(key, label, hint, amount) {
        return `
            <button class="blackjack-bet-spot" type="button" data-bj-bet-spot="${key}">
                <span>${label}</span>
                <small>${hint}</small>
                <strong data-bj-spot-total="${key}">${chips(amount || 0)}</strong>
                <i data-bj-spot-stack="${key}">${chipStackHtml(amount, { className: "blackjack-chip-stack", compact: true })}</i>
            </button>
        `;
    }

    function blackjackBetFormHtml({ joined, me }) {
        const betValue = parseChips(betDraft || me?.bet || 0);
        const pairValue = parseChips(pairDraft || me?.pair_bet || 0);
        const plus3Value = parseChips(plus3Draft || me?.plus3_bet || 0);
        const seedValue = seedDraft || me?.client_seed || `${me?.username || "blackjack"}-blackjack`;
        return `
            <form class="blackjack-bet-strip" data-bj-form="deal" data-joined="${joined ? "1" : "0"}">
                <div class="blackjack-bet-header">
                    <span>Selected Chip <strong data-selected-chip-label>${chips(getSelectedChip())}</strong></span>
                    <span>Total Draft <strong data-bj-total>${chips(betValue + pairValue + plus3Value)}</strong></span>
                </div>
                <div class="blackjack-bet-spots">
                    ${blackjackBetSpotHtml("bet", "Main Bet", "Base bet", betValue)}
                    ${blackjackBetSpotHtml("pair_bet", "Pair", "Side bet", pairValue)}
                    ${blackjackBetSpotHtml("plus3_bet", "21+3", "Side bet", plus3Value)}
                </div>
                <div class="control-row blackjack-exact-row">
                    <label>Main<input name="bet" type="number" min="0" value="${escapeHtml(betValue)}"></label>
                    <label>Pair<input name="pair_bet" type="number" min="0" value="${escapeHtml(pairValue)}"></label>
                    <label>21+3<input name="plus3_bet" type="number" min="0" value="${escapeHtml(plus3Value)}"></label>
                    <label>Client Seed<input name="client_seed" value="${escapeHtml(seedValue)}"></label>
                </div>
                <div class="control-row blackjack-deal-row">
                    <button class="button primary" type="submit">Deal</button>
                    <button class="button ghost" type="button" data-bj-clear>Clear Bets</button>
                    ${joined ? `<button class="button ghost" type="button" data-bj="leave">Leave</button>` : ""}
                </div>
                <div class="muted-line" data-bj-draft-error></div>
            </form>
        `;
    }

    function blackjackControls(data, me) {
        const canBet = ["waiting", "betting", "resolved"].includes(data.phase);
        if (!me && canBet) {
            return blackjackBetFormHtml({ joined: false, me: null });
        }
        if (!me) {
            return `<div class="muted-line">Round in progress. Join the next hand.</div>`;
        }
        const myTurn = data.current_turn === data.me;
        let html = "";
        if (canBet) {
            html += blackjackBetFormHtml({ joined: true, me });
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
            html = `<div class="muted-line">Waiting for the table.</div>`;
        }
        return html;
    }

    root.addEventListener("click", async (event) => {
        const spot = event.target.closest("[data-bj-bet-spot]");
        if (spot) {
            lastError = "";
            addBlackjackChip(spot.dataset.bjBetSpot, spot.closest("[data-bj-form='deal']"));
            return;
        }
        const clear = event.target.closest("[data-bj-clear]");
        if (clear) {
            lastError = "";
            setBlackjackDraftValue("bet", 0);
            setBlackjackDraftValue("pair_bet", 0);
            setBlackjackDraftValue("plus3_bet", 0);
            syncBlackjackBetForm(clear.closest("[data-bj-form='deal']"));
            return;
        }
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
            syncBlackjackBetForm(target.closest("[data-bj-form='deal']"));
        }
        if (target?.name === "pair_bet") {
            pairDraft = target.value;
            localStorage.setItem("blackjackPairBet", pairDraft);
            syncBlackjackBetForm(target.closest("[data-bj-form='deal']"));
        }
        if (target?.name === "plus3_bet") {
            plus3Draft = target.value;
            localStorage.setItem("blackjackPlus3Bet", plus3Draft);
            syncBlackjackBetForm(target.closest("[data-bj-form='deal']"));
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
                <div><span>Current Bet</span><strong>${chips(data.current_bet)}</strong></div>
                <div><span>Your Chips</span><strong>${chips(data.my_balance)}</strong></div>
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
                    <div class="section-kicker">Table Log</div>
                    <div class="log-box">${newestLog(data.log)}</div>
                </div>
            </div>
        `;
        deferCardResults(root);
    }

    function holdemControls(data, me) {
        if (!me) {
            return `<button class="button primary" data-holdem="join">Join Table</button>`;
        }
        const lobbyPhase = ["waiting", "resolved", "showdown"].includes(data.phase);
        if (lobbyPhase) {
            return `
                <form class="stacked-form" data-holdem-form="seed">
                    <label>Client Seed<input name="client_seed" value="${escapeHtml(me.client_seed || `${me.username}-holdem`)}"></label>
                    <div class="control-row">
                        <button class="button secondary" type="submit">Save Seed</button>
                        <button class="button primary" type="button" data-holdem="start">Start Hand</button>
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
    const amountInput = form.querySelector("input[name='bet']");
    const multiInput = form.querySelector("input[name='multi_bets']");
    const clearButton = form.querySelector("[data-roulette-clear]");
    const undoButton = form.querySelector("[data-roulette-undo]");
    const slip = form.querySelector("[data-roulette-slip]");
    const totalNode = form.querySelector("[data-roulette-total]");
    const overlays = board.querySelector("[data-roulette-overlays]");
    const bets = [];

    function numbersKey(numbers) {
        return [...numbers].sort((a, b) => a - b).join("-");
    }

    function cssEscape(value) {
        if (window.CSS?.escape) return CSS.escape(value);
        return String(value).replace(/["\\]/g, "\\$&");
    }

    function parseBetNumbers(raw) {
        return String(raw || "")
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value >= 0 && value <= 36);
    }

    function addOverlayButton(kind, numbers, x, y, label) {
        if (!overlays || !numbers.length) return;
        const key = numbersKey(numbers);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `roulette-overlay-bet ${kind}`;
        button.style.left = `${x}%`;
        button.style.top = `${y}%`;
        button.dataset.numbers = numbers.join(",");
        button.dataset.label = label || key;
        button.dataset.betKey = key;
        overlays.appendChild(button);
    }

    function buildOverlays() {
        if (!overlays || overlays.dataset.ready) return;
        overlays.dataset.ready = "1";
        const rows = [
            [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
            [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
            [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
        ];
        rows.forEach((row, rowIndex) => {
            for (let column = 0; column < 11; column += 1) {
                addOverlayButton("split-x", [row[column], row[column + 1]], ((column + 1) / 12) * 100, ((rowIndex + 0.5) / 3) * 100, `${row[column]}-${row[column + 1]}`);
            }
        });
        for (let column = 0; column < 12; column += 1) {
            addOverlayButton("split-y", [rows[0][column], rows[1][column]], ((column + 0.5) / 12) * 100, (1 / 3) * 100, `${rows[0][column]}-${rows[1][column]}`);
            addOverlayButton("split-y", [rows[1][column], rows[2][column]], ((column + 0.5) / 12) * 100, (2 / 3) * 100, `${rows[1][column]}-${rows[2][column]}`);
        }
        for (let row = 0; row < 2; row += 1) {
            for (let column = 0; column < 11; column += 1) {
                const numbers = [rows[row][column], rows[row][column + 1], rows[row + 1][column], rows[row + 1][column + 1]];
                addOverlayButton("corner", numbers, ((column + 1) / 12) * 100, ((row + 1) / 3) * 100, numbers.join("-"));
            }
        }
        for (let column = 0; column < 12; column += 1) {
            const numbers = [rows[0][column], rows[1][column], rows[2][column]];
            addOverlayButton("street", numbers, ((column + 0.5) / 12) * 100, 103, `${numbers[2]}-${numbers[0]}`);
        }
        for (let column = 0; column < 11; column += 1) {
            const numbers = [rows[0][column], rows[1][column], rows[2][column], rows[0][column + 1], rows[1][column + 1], rows[2][column + 1]];
            addOverlayButton("sixline", numbers, ((column + 1) / 12) * 100, 103, `${numbers[2]}-${numbers[3]}`);
        }
    }

    function renderBoardChips() {
        board.querySelectorAll(".roulette-chip-stack").forEach((chip) => chip.remove());
        const totals = new Map();
        bets.forEach((item) => {
            const key = numbersKey(item.numbers);
            totals.set(key, (totals.get(key) || 0) + Number(item.amount || 0));
        });
        totals.forEach((amount, key) => {
            const target = board.querySelector(`[data-bet-key="${cssEscape(key)}"]`) || board.querySelector(`[data-numbers="${cssEscape(key.replaceAll("-", ","))}"]`);
            if (target) {
                const isOverlay = target.classList.contains("roulette-overlay-bet");
                target.insertAdjacentHTML("beforeend", chipStackHtml(amount, { className: "roulette-chip-stack", compact: true, label: !isOverlay }));
            }
        });
    }

    function renderSlip() {
        if (multiInput) multiInput.value = JSON.stringify(bets);
        if (totalNode) totalNode.textContent = chips(bets.reduce((total, item) => total + Number(item.amount || 0), 0));
        renderBoardChips();
        if (!slip) return;
        if (!bets.length) {
            slip.innerHTML = `<span class="muted-line">Select a chip, then choose a bet.</span>`;
            return;
        }
        slip.innerHTML = bets.map((item, index) => `
            <div>
                <strong>${escapeHtml(item.label)}</strong>
                <span>${chips(item.amount)}</span>
                <button type="button" class="button ghost small" data-slip-remove="${index}">Remove</button>
            </div>
        `).join("");
    }

    function placeRouletteChip(button) {
        const amount = getSelectedChip() || parseChips(amountInput?.value);
        const numbers = parseBetNumbers(button.dataset.numbers);
        if (!amount || !numbers.length) return;
        if (draftBetTotal(Object.fromEntries(bets.map((item, index) => [index, item.amount]))) + amount > currentBalance()) {
            if (slip) slip.innerHTML = `<span class="flash error">Insufficient balance for this bet slip.</span>`;
            return;
        }
        const key = numbersKey(numbers);
        button.dataset.betKey = key;
        bets.push({ numbers, label: button.dataset.label || key, amount });
        renderSlip();
    }

    buildOverlays();

    board.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-numbers]");
        if (!button) return;
        placeRouletteChip(button);
    });

    if (clearButton) {
        clearButton.addEventListener("click", () => {
            bets.splice(0, bets.length);
            renderSlip();
        });
    }
    if (undoButton) {
        undoButton.addEventListener("click", () => {
            bets.pop();
            renderSlip();
        });
    }
    if (slip) {
        slip.addEventListener("click", (event) => {
            const remove = event.target.closest("[data-slip-remove]");
            if (!remove) return;
            bets.splice(Number(remove.dataset.slipRemove), 1);
            renderSlip();
        });
    }

    form.addEventListener("submit", (event) => {
        if (bets.length) return;
        event.preventDefault();
        if (slip) slip.innerHTML = `<span class="flash error">Place at least one chip on the table.</span>`;
    });

    renderSlip();
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

    async function animateBall(path, rows, slot, onImpact = () => {}, fast = false) {
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
                duration: fast ? Math.max(520, rows * 58) : Math.max(1100, rows * 130),
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
                duration: fast ? 240 : 520,
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

    async function dropOnce(fast = false) {
        lockBalance(5000);
        const data = await postForm("/api/plinko/drop", Object.fromEntries(new FormData(form)));
        lockBalance(fast ? 1200 : Math.max(1800, Number(data.rows || 12) * 150 + 900));
        board.dataset.rows = data.rows;
        if (rowInput) rowInput.value = data.rows;
        if (rowLabel) rowLabel.textContent = String(data.rows);
        board.dataset.path = JSON.stringify(data.path);
        board.dataset.slot = data.slot;
        renderPegs(data.rows);
        renderPockets(data.multipliers, null);
        await animateBall(data.path, data.rows, data.slot, () => revealPocket(data.slot), fast);
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
            let autoRunning = false;
            autoButton.addEventListener("click", async () => {
                if (autoRunning) {
                    autoRunning = false;
                    return;
                }
                const count = Math.max(1, Math.min(100, Number(document.querySelector("[data-plinko-auto-count]")?.value || 1)));
                autoRunning = true;
                autoButton.textContent = "Stop Auto";
                autoButton.classList.add("danger");
                for (let index = 0; index < count; index += 1) {
                    if (!autoRunning) break;
                    try {
                        await dropOnce(true);
                    } catch (error) {
                        balanceLockedUntil = 0;
                        if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                        break;
                    }
                }
                autoRunning = false;
                autoButton.textContent = "Auto Drop";
                autoButton.classList.remove("danger");
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
        if (!isModalOpen()) document.body.classList.remove("modal-open");
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

function isModalOpen() {
    return Boolean(document.querySelector("[data-fairness-modal]:not([hidden]), [data-stats-modal]:not([hidden])"));
}

function initFairnessModal() {
    const modal = document.querySelector("[data-fairness-modal]");
    if (!modal) return;
    const body = modal.querySelector("[data-fairness-body]");
    let lastFocus = null;

    function formatFairValue(value, fallback = "Not available") {
        if (value === null || value === undefined || value === "") return fallback;
        if (typeof value === "object") return JSON.stringify(value, null, 2);
        return String(value);
    }

    function fairDetail(label, value, { code = true, fallback = "Not available" } = {}) {
        const display = formatFairValue(value, fallback);
        return `
            <div>
                <span>${escapeHtml(label)}</span>
                ${code ? `<code>${escapeHtml(display)}</code>` : `<strong>${escapeHtml(display)}</strong>`}
            </div>
        `;
    }

    function renderFairness(fair) {
        const resultProof = fair.result || fair.proof || fair.settlements || null;
        const serverSeedFallback = fair.server_seed_hash ? "Hidden until round ends" : "Not available";
        body.innerHTML = `
            <div class="fairness-grid">
                ${fairDetail("Round ID", fair.id || fair.round, { code: false })}
                ${fairDetail("Game", fair.game, { code: false })}
                ${fairDetail("Server Seed Hash", fair.server_seed_hash)}
                ${fairDetail("Server Seed", fair.server_seed, { fallback: serverSeedFallback })}
                ${fairDetail("Client Seed", fair.client_seed)}
                ${fairDetail("Nonce", fair.nonce)}
            </div>
            <div class="fairness-proof">
                <span>Result Proof</span>
                <pre>${escapeHtml(formatFairValue(resultProof, "The result proof appears after this round resolves."))}</pre>
            </div>
            <p class="muted-line">Verify the round by hashing the revealed server seed with the client seed, nonce, and game inputs. The seed hash is committed before betting.</p>
        `;
    }

    function openFairness(fair, opener) {
        lastFocus = opener || document.activeElement;
        renderFairness(fair || {});
        modal.hidden = false;
        document.body.classList.add("modal-open");
        modal.querySelector("[data-fairness-close]")?.focus();
    }

    function closeFairness() {
        modal.hidden = true;
        if (!isModalOpen()) document.body.classList.remove("modal-open");
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }

    document.addEventListener("click", (event) => {
        const opener = event.target.closest("[data-fair-open]");
        if (!opener) return;
        event.preventDefault();
        let payload = {};
        try {
            payload = JSON.parse(opener.dataset.fairPayload || "{}");
        } catch (_error) {
            payload = {};
        }
        openFairness(payload, opener);
    });
    modal.querySelectorAll("[data-fairness-close]").forEach((button) => button.addEventListener("click", closeFairness));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) closeFairness();
    });
}

function initChat() {
    const windowEl = document.querySelector("[data-chat-window]");
    if (!windowEl) return;
    const messagesEl = windowEl.querySelector("[data-chat-messages]");
    const form = windowEl.querySelector("[data-chat-form]");
    const rainForm = windowEl.querySelector("[data-rain-form]");
    const toggles = document.querySelectorAll("[data-chat-toggle]");

    function chatCollapsed() {
        return document.body.classList.contains("chat-collapsed");
    }

    function setChatCollapsed(collapsed, persist = true) {
        windowEl.classList.toggle("is-collapsed", collapsed);
        document.body.classList.toggle("chat-collapsed", collapsed);
        toggles.forEach((button) => {
            button.setAttribute("aria-expanded", String(!collapsed));
            if (button.closest("[data-chat-window]")) {
                button.textContent = "Hide Chat";
            }
        });
        if (!persist) return;
        try {
            localStorage.setItem("novaChatCollapsed", collapsed ? "true" : "false");
        } catch (_error) {
            // Storage can be blocked in private contexts.
        }
    }

    try {
        setChatCollapsed(localStorage.getItem("novaChatCollapsed") === "true" || chatCollapsed(), false);
    } catch (_error) {
        setChatCollapsed(chatCollapsed(), false);
    }

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

    toggles.forEach((toggle) => {
        toggle.addEventListener("click", () => {
            setChatCollapsed(!chatCollapsed());
        });
    });
    window.addEventListener("storage", (event) => {
        if (event.key === "novaChatCollapsed") {
            setChatCollapsed(event.newValue === "true", false);
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !chatCollapsed() && !isModalOpen()) {
            setChatCollapsed(true);
        }
    });
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
        let autoRunning = false;
        autoButton.addEventListener("click", async () => {
            if (autoRunning) {
                autoRunning = false;
                return;
            }
            const count = Math.max(1, Math.min(100, Number(document.querySelector("[data-limbo-auto-count]")?.value || 1)));
            autoRunning = true;
            autoButton.textContent = "Stop Auto";
            autoButton.classList.add("danger");
            for (let index = 0; index < count; index += 1) {
                if (!autoRunning) break;
                try {
                    await playOnce();
                    await new Promise((resolve) => window.setTimeout(resolve, 420));
                } catch (error) {
                    if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
                    break;
                }
            }
            autoRunning = false;
            autoButton.textContent = "Auto Bet";
            autoButton.classList.remove("danger");
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
    const startButton = startForm?.querySelector("button[type='submit']");

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
                <div><span>Cash Out</span><strong>${chips(state.cashout || 0)}</strong></div>
                <div><span>Next Tile</span><strong>${state.next_multiplier ? `${Number(state.next_multiplier).toLocaleString(undefined, { maximumFractionDigits: 4 })}x / ${chips(nextAmount)}` : "-"}</strong></div>
            `;
        }
        if (cashoutButton) cashoutButton.disabled = !state.active;
        if (randomButton) randomButton.disabled = !state.active;
        if (startButton) {
            startButton.disabled = Boolean(state.active);
            startButton.classList.toggle("danger", Boolean(state.active));
            startButton.textContent = state.active ? "Round in Progress" : "Start Round";
        }
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
                    <strong>${state.last.outcome === "cashout" ? "Cashed Out" : "Bomb"} at ${Number(state.last.multiplier || 1).toLocaleString(undefined, { maximumFractionDigits: 4 })}x</strong>
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
                            <strong>Cashed Out at ${Number(payload.state.last.multiplier || 1).toLocaleString(undefined, { maximumFractionDigits: 4 })}x</strong>
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
        let autoRunning = false;
        autoButton.addEventListener("click", async () => {
            if (autoRunning) {
                autoRunning = false;
                return;
            }
            const picks = Math.max(1, Math.min(24, Number(shell.querySelector("[data-mines-auto-picks]")?.value || 1)));
            autoRunning = true;
            autoButton.textContent = "Stop Auto";
            autoButton.classList.add("danger");
            try {
                if (!grid.querySelector("button:not(:disabled)")) {
                    await startRound(Object.fromEntries(new FormData(startForm)));
                }
                for (let index = 0; index < picks; index += 1) {
                    if (!autoRunning) break;
                    const payload = await revealTile(null, true);
                    if (!payload.state.active) break;
                    await new Promise((resolve) => window.setTimeout(resolve, 300));
                }
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
            autoRunning = false;
            autoButton.textContent = "Auto Pick";
            autoButton.classList.remove("danger");
        });
    }
    refresh().catch(() => {});
}

function renderRoadGrid(grid, history, data = {}) {
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
            <div class="road-shoe-status">
                <span>Shoe ${chips(data.shoe_number || 1)}</span>
                <small>${chips(data.shoe_round || 0)} / ${chips(data.shoe_limit || 0)} rounds</small>
                ${data.shoe_notice ? `<strong>${escapeHtml(data.shoe_notice)}</strong>` : ""}
            </div>
            <div><strong>Bead</strong><div class="road-cells bead-road">${bead}</div></div>
            <div><strong>Big Road</strong><div class="road-cells big-road">${big}</div></div>
            <div><strong>Big Eye</strong><div class="road-cells mini-road">${derived}</div></div>
            <div><strong>Small</strong><div class="road-cells mini-road">${derived}</div></div>
            <div><strong>Cockroach</strong><div class="road-cells mini-road slash-road">${derived}</div></div>
        `;
    }
}

function liveBaccaratHand(title, cards = [], total = "") {
    const allCards = cards.map((card, index) => cardHtml(card, false, true, index)).join("");
    return `
        <div class="live-hand live-hand-line">
            <div class="live-hand-label">
                <span>${title}</span>
                <strong data-card-result>${total}</strong>
            </div>
            <div class="baccarat-card-layout">
                <div class="live-card-row live-card-line">${allCards || `<div class="muted-line">Waiting</div>`}</div>
            </div>
        </div>
    `;
}

function renderLiveCards(shell, data, lastRound) {
    const game = shell.dataset.liveTable;
    const cardsBox = shell.querySelector("[data-live-cards]");
    const resultBox = shell.querySelector("[data-live-result]");
    const current = data.current;
    if (data.phase !== "dealing") {
        if (cardsBox) {
            cardsBox.innerHTML = `
                <div class="live-waiting-panel">
                    <strong>Betting Open</strong>
                    <span>Next deal starts after the countdown.</span>
                </div>
            `;
        }
        return;
    }
        if (!current || !cardsBox) {
            if (cardsBox) cardsBox.innerHTML = `<div class="loading-dot">First round starts when the countdown ends.</div>`;
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
            <div class="live-hand live-hand-line">
                <div class="live-hand-label"><span>Dragon</span><strong data-card-result>${current.dragon_total ?? ""}</strong></div>
                <div class="live-card-row live-card-line">${cardHtml(current.dragon, false, true, 0)}</div>
            </div>
            <div class="versus">VS</div>
            <div class="live-hand live-hand-line">
                <div class="live-hand-label"><span>Tiger</span><strong data-card-result>${current.tiger_total ?? ""}</strong></div>
                <div class="live-card-row live-card-line">${cardHtml(current.tiger, false, true, 1)}</div>
            </div>
        `;
    }
    const mine = (current.settlements || []).find((item) => String(item.user_id) === String(data.me));
    if (resultBox) {
        resultBox.innerHTML = `
            <div class="result-banner result-reveal-pending ${mine ? (mine.net > 0 ? "win" : mine.net === 0 ? "push" : "lose") : "push"}" data-card-result>
                <strong>${escapeHtml(current.winner || "").replace("_", " ").toUpperCase()} wins</strong>
                <span>${mine ? `${signedChips(mine.net)} chips` : "No bet placed"}</span>
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

function updateLiveStatus(shell, data, draft = {}) {
    const countdown = shell.querySelector("[data-live-countdown]");
    const status = shell.querySelector("[data-live-status]");
    const betState = shell.querySelector("[data-live-bet-state]");
    const zones = [...shell.querySelectorAll("[data-live-wager]")];
    const seconds = Math.max(0, Number(data.countdown || 0));
    if (countdown) {
        countdown.style.setProperty("--progress", seconds / 10);
        const span = countdown.querySelector("span");
        if (span) span.textContent = String(seconds);
    }
    if (status) status.textContent = data.shoe_notice || (data.phase === "dealing" ? "Round in Progress" : "Betting Open");
    if (betState) {
        betState.textContent = data.pending_bet
            ? `${chips(data.pending_bet.bet)} active on ${String(data.pending_bet.wager).replace("_", " ")}`
            : "No active bet.";
    }
    if (zones.length) {
        const totals = {};
        (data.pending_bets || []).forEach((item) => {
            totals[item.wager] = (totals[item.wager] || 0) + Number(item.bet || 0);
        });
        zones.forEach((zone) => {
            const key = zone.dataset.liveWager;
            const confirmed = totals[key] || 0;
            const draftAmount = Number(draft[key] || 0);
            const amount = zone.querySelector("[data-zone-amount]");
            const draftNode = zone.querySelector("[data-zone-draft]");
            const stackNode = zone.querySelector("[data-zone-stack]");
            if (amount) amount.textContent = confirmed ? `Confirmed ${chips(confirmed)}` : "Confirmed 0";
            if (draftNode) draftNode.textContent = draftAmount ? `Draft ${chips(draftAmount)}` : "Draft 0";
            renderChipStack(stackNode, confirmed + draftAmount, { className: "felt-chip-stack", compact: true });
            zone.classList.toggle("has-chip", confirmed + draftAmount > 0);
            zone.classList.toggle("has-draft", draftAmount > 0);
            zone.disabled = data.phase === "dealing";
        });
    }
    const draftTotalNode = shell.querySelector("[data-live-draft-total]");
    if (draftTotalNode) draftTotalNode.textContent = chips(draftBetTotal(draft));
    const submit = shell.querySelector("[data-live-bet-form] button[type='submit']");
    if (submit) {
        submit.classList.toggle("danger", Boolean(data.pending_bet) || data.phase === "dealing");
        submit.disabled = data.phase === "dealing";
        const total = draftBetTotal(draft);
        submit.textContent = data.phase === "dealing" ? "Round in Progress" : (total ? `Confirm ${chips(total)}` : "Confirm Bet");
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
        const zones = shell.querySelectorAll("[data-live-wager]");
        const lastRound = { value: 0 };
        const draft = {};
        const draftHistory = [];
        let latestData = null;

        async function loadLive() {
            const data = await getJson(`/api/live/${encodeURIComponent(game)}/state?table=${encodeURIComponent(table)}`);
            latestData = data;
            updateLiveStatus(shell, data, draft);
            renderRoadGrid(roadGrid, data.history || [], data);
            renderLiveCards(shell, data, lastRound);
        }

        if (form) {
            function renderDraft() {
                updateLiveStatus(shell, latestData || { phase: "betting", pending_bets: [], my_balance: currentBalance(), countdown: 0 }, draft);
            }

            function addDraftChip(wager) {
                const result = addChipToTarget(draft, wager, getSelectedChip(), currentBalance());
                if (!result.ok) {
                    if (resultBox) resultBox.insertAdjacentHTML("afterbegin", `<div class="flash error">${escapeHtml(result.error)}</div>`);
                    return;
                }
                draftHistory.push({ wager, amount: getSelectedChip() });
                const wagerInput = form.querySelector("input[name='wager']");
                if (wagerInput) wagerInput.value = wager;
                renderDraft();
            }

            function undoDraftChip() {
                const last = draftHistory.pop();
                if (!last) return;
                draft[last.wager] = Math.max(0, Number(draft[last.wager] || 0) - Number(last.amount || 0));
                if (!draft[last.wager]) delete draft[last.wager];
                renderDraft();
            }

            async function submitLiveBet() {
                if (!draftBetTotal(draft)) {
                    const wagerInput = form.querySelector("input[name='wager']");
                    const amountInput = form.querySelector("input[name='bet']");
                    const wager = wagerInput?.value;
                    const amount = parseChips(amountInput?.value);
                    if (wager && amount > 0) {
                        const result = addChipToTarget(draft, wager, amount, currentBalance());
                        if (result.ok) draftHistory.push({ wager, amount });
                    }
                }
                if (!draftBetTotal(draft)) {
                    if (resultBox) resultBox.insertAdjacentHTML("afterbegin", `<div class="flash error">Place chips on a betting spot first.</div>`);
                    return;
                }
                const entries = Object.entries(draft).filter(([, amount]) => Number(amount) > 0);
                for (const [wager, amount] of entries) {
                    const wagerInput = form.querySelector("input[name='wager']");
                    if (wagerInput) wagerInput.value = wager;
                    const amountInput = form.querySelector("input[name='bet']");
                    if (amountInput) amountInput.value = amount;
                    const payload = Object.fromEntries(new FormData(form));
                    payload.table = table;
                    await postForm(`/api/live/${encodeURIComponent(game)}/bet`, payload);
                }
                clearDraftBets(draft);
                draftHistory.splice(0, draftHistory.length);
                if (resultBox) resultBox.insertAdjacentHTML("afterbegin", `<div class="flash success">Bet confirmed for next round.</div>`);
                await loadLive();
            }

            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                try {
                    await submitLiveBet();
                } catch (error) {
                    if (resultBox) resultBox.insertAdjacentHTML("afterbegin", `<div class="flash error">${escapeHtml(error.message)}</div>`);
                    await loadLive().catch(() => {});
                }
            });
            zones.forEach((zone) => {
                zone.addEventListener("click", () => addDraftChip(zone.dataset.liveWager));
            });
            shell.querySelector("[data-live-confirm]")?.addEventListener("click", () => {
                form.requestSubmit();
            });
            shell.querySelector("[data-live-clear]")?.addEventListener("click", () => {
                clearDraftBets(draft);
                draftHistory.splice(0, draftHistory.length);
                renderDraft();
            });
            shell.querySelector("[data-live-undo]")?.addEventListener("click", () => {
                undoDraftChip();
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
        let autoRunning = false;
        autoButton.addEventListener("click", async () => {
            if (autoRunning) {
                autoRunning = false;
                return;
            }
            const count = Math.max(1, Math.min(100, Number(shell.querySelector("[data-slot-auto-count]")?.value || 1)));
            autoRunning = true;
            autoButton.textContent = "Stop Auto";
            autoButton.classList.add("danger");
            let totalNet = 0;
            let lastMultiplier = 0;
            for (let index = 0; index < count; index += 1) {
                if (!autoRunning) break;
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
            autoRunning = false;
            autoButton.textContent = "Auto Spin";
            autoButton.classList.remove("danger");
        });
    }
}

function initCrash() {
    const shell = document.querySelector("[data-game='crash']");
    if (!shell) return;
    const form = shell.querySelector("[data-crash-form]");
    const betButton = shell.querySelector("[data-crash-bet]");
    const cashoutButton = shell.querySelector("[data-crash-cashout]");
    const status = shell.querySelector("[data-crash-status]");
    const multiplierText = shell.querySelector("[data-crash-multiplier]");
    const historyBox = shell.querySelector("[data-crash-history]");
    const resultBox = shell.querySelector("[data-crash-result]");
    const canvas = shell.querySelector("[data-crash-canvas]");
    const screen = shell.querySelector("[data-crash-screen]");
    const bustText = shell.querySelector("[data-crash-bust]");
    const autoButton = shell.querySelector("[data-crash-auto]");
    const autoAmountInput = shell.querySelector("[data-crash-auto-amount]");
    const autoTargetInput = shell.querySelector("[data-crash-auto-target]");
    const autoRoundsInput = shell.querySelector("[data-crash-auto-rounds]");
    const autoState = shell.querySelector("[data-crash-auto-state]");
    const ctx = canvas?.getContext("2d");
    let lastCrashRound = null;
    let autoRunning = false;
    let autoBusy = false;
    let autoPlaced = 0;
    let autoRounds = 0;
    let autoTarget = 2;

    function drawCrash(multiplier = 1, phase = "betting") {
        if (!ctx || !canvas) return;
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#15191d";
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(255,255,255,.08)";
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += 90) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += 70) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        if (phase === "betting") return;
        const points = [];
        const maxX = Math.min(width - 42, 80 + Math.log(Math.max(1.01, multiplier)) * 210);
        const maxY = Math.max(42, height - 52 - Math.log(Math.max(1.01, multiplier)) * 72);
        for (let index = 0; index <= 48; index += 1) {
            const t = index / 48;
            points.push({ x: 42 + (maxX - 42) * t, y: height - 42 - (height - 42 - maxY) * (t ** 1.7) });
        }
        ctx.strokeStyle = phase === "crashed" ? "#fe2247" : "#00e701";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
    }

    function renderCrash(data) {
        setLiveBalance(data.balance);
        const active = data.active_bet;
        const lastRound = data.last?.round || null;
        if (lastRound && lastCrashRound === null) {
            lastCrashRound = lastRound;
        } else if (lastRound && lastCrashRound !== lastRound) {
            lastCrashRound = lastRound;
            if (screen) {
                screen.classList.add("is-crashed");
                if (data.phase !== "crashed") {
                    window.setTimeout(() => screen.classList.remove("is-crashed"), 900);
                }
            }
            if (bustText && data.phase === "crashed") {
                bustText.classList.add("show");
            }
            if (resultBox && data.phase !== "crashed") {
                resultBox.innerHTML = `<div class="result-banner lose"><strong>Crashed at ${Number(data.last.crash || 1).toFixed(2)}x</strong><span>Next Round opening.</span></div>`;
            }
        }
        if (historyBox) {
            historyBox.innerHTML = (data.history || []).slice(-16).reverse().map((item) => {
                const value = Number(item.multiplier || 1);
                return `<span class="${value >= 2 ? "hot" : ""}">${value.toFixed(2)}x</span>`;
            }).join("");
        }
        if (data.phase === "betting") {
            if (screen) screen.classList.remove("is-crashed");
            if (bustText) bustText.classList.remove("show");
            if (status) status.textContent = `Betting Open: ${data.countdown}s`;
            if (multiplierText) multiplierText.textContent = `${data.countdown}s`;
            drawCrash(1, "betting");
        } else if (data.phase === "crashed") {
            const value = Number(data.current?.crash || data.current?.multiplier || data.last?.crash || 1);
            if (screen) screen.classList.add("is-crashed");
            if (bustText) bustText.classList.add("show");
            if (status) status.textContent = "Crashed";
            if (multiplierText) multiplierText.textContent = `${value.toFixed(2)}x`;
            drawCrash(value, "crashed");
            if (resultBox) {
                resultBox.innerHTML = `<div class="result-banner lose"><strong>Crashed at ${value.toFixed(2)}x</strong><span>Next Round opens shortly.</span></div>`;
            }
        } else {
            const value = Number(data.current?.multiplier || 1);
            if (screen) screen.classList.remove("is-crashed");
            if (bustText) bustText.classList.remove("show");
            if (status) status.textContent = "Round in Progress";
            if (multiplierText) multiplierText.textContent = `${value.toFixed(2)}x`;
            drawCrash(value, "running");
        }
        if (betButton) {
            betButton.disabled = data.phase !== "betting" || Boolean(active);
            betButton.classList.toggle("danger", Boolean(active) || data.phase !== "betting");
            betButton.textContent = data.phase === "crashed" ? "Round Settling" : (data.phase !== "betting" ? "Round in Progress" : (active ? "Bet Locked" : "Place Bet"));
        }
        if (cashoutButton) {
            cashoutButton.disabled = !(data.phase === "running" && active && !active.cashed);
            cashoutButton.textContent = active?.cashed
                ? `Cashed Out ${Number(active.cashout || 1).toFixed(2)}x`
                : `Cash Out${data.current ? ` ${Number(data.current.multiplier || 1).toFixed(2)}x` : ""}`;
        }
        const stateText = shell.querySelector("[data-crash-bet-state]");
        if (stateText) {
            stateText.textContent = active
                ? `${chips(active.bet)} ${active.cashed ? `cashed out at ${Number(active.cashout || 1).toFixed(2)}x` : "active"}`
                : "No active bet.";
        }
        runCrashAuto(data).catch((error) => {
            if (autoState) autoState.textContent = error.message;
            stopCrashAuto();
        });
    }

    async function refresh() {
        const data = await getJson("/api/crash/state");
        renderCrash(data);
    }

    function stopCrashAuto() {
        autoRunning = false;
        autoBusy = false;
        if (autoButton) {
            autoButton.textContent = "Auto Bet";
            autoButton.classList.remove("danger");
        }
        if (autoState) autoState.textContent = "Auto stopped.";
    }

    async function runCrashAuto(data) {
        if (!autoRunning || autoBusy) return;
        const active = data.active_bet;
        if (!active && autoPlaced >= autoRounds) {
            stopCrashAuto();
            return;
        }
        if (data.phase === "betting" && !active && autoPlaced < autoRounds) {
            autoBusy = true;
            try {
                const amount = Math.max(1, parseChips(autoAmountInput?.value));
                const payload = await postForm("/api/crash/bet", {
                    bet: amount,
                    client_seed: `${document.querySelector(".username")?.textContent || "auto"}-crash-auto-${Date.now()}`,
                });
                autoPlaced += 1;
                if (autoState) autoState.textContent = `Auto ${autoPlaced}/${autoRounds} armed at ${Number(autoTarget).toFixed(2)}x.`;
                renderCrash(payload);
            } finally {
                autoBusy = false;
            }
            return;
        }
        const liveMultiplier = Number(data.current?.multiplier || 1);
        if (data.phase === "running" && active && !active.cashed && liveMultiplier >= autoTarget) {
            autoBusy = true;
            try {
                const payload = await postForm("/api/crash/cashout");
                if (autoState) autoState.textContent = `Cashed out at ${Number(payload.active_bet?.cashout || liveMultiplier).toFixed(2)}x.`;
                renderCrash(payload);
            } finally {
                autoBusy = false;
            }
        }
    }

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
                const data = await postForm("/api/crash/bet", Object.fromEntries(new FormData(form)));
                renderCrash(data);
                if (resultBox) resultBox.innerHTML = `<div class="flash success">Bet locked for next round.</div>`;
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
        });
    }
    if (cashoutButton) {
        cashoutButton.addEventListener("click", async () => {
            try {
                const data = await postForm("/api/crash/cashout");
                renderCrash(data);
                if (resultBox) resultBox.innerHTML = `<div class="result-banner win"><strong>Cashed Out</strong><span>${cashoutButton.textContent}</span></div>`;
                showRoundToast({ multiplier: data.active_bet?.cashout || data.current?.multiplier || 1, net: Number(data.active_bet?.payout || 0) - Number(data.active_bet?.bet || 0), label: "Win" });
            } catch (error) {
                if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
            }
        });
    }
    if (autoButton) {
        autoButton.addEventListener("click", () => {
            if (autoRunning) {
                stopCrashAuto();
                return;
            }
            autoTarget = Math.max(1.01, Number(autoTargetInput?.value || 2));
            autoRounds = Math.max(1, Math.min(100, Number(autoRoundsInput?.value || 1)));
            autoPlaced = 0;
            autoRunning = true;
            autoButton.textContent = "Stop Auto";
            autoButton.classList.add("danger");
            if (autoState) autoState.textContent = `Waiting for betting window: 0/${autoRounds}.`;
        });
    }
    if (window.EventSource) {
        const source = new EventSource("/api/crash/stream");
        source.onmessage = (event) => {
            try {
                renderCrash(JSON.parse(event.data));
            } catch (_error) {
                // Ignore partial stream frames.
            }
        };
        source.onerror = () => {
            source.close();
            refresh().catch(() => {});
            setInterval(() => refresh().catch(() => {}), 120);
        };
    } else {
        refresh().catch(() => {});
        setInterval(() => refresh().catch(() => {}), 120);
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

function initChickenCross() {
    const shell = document.querySelector("[data-game='chicken']");
    if (!shell) return;
    const form = shell.querySelector("[data-chicken-form]");
    const scene = shell.querySelector("[data-chicken-scene]");
    const lanesBox = shell.querySelector("[data-chicken-lanes]");
    const chicken = shell.querySelector("[data-chicken-character]");
    const startButton = shell.querySelector("[data-chicken-start]");
    const stepButton = shell.querySelector("[data-chicken-step]");
    const cashoutButton = shell.querySelector("[data-chicken-cashout]");
    const stateText = shell.querySelector("[data-chicken-state]");
    const resultBox = shell.querySelector("[data-chicken-result]");
    const fairBox = shell.querySelector("[data-chicken-fair]");
    const currentNode = shell.querySelector("[data-chicken-current]");
    const nextNode = shell.querySelector("[data-chicken-next]");
    const payoutNode = shell.querySelector("[data-chicken-payout]");
    const laneNode = shell.querySelector("[data-chicken-lane]");
    let latest = null;
    let busy = false;
    let renderedLaneCount = 0;

    function laneHtml(index) {
        const direction = index % 2 === 0 ? "right" : "left";
        const speed = 5.6 - (index % 4) * 0.55;
        return `
            <div class="chicken-lane lane-${direction}" data-lane="${index}" style="--lane:${index}">
                <span class="lane-mark"></span>
                <span class="lane-crosswalk"></span>
                <span class="traffic-car ${direction}" style="--car-speed:${speed}s; --car-delay:-${(index * 0.73).toFixed(2)}s"></span>
                <span class="traffic-car small ${direction}" style="--car-speed:${(speed + 1.15).toFixed(2)}s; --car-delay:-${(index * 1.11).toFixed(2)}s"></span>
                <span class="event-car ${direction}"></span>
                <span class="safe-barrier"></span>
                <span class="impact-sparks"></span>
            </div>
        `;
    }

    function ensureLanes(count) {
        if (!lanesBox || renderedLaneCount === count) return;
        renderedLaneCount = count;
        lanesBox.innerHTML = Array.from({ length: count }, (_, index) => laneHtml(count - index)).join("");
        scene?.style.setProperty("--lane-count", count);
    }

    function setBusy(nextBusy) {
        busy = nextBusy;
        const active = latest?.status === "active";
        if (startButton) startButton.disabled = busy || active;
        if (stepButton) stepButton.disabled = busy || !active;
        if (cashoutButton) cashoutButton.disabled = busy || !active || Number(latest?.step || 0) <= 0;
    }

    function markLane(type, step) {
        shell.querySelectorAll(".chicken-lane").forEach((lane) => lane.classList.remove("active-lane", "safe-hit", "crash-hit"));
        const lane = shell.querySelector(`.chicken-lane[data-lane='${step}']`);
        if (lane) {
            lane.classList.add("active-lane", type === "crash" ? "crash-hit" : "safe-hit");
            window.setTimeout(() => lane.classList.remove("active-lane", "safe-hit", "crash-hit"), type === "crash" ? 1250 : 1150);
        }
    }

    function render(data, event = null) {
        latest = data;
        ensureLanes(Number(data.max_steps || 10));
        const movingEvent = event && ["safe", "complete", "crash"].includes(event.type);
        const visualStep = movingEvent ? Number(event.from || 0) : Number(data.step || 0);
        scene?.style.setProperty("--chicken-step", visualStep);
        setLiveBalance(data.balance);
        if (currentNode) currentNode.textContent = `${Number(data.multiplier || 1).toFixed(2)}x`;
        if (nextNode) nextNode.textContent = `${Number(data.next_multiplier || 1).toFixed(2)}x`;
        if (payoutNode) payoutNode.textContent = chips(data.potential_payout || 0);
        if (laneNode) laneNode.textContent = `${chips(data.step || 0)} / ${chips(data.max_steps || 0)}`;
        if (fairBox) fairBox.innerHTML = fairProofHtml(data.last?.fair || data.pending);
        if (stateText) {
            if (data.status === "active") {
                stateText.textContent = `${escapeHtml(data.difficulty_label)} crossing active. Next safe lane pays ${chips(data.next_payout)}.`;
            } else if (data.last) {
                const label = data.last.result === "cashout" ? "Cashed Out" : data.last.result === "crash" ? "Impact" : "Crossed";
                stateText.textContent = `${label} / ${signedChips(data.last.net)} chips.`;
            } else {
                stateText.textContent = "Set your bet and choose a difficulty.";
            }
        }
        if (resultBox && data.last) {
            const win = Number(data.last.net || 0) > 0;
            const label = data.last.result === "cashout" ? "Cashed Out" : data.last.result === "crash" ? "Impact" : "Crossed";
            resultBox.innerHTML = `
                <div class="result-banner ${win ? "win" : "lose"}">
                    <strong>${label} ${Number(data.last.multiplier || 0).toFixed(2)}x</strong>
                    <span>${signedChips(data.last.net)} chips</span>
                </div>
            `;
        } else if (resultBox && data.status === "active") {
            resultBox.innerHTML = "";
        }
        if (chicken && event) {
            chicken.classList.remove("is-hopping", "is-safe", "is-crashed", "is-celebrating");
            void chicken.offsetWidth;
            if (event.type === "safe" || event.type === "complete") {
                const target = Number(event.to || data.step || 0);
                chicken.classList.add("is-hopping");
                window.setTimeout(() => scene?.style.setProperty("--chicken-step", target), 40);
                window.setTimeout(() => {
                    chicken.classList.remove("is-hopping");
                    chicken.classList.add(event.type === "complete" ? "is-celebrating" : "is-safe");
                    markLane("safe", target);
                }, 560);
            }
            if (event.type === "crash") {
                const target = Number(event.to || (Number(data.step || 0) + 1));
                chicken.classList.add("is-hopping");
                window.setTimeout(() => scene?.style.setProperty("--chicken-step", target), 40);
                window.setTimeout(() => {
                    chicken.classList.remove("is-hopping");
                    markLane("crash", target);
                    window.setTimeout(() => chicken.classList.add("is-crashed"), 560);
                }, 560);
            }
            if (event.type === "cashout") {
                chicken.classList.add("is-celebrating");
            }
        }
        if (!event) setBusy(false);
    }

    async function refresh() {
        const data = await getJson("/api/chicken/state");
        render(data);
    }

    async function withAnimationLock(action) {
        if (busy) return;
        setBusy(true);
        try {
            const data = await action();
            const event = data.last_event || null;
            render(data, event);
            const delay = event?.type === "crash" ? 1500 : (event?.type === "safe" || event?.type === "complete" ? 1250 : 640);
            window.setTimeout(() => {
                setBusy(false);
                if (data.last) {
                    showRoundToast({
                        multiplier: data.last.multiplier || data.multiplier || 0,
                        net: data.last.net || 0,
                        label: Number(data.last.net || 0) > 0 ? "Win" : "Loss",
                    });
                    if (window.refreshStatsGraph) window.refreshStatsGraph();
                }
            }, delay);
        } catch (error) {
            setBusy(false);
            if (resultBox) resultBox.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
        }
    }

    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        withAnimationLock(async () => postForm("/api/chicken/start", Object.fromEntries(new FormData(form))));
    });
    stepButton?.addEventListener("click", () => {
        withAnimationLock(async () => postForm("/api/chicken/step"));
    });
    cashoutButton?.addEventListener("click", () => {
        withAnimationLock(async () => postForm("/api/chicken/cashout"));
    });
    refresh().catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
    initBalancePolling();
    initRouletteBoard();
    initPlinko();
    initStatsModal();
    initFairnessModal();
    initChat();
    initLimboAuto();
    initMines();
    initLiveTables();
    initRoads();
    initRaindrops();
    initCrash();
    initChipBetting(document);
    deferCardResults(document);
    initRoundToasts();
    const shell = document.querySelector("[data-game]");
    if (!shell) return;
    if (shell.dataset.game === "blackjack") initBlackjack();
    if (shell.dataset.game === "holdem") initHoldem();
    if (shell.dataset.game === "slots") initSlots();
    if (shell.dataset.game === "chicken") initChickenCross();
});
