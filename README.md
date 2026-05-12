# Nova Felt Casino

Flask fake-money casino with login, admin account controls, provably fair seed records, and these games:

- Texas Hold'em shared online table
- Blackjack shared dealer table with up to 5 players
- Baccarat
- Dragon Tiger
- European roulette
- Limbo
- Plinko
- Hi-Lo

## Run

```bash
python3 -m pip install -r requirements.txt
python3 app.py
```

Open `http://127.0.0.1:5000`.

Default admin:

```text
username: admin
password: admin123
```

Each new player starts with 10,000 fake chips. The admin page can set chip balances, disable users, change roles, and reset passwords.

## Fair Play

Every resolved round stores:

- `server_seed_hash` shown before shared-table rounds resolve
- revealed `server_seed`
- player/client seed
- nonce
- result JSON

The random source is derived from:

```text
sha256(server_seed : client_seed : nonce : game)
```
