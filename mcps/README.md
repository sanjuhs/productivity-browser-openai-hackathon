# Model Context Protocol (MCP) Integrations

This folder contains MCP tool descriptors for the Carrot & Stick productivity motivation system.

⚠️ **DISCLAIMER**: These are FICTIONAL demo integrations for hackathon demonstration purposes only. No real money transactions or orders are made.

## Available MCPs

### 🏦 SBI Bank (Stick)
**Purpose**: Deduct virtual money when user gets distracted

| Endpoint | Description |
|----------|-------------|
| `GET /api/sbi/account` | Get account balance |
| `POST /api/sbi/penalty` | Deduct penalty |
| `GET /api/sbi/transactions` | Transaction history |
| `POST /api/sbi/reset` | Reset account (demo) |

**Penalty Levels**:
- Strike 1: ₹50 (gentle)
- Strike 2: ₹100 (firm)
- Strike 3: ₹200 (stern)

### 🛒 Blinkit (Carrot)
**Purpose**: Order virtual rewards when user completes tasks

| Endpoint | Description |
|----------|-------------|
| `POST /api/blinkit/reward` | Place reward order |
| `GET /api/blinkit/orders` | Order history |
| `POST /api/blinkit/reset` | Clear orders (demo) |

**Reward Tiers**:
- Any task: Dairy Milk Silk Chocolate
- 50%+ tasks: Cold Coffee + Cookies Pack
- 100% tasks: Premium Snack Box + Ice Cream

## Integration

Both MCPs are automatically triggered by the productivity system:
- **SBI Penalty**: Called when Manager Agent creates an interjection (distraction detected)
- **Blinkit Reward**: Called when user reports task completion via voice

## Folder Structure

```
mcps/
├── README.md
├── sbi-bank/
│   ├── SERVER_METADATA.json
│   ├── INSTRUCTIONS.md
│   └── tools/
│       ├── sbi_check_balance.json
│       ├── sbi_deduct_penalty.json
│       ├── sbi_get_transactions.json
│       └── sbi_reset_account.json
└── blinkit/
    ├── SERVER_METADATA.json
    ├── INSTRUCTIONS.md
    └── tools/
        ├── blinkit_order_reward.json
        ├── blinkit_get_orders.json
        └── blinkit_reset_orders.json
```

## Backend API

All MCP endpoints are served by the FastAPI backend at `http://localhost:8000`. Start the backend with:

```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```
