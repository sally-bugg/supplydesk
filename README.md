# SupplyDesk — Shopify Embedded App
Inventory & Bill of Materials management, embedded directly in your Shopify Admin.

---

## What this does
- **Materials inventory** — track stock levels, reorder points, costs, suppliers
- **Bill of Materials (BOM)** — assign components to each product, see COGS and max producible units
- **Shopify sync** — pulls your products directly from Shopify with one click
- **Stock alerts** — visual warnings when materials hit reorder point or run out
- **Lives inside Shopify Admin** — no separate tool to log into

---

## Setup (30 minutes total)

### Step 1 — Install prerequisites
You need Node.js 18+ and the Shopify CLI.

```bash
# Check Node version (need 18+)
node --version

# Install Shopify CLI
npm install -g @shopify/cli @shopify/theme
```

### Step 2 — Create a Shopify Partner account
1. Go to https://partners.shopify.com and sign up (free)
2. From the Partner Dashboard, click **Apps → Create app**
3. Choose **Create app manually**
4. Name it "SupplyDesk"
5. Copy your **Client ID** and **Client Secret** — you'll need these

### Step 3 — Set up the project
```bash
# Install dependencies
npm install


# Copy env file and fill in your credentials
cp .env.example .env
```

Edit `.env` and fill in:
```
SHOPIFY_API_KEY=        ← Client ID from Step 2
SHOPIFY_API_SECRET=     ← Client Secret from Step 2
SHOPIFY_APP_URL=        ← Leave blank for now, fill in after deploy
SCOPES=read_products,write_products,read_inventory,write_inventory
```

Also update `shopify.app.toml`:
- Replace `YOUR_CLIENT_ID_HERE` with your Client ID

### Step 4 — Set up the database
```bash
npx prisma migrate dev --name init
```
This creates a local SQLite database to store your materials and BOM data.

### Step 5 — Run locally for testing
```bash
npm run dev
```
This starts the app AND opens a tunnel so Shopify can reach your local machine.
Follow the prompts — it will ask you to connect to your store.

Open your Shopify Admin — you'll see **SupplyDesk** in the left sidebar under Apps.

---

## Deploy to Vercel (so it's always live)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial SupplyDesk"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/supplydesk.git
git push -u origin main
```

### Step 2 — Deploy on Vercel
1. Go to https://vercel.com and sign in with GitHub
2. Click **New Project** → import your supplydesk repo
3. Add environment variables (same as your .env file)
4. Click **Deploy**
5. Copy your Vercel URL (e.g. `https://supplydesk-abc123.vercel.app`)

### Step 3 — Update URLs
1. Update `SHOPIFY_APP_URL` in Vercel's environment variables with your Vercel URL
2. Update `shopify.app.toml` — replace `YOUR_APP_URL` with your Vercel URL
3. In your Shopify Partner Dashboard → App → App setup → update the App URL and redirect URLs to match

### Step 4 — Switch database for production
For production, swap SQLite for Postgres (free on Vercel):
1. In Vercel dashboard → Storage → Create Database → Postgres
2. Copy the `DATABASE_URL` connection string
3. Add it as an environment variable in Vercel
4. Update `prisma/schema.prisma`: change `provider = "sqlite"` to `provider = "postgresql"`
5. Redeploy

---

## File structure
```
supplydesk/
├── app/
│   ├── routes/
│   │   ├── app.jsx          ← Shopify App Bridge wrapper
│   │   ├── app._index.jsx   ← Main SupplyDesk dashboard
│   │   └── auth.$.jsx       ← Auth handler
│   ├── shopify.server.js    ← Shopify API config
│   └── root.jsx             ← HTML root
├── prisma/
│   └── schema.prisma        ← Database models
├── shopify.app.toml         ← App config
├── .env.example             ← Environment variables template
└── vite.config.js
```

---

## Adding the next modules
When you're ready, ask Claude to build:
- **Purchase Orders** — auto-generate POs when stock hits reorder point, email suppliers
- **Customer Service** — ticket management linked to Shopify orders
- **Demand Forecasting** — reorder recommendations based on sales velocity

---

## Need help?
- Shopify App docs: https://shopify.dev/docs/apps
- Shopify CLI docs: https://shopify.dev/docs/apps/tools/cli
- Remix docs: https://remix.run/docs
