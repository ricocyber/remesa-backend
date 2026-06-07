# RemesaFácil Backend 🇺🇸 → 🇲🇽

Backend API for a remittance app helping Latinos in the USA send money to Mexico.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Juan (USA)  ──$200──►  Blockchain  ──►  Maria (Mexico)    │
│                                                             │
│   Fee: 1.5%  │  Speed: Minutes  │  No middleman             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone and enter directory
cd remesa-backend

# Copy environment file
cp .env.example .env

# Start everything
docker-compose up -d

# View logs
docker-compose logs -f api
```

API running at: http://localhost:3000

### Option 2: Manual Setup

```bash
# Install dependencies
npm install

# Setup database
cp .env.example .env
# Edit .env with your database URL

# Run migrations
npx prisma migrate dev

# Start server
npm run dev
```

## API Endpoints

### Authentication

```
POST /api/auth/send-code     # Send verification SMS
POST /api/auth/verify-code   # Verify code & login
GET  /api/auth/me            # Get current user
```

### Users

```
PUT  /api/users/profile           # Update profile
GET  /api/users/recipients        # List saved recipients
POST /api/users/recipients        # Add recipient
DELETE /api/users/recipients/:id  # Delete recipient
```

### Transfers

```
GET  /api/transfers/quote         # Get price quote
POST /api/transfers               # Create transfer
GET  /api/transfers               # List transfers
GET  /api/transfers/:id           # Get transfer details
GET  /api/transfers/track/:num    # Track by number
```

### Asset Actions (NerveSystem Receipt API)

```
POST /api/asset-actions/request                    # request_move
POST /api/asset-actions/:id/check-rules           # check_rules
POST /api/asset-actions/:id/sign-receipt          # sign_receipt
POST /api/asset-actions/:id/verify-settlement     # verify_settlement
GET  /api/asset-actions/:id/audit-trail           # audit_trail
```

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Mobile     │────►│   Backend    │────►│  PostgreSQL  │
│    App       │     │   (Node.js)  │     │   Database   │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │   Stripe     │  │   Stellar    │  │    Bitso     │
  │  (Payments)  │  │ (Blockchain) │  │  (Payouts)   │
  └──────────────┘  └──────────────┘  └──────────────┘
```

## Services

| Service | Purpose | Docs |
|---------|---------|------|
| Stripe | Accept USD payments | [stripe.com/docs](https://stripe.com/docs) |
| Stellar | USDC blockchain transfers | [stellar.org/developers](https://developers.stellar.org) |
| Bitso | MXN payouts to Mexico | [bitso.com/api](https://bitso.com/api_info) |
| Twilio | SMS notifications | [twilio.com/docs](https://www.twilio.com/docs) |

## Environment Variables

See `.env.example` for all required variables.

### Getting API Keys

1. **Stripe**: [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
2. **Stellar**: [laboratory.stellar.org](https://laboratory.stellar.org/) (testnet)
3. **Bitso**: [bitso.com/api_setup](https://bitso.com/api_setup)
4. **Twilio**: [console.twilio.com](https://console.twilio.com/)

## Database

Using Prisma ORM with PostgreSQL.

```bash
# View database
npx prisma studio

# Create migration
npx prisma migrate dev --name your_migration_name

# Reset database
npx prisma migrate reset
```

## Project Structure

```
remesa-backend/
├── server.js           # Entry point
├── config/             # Configuration
├── routes/             # API routes
│   ├── auth.js         # Authentication
│   ├── users.js        # User management
│   ├── transfers.js    # Money transfers
│   └── webhooks.js     # Stripe webhooks
├── services/           # External services
│   ├── stripe.js       # Payment processing
│   ├── stellar.js      # Blockchain
│   ├── bitso.js        # Mexico payouts
│   └── twilio.js       # SMS
├── middleware/         # Express middleware
├── models/             # Database client
├── prisma/             # Database schema
└── docker-compose.yml  # Docker setup
```

## Testing

```bash
# Health check
curl http://localhost:3000/health

# Send verification code
curl -X POST http://localhost:3000/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"phone": "+13235551234"}'
```

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET`
- [ ] Enable HTTPS
- [ ] Set up Stripe webhooks
- [ ] Switch Stellar to mainnet
- [ ] Switch Bitso to production API
- [ ] Configure rate limiting
- [ ] Set up monitoring/logging
- [ ] Obtain money transmitter licenses

## License

MIT
