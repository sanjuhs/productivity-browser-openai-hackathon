# Blinkit Rewards MCP (Demo)

⚠️ **DISCLAIMER**: This is a FICTIONAL demo for demonstration purposes only. No real orders are placed. Blinkit branding is used for visual authenticity in the hackathon demo.

## Purpose

The Blinkit MCP implements the "CARROT" part of the carrot-and-stick productivity motivation system. When users complete tasks, they receive virtual reward orders as positive reinforcement.

## Reward Tiers

| Progress | Reward | Description |
|----------|--------|-------------|
| Any task | Dairy Milk Silk Chocolate | Small reward for completing a task |
| 50%+ tasks | Cold Coffee + Cookies Pack | Medium reward for good progress |
| 100% tasks | Premium Snack Box + Ice Cream | Big reward for completing all tasks |

## Available Tools

- `blinkit_order_reward` - Place a reward order based on task completion
- `blinkit_get_orders` - View order history
- `blinkit_reset_orders` - Clear order history (demo only)

## Integration

The Blinkit reward is automatically triggered when the user reports task completion via voice response. No manual tool calls needed for normal operation.

## API Endpoints

All endpoints are served by the backend at `http://localhost:8000`:

- `POST /api/blinkit/reward` - Place reward order
- `GET /api/blinkit/orders` - Get order history
- `POST /api/blinkit/reset` - Clear orders (demo)
