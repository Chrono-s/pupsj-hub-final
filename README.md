# PUPSJ HUB - Progressive Web Application (MySQL Edition)

A centralized campus platform for PUP San Juan featuring announcements, event calendar, lost & found, class schedules, loading management, documents, queueing, and an intelligent assistant.

---

## Prerequisites

- **Node.js** v18+ — [Download](https://nodejs.org)
- **MySQL Server** 8.0+ — [Download](https://dev.mysql.com/downloads/mysql/)
- **Git** (optional)

---

## Setup Instructions

### Step 1: Install MySQL and Create the Database

Open your terminal (Command Prompt, PowerShell, or Terminal) and run:

```bash
# Login to MySQL
mysql -u root -p

# Inside the MySQL client shell, create the database:
CREATE DATABASE pupsj_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# Exit MySQL
EXIT;
```

### Step 2: Clone or Copy the Project

Place the `pupsj-hub` folder anywhere on your computer.

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Configure Environment Variables

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Open `.env` in a text editor and update your database credentials:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pupsj_hub
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD_HERE

PORT=3000
NODE_ENV=development

JWT_SECRET=change_this_to_a_random_string_abc123
JWT_EXPIRES_IN=7d
SESSION_SECRET=change_this_to_another_random_string
```

### Step 5: Run the Database Setup

This creates all tables and inserts optional default administrator and template data:

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

## Key Modules

| Module             | Description |
|--------------------|-------------|
| **Announcements**  | Post/view announcements with department + campus-wide visibility, approval workflow, and image attachments. |
| **Event Calendar** | Interactive monthly calendar with event scheduling, RSVPs, attendance tracking, and feedback. |
| **Lost & Found**   | Report lost or found items with photos, automated similarity matching, claims, and resolution history. |
| **Class Schedules**| Faculty and student personal schedules and section timetables. |
| **Faculty Loading**| Full teaching load requests, clash detection, room assignments, and approval workflows. |
| **Documents**      | Downloadable institutional forms, categorized file templates, and department-scoped resources. |
| **Queueing**       | Real-time campus office queue tickets, appointment booking, and live window display. |
| **PUPBot**         | Knowledge-grounded campus assistant querying live DB data and handbook policies. |
| **Admin Panel**    | Comprehensive administration dashboard, role management, firewall, and system settings. |

---

## Project Structure

```
pupsj-hub/
├── public/                  # Frontend SPA (served as static files)
│   ├── index.html           # SPA entry point
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker
│   ├── css/app.css          # Core CSS architecture
│   ├── js/app.js            # SPA application controller & views
│   ├── icons/               # PWA icons
│   └── uploads/             # Media storage (git-ignored)
├── src/
│   ├── server.js            # Express application entry point
│   ├── config/database.js   # MySQL connection pool (mysql2/promise)
│   ├── middleware/          # Authentication, RBAC, firewall, and file upload middlewares
│   ├── services/            # Notifications, mailer, and heuristic matchers
│   └── routes/              # Modular Express REST API route handlers
├── database/schema.sql      # Clean MySQL 8.0+ schema definitions
├── seed.js                  # Database initial seed script
├── .env.example             # Clean environment template
└── package.json
```

---

## Installing as PWA on Mobile

1. Open **http://localhost:3000** (or your deployed URL) in Chrome / Safari
2. Tap the browser menu or share icon
3. Select **"Add to Home Screen"** or **"Install App"**
4. The application icon will appear on your device home screen

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` on seed/start | Ensure your local MySQL server service is active on port 3306 |
| `Unknown database 'pupsj_hub'` | Run `CREATE DATABASE pupsj_hub;` in your MySQL console |
| `Access denied for user` | Verify `DB_USER` and `DB_PASSWORD` in your `.env` file |
| Port 3000 already in use | Change `PORT` in `.env` or terminate the occupying process |
