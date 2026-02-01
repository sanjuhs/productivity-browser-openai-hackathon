# SBI Bank MCP (Demo)

⚠️ **DISCLAIMER**: This is a FICTIONAL demo bank for demonstration purposes only. No real money is involved. State Bank of India branding is used for visual authenticity in the hackathon demo.

## Purpose

The SBI Bank MCP implements the "STICK" part of the carrot-and-stick productivity motivation system. When users get distracted, money is deducted from their virtual bank account as a penalty.

## Penalty Levels

| Strike | Amount | Description |
|--------|--------|-------------|
| 1 | ₹50 | Gentle reminder - first distraction |
| 2 | ₹100 | Firm warning - second distraction |
| 3 | ₹200 | Stern enforcement - third strike |
| Non-compliance | ₹150 | Refusing to acknowledge interjection |

## Available Tools

- `sbi_check_balance` - Get current account balance
- `sbi_deduct_penalty` - Deduct penalty for distraction
- `sbi_get_transactions` - View transaction history
- `sbi_reset_account` - Reset account to initial balance (demo only)

## Integration

The bank penalty is automatically triggered when the Manager Agent creates an interjection. No manual tool calls needed for normal operation.

## API Endpoints

All endpoints are served by the backend at `http://localhost:8000`:

- `GET /api/sbi/account` - Get account details
- `POST /api/sbi/penalty` - Deduct penalty
- `GET /api/sbi/transactions` - Get transaction history
- `POST /api/sbi/reset` - Reset account (demo)
