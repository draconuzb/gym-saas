# 🏋️ GymSystem — Gym Management Platform

A modern, full-stack IT platform to manage gyms — digital QR passes, automated billing, Telegram bot, and a premium dark-mode admin dashboard.

---

## ⚡ Tech Stack

| Layer         | Technology                          |
|---------------|-------------------------------------|
| Frontend      | Next.js (React) + Vanilla CSS       |
| Backend       | Node.js + Express                   |
| Database      | PostgreSQL                          |
| Bot           | Telegraf (Telegram Bot API)         |
| Scheduling    | node-cron (background worker)       |
| Payments      | Payme, Click (webhook integration)  |
| DevOps        | Docker + Docker Compose             |

---

## 📁 Project Structure

```
gym-system/
├── backend/
│   ├── routes/
│   │   ├── members.js      # Member registration, QR scan check-in
│   │   ├── payments.js     # Payme/Click webhook receiver
│   │   └── hardware.js     # Turnstile/RFID hardware trigger proxy
│   ├── db/
│   │   └── schema.sql      # PostgreSQL schema (Users, Memberships, Visits...)
│   ├── bot.js              # Telegraf bot (start, notify, webapp link)
│   ├── worker.js           # Cron job: daily expiry notifications
│   ├── server.js           # Express API entry point
│   └── .env.example        # Environment variable template
├── frontend/
│   └── src/app/
│       ├── page.tsx           # Dashboard: KPIs and check-in feed
│       ├── members/           # Member management table
│       ├── subscriptions/     # Plans + transaction log
│       ├── classes/           # Weekly class schedule with capacity
│       ├── reports/           # SVG Revenue chart + system health
│       └── settings/          # Gym profile, integrations, notification toggles
├── telegram-webapp.html    # Standalone Member QR-pass WebApp (no dependencies)
└── docker-compose.yml      # One-command deployment
```

---

## 🚀 Quick Start (with Docker)

```bash
# Clone the project
cd gym-system

# Copy and fill in environment variables
cp backend/.env.example backend/.env

# Launch everything (DB + API + Frontend)
docker-compose up --build
```

- **Admin Dashboard**: http://localhost:3000
- **API**: http://localhost:5000
- **Member Telegram WebApp**: open `telegram-webapp.html` in browser to preview

---

## 🔑 API Endpoints

| Method | Route                          | Description                        |
|--------|--------------------------------|------------------------------------|
| GET    | `/api/health`                  | Server health check                |
| GET    | `/api/stats`                   | Dashboard KPIs                     |
| GET    | `/api/members`                 | List all members                   |
| POST   | `/api/members/register`        | Register a new member              |
| POST   | `/api/members/scan`            | QR code check-in                   |
| GET    | `/api/payments`                | Transaction history                |
| POST   | `/api/payments/webhook`        | Payme/Click payment webhook        |
| POST   | `/api/hardware/turnstile/trigger` | Physical turnstile RFID trigger |

---

## 🤖 Telegram Bot Commands

| Command           | Action                                         |
|-------------------|------------------------------------------------|
| `/start`          | Greet user + show gym pass WebApp button       |
| `/notify_expiry`  | Manually trigger expiry notification (admin)   |

---

## 📱 Member Experience

Members interact only via **Telegram Mini App** — no app store required:
1. Open the Bot → tap "Open My Gym Pass"
2. WebApp opens with their QR code
3. Receptionist or turnstile scans the QR (`POST /api/members/scan`)
4. Access is granted or denied based on real-time subscription status

---

## 🐘 Database Schema

| Table               | Purpose                                     |
|---------------------|---------------------------------------------|
| `Users`             | Gym members + staff with roles              |
| `SubscriptionPlans` | Basic, Premium, VIP plan definitions        |
| `Memberships`       | Links users to plans with dates & status    |
| `Visits`            | Check-in/check-out timestamps               |
| `Payments`          | Transaction log with gateway + status       |
