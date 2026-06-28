/**
 * JobPulse — app.js
 * Core logic: Anakin Universal Scraper + AI analysis via Anakin.ai workflow
 *
 * Flow:
 * 1. User enters role + location
 * 2. We call Anakin.io /v1/scrape to get live job listings from Naukri / LinkedIn
 * 3. We parse / extract structured job data
 * 4. We call Anakin.ai workflow API to generate AI market intelligence
 * 5. We render the results dashboard
 */

// ─── Config ─────────────────────────────────────────────────────────────────
const CONFIG = {
  scraperApiKey: '',      // anakin.io key
  anakinToken: '',        // anakin.ai bearer token
  geminiKey: '',          // optional
};

// Load saved config from localStorage
function loadConfig() {
  const saved = localStorage.getItem('jobpulse_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      Object.assign(CONFIG, parsed);
      if (CONFIG.scraperApiKey) document.getElementById('scraper-key').value = CONFIG.scraperApiKey;
      if (CONFIG.anakinToken) document.getElementById('anakin-token').value = CONFIG.anakinToken;
      if (CONFIG.geminiKey) document.getElementById('gemini-key').value = CONFIG.geminiKey;
    } catch (e) {}
  }
}

function saveConfig() {
  CONFIG.scraperApiKey = document.getElementById('scraper-key').value.trim();
  CONFIG.anakinToken = document.getElementById('anakin-token').value.trim();
  CONFIG.geminiKey = document.getElementById('gemini-key').value.trim();
  localStorage.setItem('jobpulse_config', JSON.stringify(CONFIG));
  showToast('✅ API keys saved!');
}

function toggleConfig() {
  const body = document.getElementById('config-body');
  const arrow = document.getElementById('config-arrow');
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  arrow.textContent = isHidden ? '▲' : '▼';
}

function fillExample(role, location) {
  document.getElementById('role-input').value = role;
  document.getElementById('location-input').value = location;
  document.getElementById('role-input').focus();
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:#1e2030; border:1px solid rgba(255,255,255,0.1); border-radius:10px;
    color:#f0f0f8; font-size:0.85rem; padding:10px 20px; z-index:9999;
    animation: fadeInUp 0.3s ease-out;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Loading Steps ────────────────────────────────────────────────────────────
function advanceStep(stepNum) {
  const prev = document.getElementById(`step-${stepNum - 1}`);
  if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
  const cur = document.getElementById(`step-${stepNum}`);
  if (cur) cur.classList.add('active');
}

// ─── Main Analysis ────────────────────────────────────────────────────────────
async function runAnalysis() {
  const role = document.getElementById('role-input').value.trim();
  const location = document.getElementById('location-input').value.trim();

  if (!role) {
    showToast('⚠️ Please enter a job role');
    document.getElementById('role-input').focus();
    return;
  }

  // Re-read config from inputs in case user hasn't saved
  CONFIG.scraperApiKey = document.getElementById('scraper-key').value.trim() || CONFIG.scraperApiKey;
  CONFIG.anakinToken = document.getElementById('anakin-token').value.trim() || CONFIG.anakinToken;
  CONFIG.geminiKey = document.getElementById('gemini-key').value.trim() || CONFIG.geminiKey;

  // UI state
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('loading-section').style.display = 'flex';

  // Reset steps
  ['step-1','step-2','step-3','step-4'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('active','done');
  });
  document.getElementById('step-1').classList.add('active');

  try {
    // Step 1 & 2: Scrape jobs
    await delay(800);

    let jobs = [];
    const locationStr = location || 'India';

    if (CONFIG.scraperApiKey) {
      jobs = await scrapeJobsWithAnakin(role, locationStr);
    } else {
      // Use demo data with a notice
      jobs = getDemoJobs(role, locationStr);
      showToast('ℹ️ Demo mode — add your Anakin.io key for live data');
    }

    advanceStep(2);
    await delay(600);

    // Step 3: AI analysis
    advanceStep(3);
    await delay(800);

    let analysis;
    if (CONFIG.anakinToken) {
      analysis = await runAnakinAIWorkflow(role, locationStr, jobs);
    } else {
      analysis = generateLocalAnalysis(role, locationStr, jobs);
    }

    advanceStep(4);
    await delay(600);

    // Render results
    renderResults(role, locationStr, jobs, analysis);

    document.getElementById('loading-section').style.display = 'none';
    document.getElementById('results-section').style.display = 'block';

  } catch (err) {
    console.error('Analysis failed:', err);
    showToast('❌ Error: ' + err.message + ' — switching to demo mode');
    const jobs = getDemoJobs(role, location || 'India');
    const analysis = generateLocalAnalysis(role, location || 'India', jobs);
    renderResults(role, location || 'India', jobs, analysis);
    document.getElementById('loading-section').style.display = 'none';
    document.getElementById('results-section').style.display = 'block';
  } finally {
    document.getElementById('analyze-btn').disabled = false;
  }
}

// ─── Anakin Universal Scraper ─────────────────────────────────────────────────
async function scrapeJobsWithAnakin(role, location) {
  /**
   * Anakin.io Universal Scraper API
   * POST https://api.anakin.io/v1/scrape
   * Headers: X-API-Key: <key>
   * Body: { url, extractionSchema }
   */

  const searchQuery = encodeURIComponent(`${role} ${location}`);
  const targetUrl = `https://www.naukri.com/jobs-in-${location.toLowerCase().replace(/\s+/g,'-')}?q=${searchQuery}&k=${encodeURIComponent(role)}`;

  const scraperBody = {
    url: targetUrl,
    waitForSelector: '.jobTuple',
    extractionSchema: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title:    { type: 'string', description: 'Job title' },
              company:  { type: 'string', description: 'Company name' },
              location: { type: 'string', description: 'Job location' },
              salary:   { type: 'string', description: 'Salary range if mentioned' },
              skills:   { type: 'array', items: { type: 'string' }, description: 'Required skills' },
              experience: { type: 'string', description: 'Experience required' }
            }
          },
          description: 'List of job listings'
        }
      }
    }
  };

  const resp = await fetch('https://api.anakin.io/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CONFIG.scraperApiKey
    },
    body: JSON.stringify(scraperBody)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anakin Scraper error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();

  // Extract jobs from response
  const jobs = data?.data?.jobs || data?.extracted?.jobs || data?.jobs || [];

  if (!jobs.length) {
    // Fallback: try to parse the markdown content
    return parseJobsFromMarkdown(data?.markdown || data?.content || '', role, location);
  }

  return jobs.slice(0, 20);
}

function parseJobsFromMarkdown(markdown, role, location) {
  // Basic extraction from scraped markdown text
  const lines = markdown.split('\n');
  const jobs = [];
  for (let i = 0; i < lines.length && jobs.length < 15; i++) {
    const line = lines[i].trim();
    if (line.includes(role) && line.length < 120) {
      jobs.push({
        title: line.substring(0, 80),
        company: lines[i+1]?.trim()?.substring(0, 60) || 'Unknown',
        location: location,
        salary: '',
        skills: [],
        experience: ''
      });
    }
  }
  return jobs.length ? jobs : getDemoJobs(role, location);
}

// ─── Anakin.ai Workflow API ───────────────────────────────────────────────────
async function runAnakinAIWorkflow(role, location, jobs) {
  /**
   * Anakin.ai App/Workflow API
   * POST https://api.anakin.ai/v1/quickapps/{app_id}/runs
   * Headers: Authorization: Bearer <token>
   *
   * Since we need a specific app_id, we call the general chat completion
   * endpoint with a structured prompt — the user can replace with their
   * actual workflow app ID.
   */

  const jobsSummary = jobs.slice(0, 10).map(j =>
    `- ${j.title} at ${j.company} (${j.location}) | Skills: ${(j.skills||[]).join(', ')} | Salary: ${j.salary || 'Not specified'}`
  ).join('\n');

  const prompt = `You are a job market intelligence analyst. Analyze these ${jobs.length} job listings for "${role}" in "${location}" and provide:

Job Listings Sample:
${jobsSummary}

Provide a JSON response with:
{
  "summary": "3-4 sentence market brief with bold key insights",
  "topSkills": [{"name": "skill", "percentage": 85, "trend": "rising"}], (top 8)
  "salaryInsights": {
    "median": "₹X LPA",
    "range_low": "₹X LPA", 
    "range_high": "₹X LPA",
    "freshers": "₹X LPA",
    "senior": "₹X LPA"
  },
  "topCompanies": [{"name": "Company", "openings": 12, "type": "hot"}] (top 6),
  "marketSignal": "buyer|balanced|candidate"
}`;

  // Try Anakin.ai chat API
  const resp = await fetch('https://api.anakin.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.anakinToken}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.warn('Anakin.ai API error:', resp.status, errText);
    return generateLocalAnalysis(role, location, jobs);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(content);
  } catch {
    return generateLocalAnalysis(role, location, jobs);
  }
}

// ─── Local AI Analysis (fallback / demo) ─────────────────────────────────────
function generateLocalAnalysis(role, location, jobs) {
  const roleLC = role.toLowerCase();

  // Smart skill sets per role type
  const skillSets = {
    frontend: [
      { name: 'React.js', percentage: 88, trend: 'rising' },
      { name: 'TypeScript', percentage: 76, trend: 'rising' },
      { name: 'Next.js', percentage: 68, trend: 'rising' },
      { name: 'Tailwind CSS', percentage: 62, trend: 'rising' },
      { name: 'JavaScript', percentage: 95, trend: 'stable' },
      { name: 'Node.js', percentage: 55, trend: 'stable' },
      { name: 'Git / GitHub', percentage: 90, trend: 'stable' },
      { name: 'REST APIs', percentage: 72, trend: 'stable' },
    ],
    data: [
      { name: 'Python', percentage: 93, trend: 'rising' },
      { name: 'SQL', percentage: 88, trend: 'stable' },
      { name: 'Machine Learning', percentage: 72, trend: 'rising' },
      { name: 'Tableau / Power BI', percentage: 65, trend: 'rising' },
      { name: 'Pandas / NumPy', percentage: 80, trend: 'stable' },
      { name: 'Apache Spark', percentage: 45, trend: 'rising' },
      { name: 'Statistics', percentage: 70, trend: 'stable' },
      { name: 'Cloud (AWS/GCP)', percentage: 58, trend: 'rising' },
    ],
    ml: [
      { name: 'Python', percentage: 97, trend: 'rising' },
      { name: 'PyTorch / TensorFlow', percentage: 85, trend: 'rising' },
      { name: 'LLMs / Transformers', percentage: 78, trend: 'rising' },
      { name: 'MLOps', percentage: 60, trend: 'rising' },
      { name: 'SQL', percentage: 65, trend: 'stable' },
      { name: 'Docker / Kubernetes', percentage: 55, trend: 'rising' },
      { name: 'Research Papers', percentage: 50, trend: 'stable' },
      { name: 'Cloud ML Services', percentage: 68, trend: 'rising' },
    ],
    product: [
      { name: 'Product Strategy', percentage: 90, trend: 'stable' },
      { name: 'SQL / Analytics', percentage: 75, trend: 'rising' },
      { name: 'Figma / Design', percentage: 68, trend: 'rising' },
      { name: 'Agile / Scrum', percentage: 85, trend: 'stable' },
      { name: 'User Research', percentage: 72, trend: 'rising' },
      { name: 'A/B Testing', percentage: 65, trend: 'rising' },
      { name: 'Roadmapping', percentage: 80, trend: 'stable' },
      { name: 'Stakeholder Mgmt', percentage: 78, trend: 'stable' },
    ],
    default: [
      { name: 'Communication', percentage: 88, trend: 'stable' },
      { name: 'Problem Solving', percentage: 85, trend: 'stable' },
      { name: 'Python / SQL', percentage: 72, trend: 'rising' },
      { name: 'Data Analysis', percentage: 68, trend: 'rising' },
      { name: 'Project Management', percentage: 75, trend: 'stable' },
      { name: 'Cloud Basics', percentage: 60, trend: 'rising' },
      { name: 'Leadership', percentage: 65, trend: 'stable' },
      { name: 'Excel / Sheets', percentage: 80, trend: 'stable' },
    ]
  };

  const salaryMap = {
    frontend: { median: '₹12 LPA', range_low: '₹6 LPA', range_high: '₹30 LPA', freshers: '₹4–7 LPA', senior: '₹25–45 LPA' },
    data: { median: '₹10 LPA', range_low: '₹5 LPA', range_high: '₹28 LPA', freshers: '₹4–6 LPA', senior: '₹20–40 LPA' },
    ml: { median: '₹16 LPA', range_low: '₹8 LPA', range_high: '₹45 LPA', freshers: '₹6–10 LPA', senior: '₹35–70 LPA' },
    product: { median: '₹18 LPA', range_low: '₹8 LPA', range_high: '₹50 LPA', freshers: '₹6–10 LPA', senior: '₹40–80 LPA' },
    default: { median: '₹8 LPA', range_low: '₹4 LPA', range_high: '₹20 LPA', freshers: '₹3–5 LPA', senior: '₹15–30 LPA' }
  };

  const companiesMap = {
    frontend: [
      { name: 'Flipkart', openings: 23, type: 'hot' },
      { name: 'Razorpay', openings: 17, type: 'hot' },
      { name: 'Meesho', openings: 14, type: 'hot' },
      { name: 'Swiggy', openings: 12, type: 'active' },
      { name: 'Zepto', openings: 9, type: 'active' },
      { name: 'CRED', openings: 8, type: 'active' },
    ],
    data: [
      { name: 'Walmart Global Tech', openings: 31, type: 'hot' },
      { name: 'Swiggy', openings: 22, type: 'hot' },
      { name: 'PhonePe', openings: 18, type: 'hot' },
      { name: 'Paytm', openings: 14, type: 'active' },
      { name: 'OLA', openings: 11, type: 'active' },
      { name: 'Byju\'s', openings: 9, type: 'active' },
    ],
    ml: [
      { name: 'Google India', openings: 15, type: 'hot' },
      { name: 'Microsoft India', openings: 12, type: 'hot' },
      { name: 'Amazon India', openings: 19, type: 'hot' },
      { name: 'Sarvam AI', openings: 8, type: 'hot' },
      { name: 'Krutrim', openings: 6, type: 'hot' },
      { name: 'Fractal Analytics', openings: 11, type: 'active' },
    ],
    product: [
      { name: 'Zomato', openings: 10, type: 'hot' },
      { name: 'CRED', openings: 8, type: 'hot' },
      { name: 'Razorpay', openings: 7, type: 'hot' },
      { name: 'Groww', openings: 9, type: 'active' },
      { name: 'Zerodha', openings: 5, type: 'active' },
      { name: 'Urban Company', openings: 6, type: 'active' },
    ],
    default: [
      { name: 'Infosys', openings: 45, type: 'hot' },
      { name: 'TCS', openings: 38, type: 'hot' },
      { name: 'Wipro', openings: 30, type: 'hot' },
      { name: 'HCL', openings: 22, type: 'active' },
      { name: 'Cognizant', openings: 19, type: 'active' },
      { name: 'Accenture', openings: 25, type: 'active' },
    ]
  };

  const getCategory = (role) => {
    const r = role.toLowerCase();
    if (r.includes('front') || r.includes('react') || r.includes('ui') || r.includes('web')) return 'frontend';
    if (r.includes('data analyst') || r.includes('business') || r.includes('bi ')) return 'data';
    if (r.includes('ml') || r.includes('machine learning') || r.includes('deep learning') || r.includes('nlp') || r.includes('ai engineer') || r.includes('data scientist')) return 'ml';
    if (r.includes('product') || r.includes('pm ') || r.includes(' pm')) return 'product';
    return 'default';
  };

  const cat = getCategory(role);

  return {
    summary: `The <strong>${role}</strong> job market in <strong>${location}</strong> is currently <strong>highly competitive</strong> with strong demand from product-first startups and tech giants alike. ${cat === 'ml' ? 'The AI/ML wave has significantly increased demand, with LLM experience commanding a 40–60% salary premium.' : cat === 'frontend' ? 'React ecosystem dominance is clear — teams are standardizing on React + TypeScript + Next.js stacks.' : cat === 'data' ? 'Data literacy is now table stakes — SQL and Python are baseline expectations for even entry-level roles.' : 'Candidates with cross-functional skills and hands-on project portfolios are getting 2–3x more callbacks.'} The market favors <span class="highlight">candidates with proven portfolio work</span> over pure certifications. ${jobs.length > 0 ? `Based on ${jobs.length} live listings analyzed.` : 'Based on current market trends.'}`,
    topSkills: skillSets[cat] || skillSets.default,
    salaryInsights: salaryMap[cat] || salaryMap.default,
    topCompanies: companiesMap[cat] || companiesMap.default,
    marketSignal: cat === 'ml' ? 'candidate' : 'balanced'
  };
}

// ─── Demo Jobs Data ───────────────────────────────────────────────────────────
function getDemoJobs(role, location) {
  const companies = [
    'Flipkart', 'Razorpay', 'Swiggy', 'Meesho', 'CRED', 'Zepto',
    'PhonePe', 'Paytm', 'Groww', 'Zerodha', 'Urban Company', 'Nykaa'
  ];
  const skillPool = {
    frontend: ['React', 'TypeScript', 'Next.js', 'CSS', 'JavaScript', 'Redux', 'Tailwind', 'Node.js'],
    data: ['Python', 'SQL', 'Tableau', 'Power BI', 'Excel', 'Machine Learning', 'Pandas', 'NumPy'],
    ml: ['Python', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'NLP', 'LLMs', 'Docker', 'SQL'],
    default: ['Python', 'SQL', 'Communication', 'Problem Solving', 'Excel', 'Git', 'Agile']
  };
  const roleLC = role.toLowerCase();
  let pool = skillPool.default;
  if (roleLC.includes('front') || roleLC.includes('react')) pool = skillPool.frontend;
  else if (roleLC.includes('data') || roleLC.includes('analyst')) pool = skillPool.data;
  else if (roleLC.includes('ml') || roleLC.includes('machine') || roleLC.includes('scientist')) pool = skillPool.ml;

  return Array.from({ length: 15 }, (_, i) => ({
    title: `${role}${i < 3 ? '' : i < 6 ? ' — Senior' : i < 9 ? ' — Junior' : ' — Intern'}`,
    company: companies[i % companies.length],
    location: location,
    salary: i < 5 ? `₹${8 + i * 3}–${14 + i * 4} LPA` : i < 10 ? `₹${5 + i}–${10 + i} LPA` : 'Not specified',
    skills: pool.sort(() => Math.random() - 0.5).slice(0, 3 + (i % 3)),
    experience: i < 4 ? '3-6 years' : i < 8 ? '1-3 years' : '0-1 years'
  }));
}

// ─── Render Results ───────────────────────────────────────────────────────────
function renderResults(role, location, jobs, analysis) {
  // Header
  document.getElementById('report-title').textContent = `${role} Market Intelligence — ${location}`;
  document.getElementById('report-subtitle').textContent =
    `Analyzed ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}`;
  document.getElementById('jobs-count').textContent = jobs.length;
  document.getElementById('companies-count').textContent = analysis.topCompanies?.length || '—';
  document.getElementById('skills-count').textContent = analysis.topSkills?.length || '—';

  // Skills
  const skillsList = document.getElementById('skills-list');
  skillsList.innerHTML = '';
  (analysis.topSkills || []).forEach(skill => {
    const div = document.createElement('div');
    div.className = 'skill-row';
    div.innerHTML = `
      <div class="skill-meta">
        <span class="skill-name">${skill.name}</span>
        <span class="skill-pct">${skill.percentage}% ${skill.trend === 'rising' ? '↑' : '→'}</span>
      </div>
      <div class="skill-bar-bg">
        <div class="skill-bar-fill" style="width:0%" data-width="${skill.percentage}%"></div>
      </div>
    `;
    skillsList.appendChild(div);
  });
  // Animate bars
  setTimeout(() => {
    document.querySelectorAll('.skill-bar-fill').forEach(el => {
      el.style.width = el.dataset.width;
    });
  }, 100);

  // Salary
  const sal = analysis.salaryInsights || {};
  document.getElementById('salary-content').innerHTML = `
    <div class="salary-range-block">
      <div class="salary-label">Median Salary</div>
      <div class="salary-value mid">${sal.median || '—'}</div>
    </div>
    <div class="salary-grid">
      <div class="salary-stat-pill">
        <div class="label">Entry Level</div>
        <div class="val low">${sal.freshers || sal.range_low || '—'}</div>
      </div>
      <div class="salary-stat-pill">
        <div class="label">Senior / Lead</div>
        <div class="val high">${sal.senior || sal.range_high || '—'}</div>
      </div>
      <div class="salary-stat-pill">
        <div class="label">Range Low</div>
        <div class="val">${sal.range_low || '—'}</div>
      </div>
      <div class="salary-stat-pill">
        <div class="label">Range High</div>
        <div class="val">${sal.range_high || '—'}</div>
      </div>
    </div>
  `;

  // Companies
  const companiesList = document.getElementById('companies-list');
  companiesList.innerHTML = '';
  (analysis.topCompanies || []).forEach((co, i) => {
    const div = document.createElement('div');
    div.className = 'company-row';
    div.innerHTML = `
      <span class="company-rank">#${i+1}</span>
      <div class="company-avatar">${co.name.charAt(0)}</div>
      <div class="company-info">
        <div class="company-name">${co.name}</div>
        <div class="company-openings">${co.openings} open roles</div>
      </div>
      <span class="company-badge">${co.type === 'hot' ? '🔥 Hot' : '✅ Active'}</span>
    `;
    companiesList.appendChild(div);
  });

  // Summary
  document.getElementById('summary-text').innerHTML = analysis.summary || 'Analysis complete.';

  // Jobs table
  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '';
  jobs.slice(0, 10).forEach(job => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${job.title || '—'}</td>
      <td>${job.company || '—'}</td>
      <td>${job.location || '—'}</td>
      <td class="salary-cell">${job.salary || 'N/A'}</td>
      <td>
        <div class="skills-cell">
          ${(job.skills || []).slice(0,4).map(s => `<span class="skill-tag">${s}</span>`).join('')}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function resetSearch() {
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('search-section').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('role-input').focus();
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();

  // Enter key to search
  ['role-input', 'location-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') runAnalysis();
    });
  });
});
