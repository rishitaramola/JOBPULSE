/**
 * JobPulse — Vercel Serverless API Proxy
 * Handles CORS-safe calls to Anakin.io scraper & Anakin.ai
 *
 * Endpoint: POST /api/analyze
 * Body: { role, location, scraperKey, anakinToken }
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { role, location, scraperKey, anakinToken } = req.body;

  if (!role) return res.status(400).json({ error: 'role is required' });

  try {
    let jobs = [];
    let analysis = null;

    // ── Step 1: Scrape via Anakin Universal Scraper ──────────────────────────
    if (scraperKey) {
      try {
        jobs = await scrapeJobs(role, location || 'India', scraperKey);
      } catch (err) {
        console.error('Scraper error:', err.message);
        jobs = []; // fall through to demo data
      }
    }

    // ── Step 2: AI Analysis via Anakin.ai ────────────────────────────────────
    if (anakinToken) {
      try {
        analysis = await runAnakinAI(role, location || 'India', jobs, anakinToken);
      } catch (err) {
        console.error('Anakin AI error:', err.message);
        analysis = null;
      }
    }

    return res.status(200).json({
      jobs,
      analysis,
      meta: {
        role,
        location: location || 'India',
        jobsCount: jobs.length,
        source: scraperKey ? 'anakin-scraper' : 'demo',
        aiSource: anakinToken ? 'anakin-ai' : 'local',
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Anakin Universal Scraper ─────────────────────────────────────────────────
async function scrapeJobs(role, location, apiKey) {
  const loc = location.toLowerCase().replace(/\s+/g, '-');
  const q = encodeURIComponent(role);

  // Try Naukri first
  const urls = [
    `https://www.naukri.com/${loc}-jobs?k=${q}&l=${loc}`,
    `https://www.indeed.co.in/jobs?q=${q}&l=${encodeURIComponent(location)}`,
  ];

  for (const url of urls) {
    try {
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
                description: 'Job listings on the page',
                items: {
                  type: 'object',
                  properties: {
                    title:      { type: 'string', description: 'Job title' },
                    company:    { type: 'string', description: 'Company name' },
                    location:   { type: 'string', description: 'Job location' },
                    salary:     { type: 'string', description: 'Salary or CTC range' },
                    experience: { type: 'string', description: 'Experience required' },
                    skills:     { type: 'array', items: { type: 'string' }, description: 'Required skills list' },
                    postedDate: { type: 'string', description: 'When posted' }
                  }
                }
              }
            }
          }
        })
      });

      if (!resp.ok) continue;

      const data = await resp.json();
      const jobs = data?.data?.jobs || data?.extracted?.jobs || data?.jobs || [];
      if (jobs.length > 0) return jobs.slice(0, 20);

    } catch (e) {
      continue;
    }
  }

  return [];
}

// ─── Anakin.ai Analysis ───────────────────────────────────────────────────────
async function runAnakinAI(role, location, jobs, token) {
  const jobsSample = jobs.slice(0, 12).map(j =>
    `• ${j.title} at ${j.company} (${j.location}) | Skills: ${(j.skills || []).join(', ')} | Salary: ${j.salary || 'N/A'} | Exp: ${j.experience || 'N/A'}`
  ).join('\n');

  const prompt = `You are a job market intelligence analyst. Analyze these job listings for "${role}" in "${location}" and return ONLY a JSON object.

Sample listings (${jobs.length} total analyzed):
${jobsSample || 'No live data — use your knowledge of the current market'}

Return this exact JSON:
{
  "summary": "3-4 sentences market overview with <strong>bold key facts</strong> and <span class='highlight'>highlighted insights</span>",
  "topSkills": [
    {"name": "Python", "percentage": 92, "trend": "rising"},
    ... 8 skills total, sorted by percentage desc
  ],
  "salaryInsights": {
    "median": "₹12 LPA",
    "range_low": "₹6 LPA",
    "range_high": "₹28 LPA",
    "freshers": "₹4–7 LPA",
    "senior": "₹22–40 LPA"
  },
  "topCompanies": [
    {"name": "Flipkart", "openings": 18, "type": "hot"},
    ... 6 companies total
  ],
  "marketSignal": "candidate",
  "hotTip": "One actionable tip for job seekers right now"
}`;

  // Try Anakin.ai chat completions endpoint
  const endpoints = [
    { url: 'https://api.anakin.ai/v1/chat/completions', authHeader: `Bearer ${token}` },
    { url: 'https://api.anakin.ai/v1/completions', authHeader: `Bearer ${token}` },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': ep.authHeader
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 1200
        })
      });

      if (!resp.ok) continue;
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) return JSON.parse(content);

    } catch (e) {
      continue;
    }
  }

  return null;
}
