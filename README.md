# ⚡ JobPulse — AI Job Market Intelligence

> Built for **Anakin Blitz V2 Hackathon** · June 28, 2026

**JobPulse** tells you *exactly* what skills are trending in your target role right now — using live job listings scraped by **Anakin Universal Scraper** and AI analysis powered by **Anakin.ai workflows**.

---

## 🎯 What It Does

1. **Enter a role + location** (e.g. "Frontend Engineer, Bangalore")
2. **Anakin Universal Scraper** pulls live job listings in real-time
3. **Anakin.ai AI workflow** analyzes the data and surfaces:
   - 🎯 Top 8 trending skills (with demand %)
   - 💰 Live salary intelligence (entry → senior)
   - 🏢 Top companies actively hiring
   - 🤖 AI-generated market brief

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Scraping** | [Anakin.io Universal Scraper](https://anakin.io) — `POST /v1/scrape` |
| **AI Analysis** | [Anakin.ai](https://app.anakin.ai) — Chat Completions API |
| **Frontend** | Vanilla HTML + CSS + JavaScript |
| **Deployment** | Vercel (static) |

---

## 🚀 Setup & Run

### 1. Get API Keys

**Anakin.io Scraper Key:**
1. Go to [anakin.io](https://anakin.io)
2. Sign up / log in → Dashboard → API Keys
3. Copy your key

**Anakin.ai Token:**
1. Go to [app.anakin.ai](https://app.anakin.ai)
2. Click your avatar → Account → Integrations
3. Generate API Access Token

### 2. Run Locally

Just open `index.html` in your browser! No build step needed.

```bash
# Or use a local server
npx serve .
```

### 3. Enter API Keys

Click ⚙️ **Configure API Keys** in the app and paste your keys. They're saved in `localStorage`.

---

## 📦 Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow prompts → get live URL
```

---

## 🏗️ Architecture

```
User Input (role + location)
        ↓
Anakin Universal Scraper (anakin.io)
  POST /v1/scrape → Naukri job listings
        ↓
Raw Job Data (title, company, skills, salary)
        ↓
Anakin.ai Chat API
  Structured prompt → JSON analysis
        ↓
Dashboard Render
  Skills bar chart | Salary intel | Companies | AI Brief
```

---

## 📂 File Structure

```
jobpulse/
├── index.html      # Main UI
├── style.css       # Premium dark glassmorphism design
├── app.js          # Core logic (scraper + AI + rendering)
├── vercel.json     # Vercel static deployment config
└── README.md       # This file
```

---

## 🌟 Hackathon Criteria

| Criterion | How We Nail It |
|---|---|
| **Idea (40%)** | Specific pain: job seekers don't know what skills to learn *right now* |
| **Execution (30%)** | Live scraping → real data → working AI flow → polished demo |
| **Real-World Use (30%)** | Every student / job seeker would use this weekly |

---

*Built by Rishita Ramola · Anakin Blitz V2 · June 2026*
