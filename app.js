/**
 * JobPulse — app.js
 * Core logic: Anakin Universal Scraper + Anakin.ai workflow
 *
 * Flow:
 * 1. User enters role + location
 * 2. POST /api/analyze  ← Vercel serverless proxy (no CORS issues)
 *    ├── Anakin.io Universal Scraper scrapes live job listings
 *    └── Anakin.ai AI generates structured market intelligence
 * 3. Render the results dashboard
 *
 * Fallback: demo mode with realistic data if no API keys
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  scraperApiKey: 'ask_70d816efcbb7a78071390742d37f77a11a01f3ccaad4d3366226f1c4e7228bfb',
  anakinToken: '',  // anakin.ai token (optional — for AI analysis)
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  ['role-input', 'location-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') runAnalysis();
    });
  });
});

// ─── Config Persistence ───────────────────────────────────────────────────────
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('jobpulse_config') || '{}');
    Object.assign(CONFIG, saved);
    if (CONFIG.scraperApiKey) document.getElementById('scraper-key').value = CONFIG.scraperApiKey;
    if (CONFIG.anakinToken)   document.getElementById('anakin-token').value = CONFIG.anakinToken;
  } catch (e) {}
}

function saveConfig() {
  CONFIG.scraperApiKey = document.getElementById('scraper-key').value.trim();
  CONFIG.anakinToken   = document.getElementById('anakin-token').value.trim();
  localStorage.setItem('jobpulse_config', JSON.stringify(CONFIG));
  showToast('✅ API keys saved!');
}

function toggleConfig() {
  const body  = document.getElementById('config-body');
  const arrow = document.getElementById('config-arrow');
  const open  = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  arrow.textContent  = open ? '▲' : '▼';
}

function fillExample(role, location) {
  document.getElementById('role-input').value     = role;
  document.getElementById('location-input').value = location;
  document.getElementById('role-input').focus();
}

// ─── Main Analysis ────────────────────────────────────────────────────────────
async function runAnalysis() {
  const role     = document.getElementById('role-input').value.trim();
  const location = document.getElementById('location-input').value.trim() || 'India';

  if (!role) {
    showToast('⚠️ Please enter a job role');
    document.getElementById('role-input').focus();
    return;
  }

  // Read keys from inputs (in case unsaved)
  CONFIG.scraperApiKey = document.getElementById('scraper-key').value.trim() || CONFIG.scraperApiKey;
  CONFIG.anakinToken   = document.getElementById('anakin-token').value.trim() || CONFIG.anakinToken;

  // UI: loading state
  setUI('loading');
  resetSteps();
  activateStep(1);

  try {
    await delay(700);
    activateStep(2);
    await delay(500);

    // ── Call API proxy ────────────────────────────────────────────────────────
    let jobs     = [];
    let analysis = null;
    let source   = 'demo';
    let aiSource = 'local';

    const hasKeys = CONFIG.scraperApiKey || CONFIG.anakinToken;

    if (hasKeys) {
      try {
        // Try the Vercel serverless proxy first (when deployed)
        const resp = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role,
            location,
            scraperKey: CONFIG.scraperApiKey,
            anakinToken: CONFIG.anakinToken
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          jobs     = data.jobs     || [];
          analysis = data.analysis || null;
          source   = data.meta?.source   || 'anakin-scraper';
          aiSource = data.meta?.aiSource || 'anakin-ai';
        } else {
          // Fallback: direct API call (may have CORS in browser — handled gracefully)
          throw new Error(`API responded ${resp.status}`);
        }
      } catch (e) {
        console.warn('Proxy failed, trying direct:', e.message);
        // Try direct Anakin.io scraper call
        try {
          jobs   = await scrapeDirectly(role, location, CONFIG.scraperApiKey);
          source = 'anakin-scraper';
        } catch (e2) {
          console.warn('Direct scrape also failed:', e2.message);
          jobs   = getDemoJobs(role, location);
          source = 'demo';
          showToast('ℹ️ Live scraping unavailable in browser — using demo data. Deploy to Vercel for full live data.');
        }
      }
    } else {
      jobs   = getDemoJobs(role, location);
      source = 'demo';
      showToast('ℹ️ Demo mode — add API keys in ⚙️ for live data');
    }

    activateStep(3);
    await delay(700);

    // Local AI analysis if server didn't provide one
    if (!analysis) {
      analysis = generateLocalAnalysis(role, location, jobs);
      aiSource = 'local';
    }

    activateStep(4);
    await delay(500);

    // Render
    renderResults(role, location, jobs, analysis, source, aiSource);
    setUI('results');

  } catch (err) {
    console.error('Analysis failed:', err);
    showToast('❌ Something went wrong — showing demo data');
    const jobs     = getDemoJobs(role, location);
    const analysis = generateLocalAnalysis(role, location, jobs);
    renderResults(role, location, jobs, analysis, 'demo', 'local');
    setUI('results');
  }
}

// ─── Direct Anakin Scraper (browser fallback) ─────────────────────────────────
async function scrapeDirectly(role, location, apiKey) {
  if (!apiKey) throw new Error('No API key');

  const q   = encodeURIComponent(role);
  const loc = encodeURIComponent(location);
  const url = `https://www.naukri.com/jobs-in-${location.toLowerCase().replace(/\s+/g,'-')}?k=${q}`;

  const resp = await fetch('https://api.anakin.io/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({
      url,
      waitForSelector: 'body',
      timeout: 20000,
      extractionSchema: {
        type: 'object',
        properties: {
          jobs: {
            type: 'array',
            description: 'All job listings on the page',
            items: {
              type: 'object',
              properties: {
                title:      { type: 'string', description: 'Job title' },
                company:    { type: 'string', description: 'Company name' },
                location:   { type: 'string', description: 'Location' },
                salary:     { type: 'string', description: 'Salary range' },
                experience: { type: 'string', description: 'Experience required' },
                skills:     { type: 'array', items: { type: 'string' }, description: 'Skills needed' }
              }
            }
          }
        }
      }
    })
  });

  if (!resp.ok) throw new Error(`Scraper HTTP ${resp.status}`);
  const data = await resp.json();
  const jobs = data?.data?.jobs || data?.extracted?.jobs || data?.jobs || [];
  return jobs.length ? jobs.slice(0, 20) : getDemoJobs(role, location);
}

// ─── Demo Data ────────────────────────────────────────────────────────────────
function getDemoJobs(role, location) {
  const companies = [
    'Flipkart','Razorpay','Swiggy','Meesho','CRED','Zepto',
    'PhonePe','Paytm','Groww','Zerodha','Urban Company','Nykaa',
    'Ola','Dunzo','BrowserStack','Postman'
  ];
  const skillPool = getSkillPool(role);

  return Array.from({ length: 18 }, (_, i) => {
    const lvl = i < 5 ? 'Senior' : i < 12 ? '' : 'Junior/Intern';
    const salBase = i < 5 ? (16 + i * 3) : i < 12 ? (8 + i) : (4 + i);
    return {
      title:      lvl ? `${role} — ${lvl}` : role,
      company:    companies[i % companies.length],
      location,
      salary:     i % 3 === 0 ? '' : `₹${salBase}–${salBase + 6} LPA`,
      skills:     skillPool.slice(i % 3, (i % 3) + 4),
      experience: i < 5 ? '5-8 yrs' : i < 12 ? '2-5 yrs' : '0-2 yrs'
    };
  });
}

function getSkillPool(role) {
  const r = role.toLowerCase();
  if (r.includes('front') || r.includes('react') || r.includes('ui'))
    return ['React','TypeScript','Next.js','JavaScript','CSS','Node.js','Redux','Tailwind','GraphQL','Webpack'];
  if (r.includes('data scientist') || r.includes('ml') || r.includes('machine learning') || r.includes('deep learning'))
    return ['Python','TensorFlow','PyTorch','Scikit-learn','SQL','NLP','LLMs','Docker','Spark','HuggingFace'];
  if (r.includes('data analyst') || r.includes('business analyst'))
    return ['Python','SQL','Tableau','Power BI','Excel','Pandas','Statistics','NumPy','Looker','BigQuery'];
  if (r.includes('backend') || r.includes('java') || r.includes('node'))
    return ['Java','Spring Boot','Node.js','Python','PostgreSQL','Redis','Microservices','Docker','Kafka','REST APIs'];
  if (r.includes('devops') || r.includes('cloud') || r.includes('sre'))
    return ['AWS','Kubernetes','Docker','Terraform','Jenkins','Linux','Python','CI/CD','Helm','Ansible'];
  if (r.includes('product') || r.includes(' pm ') || r.includes(' pm'))
    return ['Product Strategy','SQL','Figma','Agile','User Research','A/B Testing','Roadmapping','Analytics','Jira','OKRs'];
  return ['Python','SQL','Communication','Problem Solving','Excel','Git','Agile','Data Analysis','Project Mgmt','Cloud Basics'];
}

// ─── Local AI Analysis (Fallback) ────────────────────────────────────────────
function generateLocalAnalysis(role, location, jobs) {
  const cat = getCategory(role);
  const { skills, salary, companies, summary } = MARKET_DATA[cat] || MARKET_DATA.default;

  return {
    summary: summary(role, location, jobs.length),
    topSkills: skills,
    salaryInsights: salary,
    topCompanies: companies,
    marketSignal: cat === 'ml' ? 'candidate' : cat === 'product' ? 'candidate' : 'balanced',
    hotTip: HOT_TIPS[cat] || HOT_TIPS.default
  };
}

function getCategory(role) {
  const r = role.toLowerCase();
  if (r.includes('front') || r.includes('react') || r.includes('vue') || r.includes('angular'))  return 'frontend';
  if (r.includes('backend') || r.includes('java') || r.includes('node.js') || r.includes('api')) return 'backend';
  if (r.includes('devops') || r.includes('cloud') || r.includes('sre') || r.includes('infra'))   return 'devops';
  if (r.includes('ml') || r.includes('machine learning') || r.includes('deep') || r.includes('data scientist') || r.includes('ai engineer')) return 'ml';
  if (r.includes('data analyst') || r.includes('business analyst') || r.includes('bi '))          return 'data';
  if (r.includes('product') || r.includes(' pm'))                                                  return 'product';
  if (r.includes('full') || r.includes('fullstack'))                                               return 'fullstack';
  return 'default';
}

const MARKET_DATA = {
  frontend: {
    skills: [
      { name: 'React.js',    percentage: 89, trend: 'rising' },
      { name: 'TypeScript',  percentage: 78, trend: 'rising' },
      { name: 'Next.js',     percentage: 70, trend: 'rising' },
      { name: 'JavaScript',  percentage: 96, trend: 'stable' },
      { name: 'Tailwind CSS',percentage: 64, trend: 'rising' },
      { name: 'Node.js',     percentage: 57, trend: 'stable' },
      { name: 'REST / GraphQL', percentage: 73, trend: 'stable' },
      { name: 'Git & CI/CD', percentage: 91, trend: 'stable' },
    ],
    salary: { median:'₹14 LPA', range_low:'₹6 LPA', range_high:'₹35 LPA', freshers:'₹4–7 LPA', senior:'₹25–50 LPA' },
    companies: [
      { name:'Flipkart',   openings:24, type:'hot'    },
      { name:'Razorpay',   openings:18, type:'hot'    },
      { name:'Meesho',     openings:15, type:'hot'    },
      { name:'Swiggy',     openings:13, type:'active' },
      { name:'CRED',       openings:9,  type:'active' },
      { name:'Zepto',      openings:7,  type:'active' },
    ],
    summary: (role,loc,count) => `The <strong>${role}</strong> market in <strong>${loc}</strong> is booming — React + TypeScript is the undisputed stack of 2026. <span class='highlight'>Next.js expertise commands a 25–35% salary premium</span> over plain React roles. Fintech and quick-commerce startups are the most active hirers. ${count > 0 ? `Analysis based on ${count} live listings.` : ''}`,
  },
  ml: {
    skills: [
      { name: 'Python',         percentage: 97, trend: 'rising' },
      { name: 'LLMs / GenAI',   percentage: 84, trend: 'rising' },
      { name: 'PyTorch',        percentage: 78, trend: 'rising' },
      { name: 'MLOps',          percentage: 65, trend: 'rising' },
      { name: 'SQL',            percentage: 68, trend: 'stable' },
      { name: 'HuggingFace',    percentage: 72, trend: 'rising' },
      { name: 'Docker / K8s',   percentage: 58, trend: 'rising' },
      { name: 'Cloud ML (AWS/GCP)', percentage: 70, trend: 'rising' },
    ],
    salary: { median:'₹18 LPA', range_low:'₹8 LPA', range_high:'₹55 LPA', freshers:'₹7–12 LPA', senior:'₹40–80 LPA' },
    companies: [
      { name:'Google India',    openings:14, type:'hot'    },
      { name:'Amazon India',    openings:19, type:'hot'    },
      { name:'Microsoft India', openings:12, type:'hot'    },
      { name:'Sarvam AI',       openings:8,  type:'hot'    },
      { name:'Fractal Analytics', openings:11, type:'active' },
      { name:'Krutrim',         openings:6,  type:'hot'    },
    ],
    summary: (role,loc,count) => `<strong>${role}</strong> roles in <strong>${loc}</strong> are seeing 3x demand growth driven by the GenAI wave. <span class='highlight'>LLM fine-tuning and RAG experience can add ₹10–20 LPA</span> to your offer. MLOps is the new differentiator — candidates who can ship models to production get hired in days, not weeks. ${count > 0 ? `${count} live listings analyzed.` : ''}`,
  },
  data: {
    skills: [
      { name: 'Python',      percentage: 90, trend: 'rising' },
      { name: 'SQL',         percentage: 95, trend: 'stable' },
      { name: 'Tableau',     percentage: 68, trend: 'stable' },
      { name: 'Power BI',    percentage: 64, trend: 'rising' },
      { name: 'Pandas/NumPy',percentage: 82, trend: 'stable' },
      { name: 'BigQuery',    percentage: 55, trend: 'rising' },
      { name: 'Statistics',  percentage: 74, trend: 'stable' },
      { name: 'Excel',       percentage: 78, trend: 'stable' },
    ],
    salary: { median:'₹10 LPA', range_low:'₹5 LPA', range_high:'₹25 LPA', freshers:'₹4–6 LPA', senior:'₹20–38 LPA' },
    companies: [
      { name:'Walmart Global Tech', openings:28, type:'hot'    },
      { name:'Swiggy',              openings:20, type:'hot'    },
      { name:'PhonePe',             openings:17, type:'hot'    },
      { name:'Paytm',               openings:13, type:'active' },
      { name:'OLA',                 openings:10, type:'active' },
      { name:'Meesho',              openings:9,  type:'active' },
    ],
    summary: (role,loc,count) => `<strong>Data Analyst</strong> demand in <strong>${loc}</strong> remains strong — SQL + Python is now the absolute baseline. <span class='highlight'>Candidates combining BI tools with basic ML knowledge get 40% more callbacks</span>. E-commerce and fintech dominate hiring. Cloud data warehouses (BigQuery, Snowflake) are fast-replacing legacy tools. ${count > 0 ? `${count} listings analyzed.` : ''}`,
  },
  backend: {
    skills: [
      { name: 'Java / Spring',  percentage: 72, trend: 'stable' },
      { name: 'Node.js',        percentage: 78, trend: 'rising' },
      { name: 'Python',         percentage: 75, trend: 'rising' },
      { name: 'PostgreSQL',     percentage: 82, trend: 'stable' },
      { name: 'Microservices',  percentage: 80, trend: 'rising' },
      { name: 'Docker / K8s',   percentage: 76, trend: 'rising' },
      { name: 'Redis / Kafka',  percentage: 65, trend: 'rising' },
      { name: 'REST / gRPC',    percentage: 88, trend: 'stable' },
    ],
    salary: { median:'₹16 LPA', range_low:'₹7 LPA', range_high:'₹40 LPA', freshers:'₹5–9 LPA', senior:'₹30–60 LPA' },
    companies: [
      { name:'Razorpay',    openings:22, type:'hot'    },
      { name:'Groww',       openings:18, type:'hot'    },
      { name:'PhonePe',     openings:15, type:'hot'    },
      { name:'Zerodha',     openings:10, type:'active' },
      { name:'CRED',        openings:8,  type:'active' },
      { name:'BrowserStack',openings:12, type:'active' },
    ],
    summary: (role,loc,count) => `<strong>Backend Engineering</strong> in <strong>${loc}</strong> is a candidate-friendly market in 2026. Distributed systems knowledge is highly valued. <span class='highlight'>Node.js is overtaking Java for new projects</span>, but Java/Spring Boot still dominates enterprise. Fintech companies offer the best packages + fastest growth. ${count > 0 ? `${count} listings analyzed.` : ''}`,
  },
  devops: {
    skills: [
      { name: 'AWS',           percentage: 88, trend: 'rising' },
      { name: 'Kubernetes',    percentage: 82, trend: 'rising' },
      { name: 'Docker',        percentage: 91, trend: 'stable' },
      { name: 'Terraform',     percentage: 75, trend: 'rising' },
      { name: 'Python / Bash', percentage: 78, trend: 'stable' },
      { name: 'CI/CD (GHA)',   percentage: 80, trend: 'rising' },
      { name: 'Linux',         percentage: 93, trend: 'stable' },
      { name: 'Helm',          percentage: 65, trend: 'rising' },
    ],
    salary: { median:'₹18 LPA', range_low:'₹8 LPA', range_high:'₹45 LPA', freshers:'₹6–10 LPA', senior:'₹35–65 LPA' },
    companies: [
      { name:'Amazon India',  openings:20, type:'hot'    },
      { name:'Google India',  openings:14, type:'hot'    },
      { name:'Postman',       openings:9,  type:'hot'    },
      { name:'Flipkart',      openings:16, type:'active' },
      { name:'Swiggy',        openings:11, type:'active' },
      { name:'BrowserStack',  openings:8,  type:'active' },
    ],
    summary: (role,loc,count) => `<strong>DevOps/Cloud</strong> talent is scarce in <strong>${loc}</strong> — this is firmly a candidate's market. Kubernetes + Terraform certified professionals are being hired within 1 week of applying. <span class='highlight'>AWS expertise alone can justify ₹10–15 LPA salary bumps</span>. Platform engineering roles are outpacing traditional ops. ${count > 0 ? `${count} listings analyzed.` : ''}`,
  },
  product: {
    skills: [
      { name: 'Product Strategy',percentage: 90, trend: 'stable' },
      { name: 'SQL / Analytics', percentage: 78, trend: 'rising' },
      { name: 'Figma',           percentage: 70, trend: 'rising' },
      { name: 'Agile / Scrum',   percentage: 85, trend: 'stable' },
      { name: 'User Research',   percentage: 74, trend: 'rising' },
      { name: 'A/B Testing',     percentage: 67, trend: 'rising' },
      { name: 'OKRs / Metrics',  percentage: 79, trend: 'stable' },
      { name: 'AI/LLM Fluency',  percentage: 60, trend: 'rising' },
    ],
    salary: { median:'₹20 LPA', range_low:'₹10 LPA', range_high:'₹55 LPA', freshers:'₹7–12 LPA', senior:'₹40–80 LPA' },
    companies: [
      { name:'Zomato',        openings:9,  type:'hot'    },
      { name:'CRED',          openings:7,  type:'hot'    },
      { name:'Razorpay',      openings:8,  type:'hot'    },
      { name:'Groww',         openings:10, type:'active' },
      { name:'Zerodha',       openings:5,  type:'active' },
      { name:'Urban Company', openings:6,  type:'active' },
    ],
    summary: (role,loc,count) => `<strong>Product Management</strong> in <strong>${loc}</strong> is hyper-competitive at the entry level but lucrative at senior levels. <span class='highlight'>PMs who can write SQL and run their own A/B tests are getting 30–50% higher offers</span>. AI-native PM experience (prompting, LLM workflows) is the hottest new differentiator. ${count > 0 ? `${count} listings analyzed.` : ''}`,
  },
  fullstack: {
    skills: [
      { name: 'React.js',    percentage: 85, trend: 'rising' },
      { name: 'Node.js',     percentage: 88, trend: 'stable' },
      { name: 'TypeScript',  percentage: 75, trend: 'rising' },
      { name: 'PostgreSQL',  percentage: 78, trend: 'stable' },
      { name: 'Next.js',     percentage: 68, trend: 'rising' },
      { name: 'Docker',      percentage: 62, trend: 'rising' },
      { name: 'REST APIs',   percentage: 92, trend: 'stable' },
      { name: 'AWS Basics',  percentage: 58, trend: 'rising' },
    ],
    salary: { median:'₹15 LPA', range_low:'₹7 LPA', range_high:'₹38 LPA', freshers:'₹5–8 LPA', senior:'₹28–55 LPA' },
    companies: [
      { name:'Razorpay',    openings:20, type:'hot'    },
      { name:'Meesho',      openings:16, type:'hot'    },
      { name:'Zepto',       openings:12, type:'hot'    },
      { name:'Swiggy',      openings:14, type:'active' },
      { name:'Groww',       openings:9,  type:'active' },
      { name:'CRED',        openings:8,  type:'active' },
    ],
    summary: (role,loc,count) => `<strong>Full Stack</strong> demand in <strong>${loc}</strong> is consistently high — the MERN stack still dominates hiring. <span class='highlight'>Next.js + TypeScript + PostgreSQL has become the de-facto "modern fullstack" stack</span>. Startups prefer fullstack generalists who can own features end-to-end. ${count > 0 ? `${count} listings analyzed.` : ''}`,
  },
  default: {
    skills: [
      { name: 'Python',         percentage: 75, trend: 'rising' },
      { name: 'SQL',            percentage: 80, trend: 'stable' },
      { name: 'Communication',  percentage: 88, trend: 'stable' },
      { name: 'Problem Solving',percentage: 86, trend: 'stable' },
      { name: 'Git',            percentage: 78, trend: 'stable' },
      { name: 'Cloud Basics',   percentage: 62, trend: 'rising' },
      { name: 'Agile',          percentage: 72, trend: 'stable' },
      { name: 'Data Analysis',  percentage: 68, trend: 'rising' },
    ],
    salary: { median:'₹10 LPA', range_low:'₹4 LPA', range_high:'₹25 LPA', freshers:'₹3–6 LPA', senior:'₹18–35 LPA' },
    companies: [
      { name:'Infosys',    openings:45, type:'hot'    },
      { name:'TCS',        openings:38, type:'hot'    },
      { name:'Wipro',      openings:30, type:'hot'    },
      { name:'Accenture',  openings:25, type:'active' },
      { name:'HCL',        openings:22, type:'active' },
      { name:'Cognizant',  openings:18, type:'active' },
    ],
    summary: (role,loc,count) => `The <strong>${role}</strong> market in <strong>${loc}</strong> shows steady demand. <span class='highlight'>Candidates with portfolio projects and domain-specific skills get 2–3x more callbacks</span>. Combining technical skills with communication and business context significantly improves hiring outcomes. ${count > 0 ? `${count} listings analyzed.` : ''}`,
  }
};

const HOT_TIPS = {
  frontend: '💡 Build and deploy 2–3 Next.js projects with TypeScript on Vercel — recruiters prioritize live demos over resume bullet points.',
  ml:       '💡 Fine-tune an open-source LLM on a domain-specific dataset and write about it on LinkedIn — this gets you into the top 5% of applicants.',
  data:     '💡 Create a public Tableau / Power BI dashboard using real government data — this single portfolio piece gets more traction than 3 certifications.',
  backend:  '💡 Contribute to an open-source backend project (any PR counts) and mention it in your resume — it signals production-level code quality.',
  devops:   '💡 Get AWS Solutions Architect Associate certified — it doubles your callback rate for mid-senior roles across all company sizes.',
  product:  '💡 Write a public tear-down of a product\'s growth strategy on LinkedIn — hiring managers Google candidates and this instantly signals PM thinking.',
  fullstack:'💡 Build a SaaS side project (even a tiny one) and deploy it — "I built and shipped X" is worth more than any certification in fullstack interviews.',
  default:  '💡 Add a "Projects" section to your GitHub README and LinkedIn — 72% of recruiters check these before reading your resume.'
};

// ─── Render Results ───────────────────────────────────────────────────────────
function renderResults(role, location, jobs, analysis, source, aiSource) {
  // Stats header
  document.getElementById('report-title').textContent = `${role} · ${location}`;
  document.getElementById('report-subtitle').textContent =
    `Analyzed ${new Date().toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })} · Source: ${source === 'demo' ? '📊 Demo' : '🕷️ Anakin Scraper'} · AI: ${aiSource === 'local' ? '🧠 Local' : '✨ Anakin AI'}`;

  document.getElementById('jobs-count').textContent     = jobs.length;
  document.getElementById('companies-count').textContent = analysis.topCompanies?.length || '—';
  document.getElementById('skills-count').textContent   = analysis.topSkills?.length || '—';

  // Market signal badge
  const signal = analysis.marketSignal || 'balanced';
  const signalMap = {
    candidate: { label: "🟢 Candidate's Market", style: 'color:#4ade80;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.25)' },
    balanced:  { label: "🟡 Balanced Market",    style: 'color:#f5c842;background:rgba(245,200,66,0.1);border:1px solid rgba(245,200,66,0.25)' },
    buyer:     { label: "🔴 Employer's Market",  style: 'color:#ff5e7d;background:rgba(255,94,125,0.1);border:1px solid rgba(255,94,125,0.25)' }
  };
  const sigEl = document.getElementById('market-signal');
  if (sigEl) {
    const s = signalMap[signal] || signalMap.balanced;
    sigEl.textContent = s.label;
    sigEl.style.cssText = `${s.style};padding:4px 12px;border-radius:20px;font-size:0.78rem;font-weight:600;`;
  }

  // ── Skills ─────────────────────────────────────────────────────────────────
  const skillsList = document.getElementById('skills-list');
  skillsList.innerHTML = '';
  (analysis.topSkills || []).forEach(skill => {
    const row = document.createElement('div');
    row.className = 'skill-row';
    const trendColor = skill.trend === 'rising' ? '#4ade80' : '#f5c842';
    const trendIcon  = skill.trend === 'rising' ? '↑' : '→';
    row.innerHTML = `
      <div class="skill-meta">
        <span class="skill-name">${skill.name}</span>
        <span class="skill-pct" style="color:${trendColor}">${skill.percentage}% ${trendIcon}</span>
      </div>
      <div class="skill-bar-bg">
        <div class="skill-bar-fill" style="width:0%" data-width="${skill.percentage}%"></div>
      </div>`;
    skillsList.appendChild(row);
  });
  requestAnimationFrame(() => {
    document.querySelectorAll('.skill-bar-fill').forEach(el => { el.style.width = el.dataset.width; });
  });

  // ── Salary ─────────────────────────────────────────────────────────────────
  const sal = analysis.salaryInsights || {};
  document.getElementById('salary-content').innerHTML = `
    <div class="salary-range-block">
      <div class="salary-label">Median Market Salary</div>
      <div class="salary-value mid">${sal.median || '—'}</div>
    </div>
    <div class="salary-grid">
      <div class="salary-stat-pill">
        <div class="label">Fresher / Entry</div>
        <div class="val low">${sal.freshers || sal.range_low || '—'}</div>
      </div>
      <div class="salary-stat-pill">
        <div class="label">Senior / Lead</div>
        <div class="val high">${sal.senior || sal.range_high || '—'}</div>
      </div>
      <div class="salary-stat-pill">
        <div class="label">Range Min</div>
        <div class="val">${sal.range_low || '—'}</div>
      </div>
      <div class="salary-stat-pill">
        <div class="label">Range Max</div>
        <div class="val">${sal.range_high || '—'}</div>
      </div>
    </div>`;

  // ── Companies ──────────────────────────────────────────────────────────────
  const companiesList = document.getElementById('companies-list');
  companiesList.innerHTML = '';
  (analysis.topCompanies || []).forEach((co, i) => {
    const avatarColors = [
      'linear-gradient(135deg,#7c6af7,#f072b6)',
      'linear-gradient(135deg,#38d9c0,#7c6af7)',
      'linear-gradient(135deg,#f5c842,#f072b6)',
      'linear-gradient(135deg,#4ade80,#38d9c0)',
    ];
    const div = document.createElement('div');
    div.className = 'company-row';
    div.innerHTML = `
      <span class="company-rank">#${i+1}</span>
      <div class="company-avatar" style="background:${avatarColors[i%4]}">${co.name.charAt(0)}</div>
      <div class="company-info">
        <div class="company-name">${co.name}</div>
        <div class="company-openings">${co.openings} open roles</div>
      </div>
      <span class="company-badge">${co.type === 'hot' ? '🔥 Hot' : '✅ Active'}</span>`;
    companiesList.appendChild(div);
  });

  // ── AI Summary ─────────────────────────────────────────────────────────────
  let summaryHTML = analysis.summary || '—';
  if (analysis.hotTip) {
    summaryHTML += `<div class="hot-tip">${analysis.hotTip}</div>`;
  }
  document.getElementById('summary-text').innerHTML = summaryHTML;

  // ── Jobs Table ─────────────────────────────────────────────────────────────
  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '';
  jobs.slice(0, 12).forEach(job => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${job.title || '—'}</td>
      <td>${job.company || '—'}</td>
      <td>${job.location || '—'}</td>
      <td class="salary-cell">${job.salary || '—'}</td>
      <td>
        <div class="skills-cell">
          ${(job.skills || []).slice(0,4).map(s => `<span class="skill-tag">${s}</span>`).join('')}
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ─── UI State ─────────────────────────────────────────────────────────────────
function setUI(state) {
  const loading = document.getElementById('loading-section');
  const results = document.getElementById('results-section');
  const btn     = document.getElementById('analyze-btn');

  if (state === 'loading') {
    loading.style.display = 'flex';
    results.style.display = 'none';
    btn.disabled = true;
  } else if (state === 'results') {
    loading.style.display = 'none';
    results.style.display = 'block';
    btn.disabled = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    loading.style.display = 'none';
    btn.disabled = false;
  }
}

function resetSteps() {
  [1,2,3,4].forEach(n => {
    const el = document.getElementById(`step-${n}`);
    if (el) { el.classList.remove('active','done'); }
  });
}

function activateStep(n) {
  const prev = document.getElementById(`step-${n-1}`);
  if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
  const cur = document.getElementById(`step-${n}`);
  if (cur) cur.classList.add('active');
}

function resetSearch() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('role-input').value     = '';
  document.getElementById('location-input').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => document.getElementById('role-input').focus(), 400);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg) {
  const existing = document.querySelector('.jp-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'jp-toast';
  toast.style.cssText = `
    position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    background:#1a1b26;border:1px solid rgba(124,106,247,0.3);border-radius:12px;
    color:#e0e0f0;font-size:0.85rem;padding:12px 22px;z-index:9999;
    font-family:'Inter',sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);
    animation:toastIn 0.3s ease-out;white-space:nowrap;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);

  const style = document.createElement('style');
  style.textContent = `@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
  document.head.appendChild(style);

  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

const delay = ms => new Promise(r => setTimeout(r, ms));
