# PUPSJ HUB - Progressive Web Application

A centralized campus platform for PUP San Juan featuring announcements, event calendar, lost & found, class schedules, and an AI-ready chatbot.

---

## Prerequisites

- **Node.js** v18+ — [Download](https://nodejs.org)
- **PostgreSQL** v14+ — [Download](https://www.postgresql.org/download/)
- **Git** (optional)

---

## Setup Instructions

### Step 1: Install PostgreSQL and Create the Database

Open your terminal (Command Prompt, PowerShell, or Terminal) and run:

```bash
# Login to PostgreSQL
psql -U postgres

# Inside the psql shell, create the database:
CREATE DATABASE pupsj_hub;

# Exit psql
\q
```

### Step 2: Clone or Copy the Project

Place the `pupsj-hub` folder anywhere on your computer.

### Step 3: Install Dependencies

```bash
cd pupsj-hub
npm install
```

### Step 4: Configure Environment Variables

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Open `.env` in a text editor and update:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pupsj_hub
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE

PORT=3000
NODE_ENV=development

JWT_SECRET=change_this_to_a_random_string_abc123
JWT_EXPIRES_IN=7d
SESSION_SECRET=change_this_to_another_random_string
```

### Step 5: Run the Database Seed

This creates all tables and inserts sample data:

```bash
npm run seed
```

You should see:
```
✅ Schema created
✅ Seed data inserted

📋 Default Login Credentials:
   Admin:   admin@pupsj.edu.ph / admin123
   Faculty: faculty@pupsj.edu.ph / faculty123
   Student: student@pupsj.edu.ph / student123
```

### Step 6: Start the Server

```bash
npm start
```

Or for development (auto-restart on changes):
```bash
npm run dev
```

### Step 7: Open in Browser

Go to: **http://localhost:3000**

---

## Default Accounts

| Role    | Email                    | Password    |
|---------|--------------------------|-------------|
| Admin   | admin@pupsj.edu.ph       | admin123    |
| Faculty | faculty@pupsj.edu.ph     | faculty123  |
| Student | student@pupsj.edu.ph     | student123  |

---

## Features

| Module             | Description |
|--------------------|-------------|
| **Announcements**  | Post/view announcements with department + Campus filtering, admin approval workflow, image attachments |
| **Event Calendar** | Interactive monthly calendar with event creation (faculty/admin) and admin approval |
| **Lost & Found**   | Report lost/found items with category, location, and contact information (AI-matching ready) |
| **Class Schedule** | Personal schedule via embedded link (Google/Canva/Microsoft) |
| **PUPBot**         | AI-ready chatbot with PUPSJ handbook knowledge base |
| **Admin Dashboard**| User management, stats overview, verify/deactivate accounts |

---

## AI Integration Guide

### Chatbot (PUPBot)

The chatbot is designed for easy AI swap. In `src/routes/chatbot.js`:

```javascript
// Current: keyword-based matching
const botResponse = findBestResponse(message);

// Future: Replace with AI API call
// const botResponse = await callAIService(message, context);
```

To integrate an AI service (e.g., OpenAI, Anthropic):

1. Add your AI SDK: `npm install openai` or similar
2. Create `src/services/ai.js` with your API integration
3. In `src/routes/chatbot.js`, replace `findBestResponse()` with your AI function
4. The frontend chat UI (`public/js/app.js`) requires zero changes

### Lost & Found AI Matching

In `public/js/app.js`, search for `AI INTEGRATION POINT`:

```javascript
// After creating a report, call your AI matching endpoint:
const matches = await api('/api/lost-found/ai-match', {
  method: 'POST',
  body: JSON.stringify({ id: result.item.id })
});
```

To add image-based matching:
1. Add image upload support (multer is already installed)
2. Create `/api/lost-found/ai-match` endpoint
3. Use image similarity API (e.g., Google Vision, custom model)
4. The `lf-match-hint` CSS class is already styled for match notifications

---

## Project Structure

```
pupsj-hub/
├── public/                  # Frontend (served as static files)
│   ├── index.html           # SPA entry point
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker
│   ├── css/app.css          # All styles
│   ├── js/app.js            # SPA router + all modules
│   └── icons/               # PWA icons
├── src/
│   ├── server.js            # Express entry point
│   ├── config/database.js   # PostgreSQL connection
│   ├── middleware/auth.js   # JWT authentication
│   └── routes/
│       ├── auth.js          # Login, register, logout
│       ├── announcements.js # CRUD announcements
│       ├── events.js        # CRUD events
│       ├── lostfound.js     # Lost & found reports
│       ├── feedback.js      # Event feedback
│       ├── schedules.js     # Class schedules
│       ├── chatbot.js       # PUPBot (AI-ready)
│       └── admin.js         # User management + stats
├── database/schema.sql      # PostgreSQL schema
├── seed.js                  # Database seeder
├── .env.example             # Environment template
└── package.json
```

---

## Installing as PWA on Mobile

1. Open **http://localhost:3000** (or your deployed URL) in Chrome
2. Tap the three-dot menu (⋮)
3. Select **"Add to Home Screen"** or **"Install App"**
4. The app icon will appear on your home screen

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` on seed/start | Make sure PostgreSQL is running |
| `database "pupsj_hub" does not exist` | Run `CREATE DATABASE pupsj_hub;` in psql |
| `password authentication failed` | Check your `.env` DB_PASSWORD matches your PostgreSQL password |
| Blank page after login | Check browser console; clear cookies and try again |
| Port 3000 already in use | Change PORT in `.env` or stop the other process |
