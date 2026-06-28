/**
 * JobPulse — Vercel Serverless API Proxy
 *
 * Uses Anakin.io APIs:
 *  1. Wire  → GET  /v1/wire/catalogs + POST /v1/wire/actions/{id}/execute
 *             (pre-built actions for job sites — if available)
 *  2. Scraper → POST /v1/scrape  (universal fallback with generateJson + useBrowser)
 *  3. Search  → POST /v1/search  (web search for AI-powered job market context)
 *
 * Authentication: X-API-Key header (anakin.io key)
 */

const ANAKIN_BASE = 'https://api.anakin.io/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { role, location, scraperKey } = req.body;
  if (!role) return res.status(400).json({ error: 'role is required' });
  if (!scraperKey) return res.status(400).json({ error: 'scraperKey is required' });

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': scraperKey
  };

  try {
    const loc = location || 'India';

    // ── Step 1: Try Wire catalog for job-related actions ─────────────────────
    let wireJobs = [];
    try {
      wireJobs = await tryWireActions(role, loc, headers);
    } catch (e) {
      console.log('Wire actions not available for job sites:', e.message);
    }

    // ── Step 2: URL Scraper (Anakin Universal Scraper) ───────────────────────
    let scrapedJobs = [];
    if (wireJobs.length === 0) {
      try {
        scrapedJobs = await scrapeJobsWithUniversalScraper(role, loc, headers);
      } catch (e) {
        console.error('Scraper error:', e.message);
      }
    }

    const jobs = wireJobs.length ? wireJobs : scrapedJobs;

    // ── Step 3: Anakin Search API for market context ─────────────────────────
    let searchContext = '';
    try {
      searchContext = await getMarketContextViaSearch(role, loc, headers);
    } catch (e) {
      console.log('Search API error:', e.message);
    }

    return res.status(200).json({
      jobs,
      searchContext,
      meta: {
        role,
        location: loc,
        jobsCount: jobs.length,
        wireUsed: wireJobs.length > 0,
        source: wireJobs.length > 0 ? 'anakin-wire' : scrapedJobs.length > 0 ? 'anakin-scraper' : 'none',
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Wire: Pre-built Actions for Job Sites ────────────────────────────────────
async function tryWireActions(role, location, headers) {
  // List available Wire catalogs
  const catalogsResp = await fetch(`${ANAKIN_BASE}/wire/catalogs`, { headers });
  if (!catalogsResp.ok) throw new Error(`Wire catalogs HTTP ${catalogsResp.status}`);

  const catalogs = await catalogsResp.json();

  // Look for job-related catalogs (LinkedIn, Indeed, Naukri, Glassdoor)
  const jobKeywords = ['linkedin', 'indeed', 'naukri', 'glassdoor', 'job'];
  const jobCatalogs = (catalogs?.data || catalogs || []).filter(c =>
    jobKeywords.some(k => (c.name || c.id || '').toLowerCase().includes(k))
  );

  if (!jobCatalogs.length) throw new Error('No job site catalogs in Wire');

  // Get actions for the first matching catalog
  const actionsResp = await fetch(`${ANAKIN_BASE}/wire/actions?catalogId=${jobCatalogs[0].id}`, { headers });
  if (!actionsResp.ok) throw new Error(`Wire actions HTTP ${actionsResp.status}`);

  const actions = await actionsResp.json();
  const searchAction = (actions?.data || actions || []).find(a =>
    ['search', 'jobs', 'query', 'list'].some(k => (a.name || a.id || '').toLowerCase().includes(k))
  );

  if (!searchAction) throw new Error('No search action in Wire catalog');

  // Execute Wire action
  const execResp = await fetch(`${ANAKIN_BASE}/wire/actions/${searchAction.id}/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: {
        query: role,
        location: location,
        keywords: role,
        limit: 20
      }
    })
  });

  if (!execResp.ok) throw new Error(`Wire execute HTTP ${execResp.status}`);
  const execData = await execResp.json();

  // Poll for async job if needed
  if (execData.jobId || execData.id) {
    return await pollWireJob(execData.jobId || execData.id, headers);
  }

  return normalizeJobs(execData?.data || execData?.results || execData || []);
}

async function pollWireJob(jobId, headers, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const resp = await fetch(`${ANAKIN_BASE}/wire/jobs/${jobId}`, { headers });
    if (!resp.ok) continue;
    const data = await resp.json();
    if (data.status === 'completed' || data.status === 'done') {
      return normalizeJobs(data?.result?.data || data?.result || data?.data || []);
    }
    if (data.status === 'failed') throw new Error('Wire job failed');
  }
  throw new Error('Wire job timeout');
}

// ─── URL Scraper: Universal fallback ─────────────────────────────────────────
async function scrapeJobsWithUniversalScraper(role, location, headers) {
  const q   = encodeURIComponent(role);
  const loc = location.toLowerCase().replace(/\s+/g, '-');

  // Try Naukri (best for India) first, then Indeed
  const targets = [
    {
      url: `https://www.naukri.com/${loc}-jobs?k=${q}&l=${loc}`,
      name: 'Naukri'
    },
    {
      url: `https://www.indeed.co.in/jobs?q=${q}&l=${encodeURIComponent(location)}`,
      name: 'Indeed'
    }
  ];

  for (const target of targets) {
    try {
      // Submit async scrape job
      const submitResp = await fetch(`${ANAKIN_BASE}/scrape`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: target.url,
          useBrowser: true,           // JS-rendered sites need this
          generateJson: true,         // AI extraction
          waitFor: 3000,
          jsonSchema: {
            type: 'object',
            properties: {
              jobs: {
                type: 'array',
                description: `Job listings for ${role} in ${location}`,
                items: {
                  type: 'object',
                  properties: {
                    title:      { type: 'string', description: 'Job title' },
                    company:    { type: 'string', description: 'Company name' },
                    location:   { type: 'string', description: 'Job location city' },
                    salary:     { type: 'string', description: 'Salary or CTC range if mentioned' },
                    experience: { type: 'string', description: 'Years of experience required' },
                    skills:     {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'List of required technical skills'
                    },
                    postedDate: { type: 'string', description: 'When was job posted' },
                    jobType:    { type: 'string', description: 'Full-time/Part-time/Remote/Hybrid' }
                  }
                }
              }
            }
          }
        })
      });

      if (!submitResp.ok) continue;
      const submitData = await submitResp.json();

      // Handle both sync and async responses
      if (submitData.json?.jobs || submitData.data?.jobs) {
        const jobs = submitData.json?.jobs || submitData.data?.jobs || [];
        if (jobs.length > 0) return jobs.slice(0, 20);
      }

      // Poll async job
      const jobId = submitData.jobId || submitData.id;
      if (jobId) {
        const jobs = await pollScrapeJob(jobId, headers);
        if (jobs.length > 0) return jobs;
      }

    } catch (e) {
      console.log(`${target.name} scrape failed:`, e.message);
      continue;
    }
  }

  return [];
}

async function pollScrapeJob(jobId, headers, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const resp = await fetch(`${ANAKIN_BASE}/scrape/${jobId}`, { headers });
      if (!resp.ok) continue;
      const data = await resp.json();

      if (data.status === 'completed' || data.status === 'done' || data.json) {
        const jobs = data.json?.jobs || data.data?.jobs || data.result?.jobs || [];
        return normalizeJobs(jobs);
      }
      if (data.status === 'failed') return [];
    } catch (e) {
      continue;
    }
  }
  return [];
}

// ─── Anakin Search API: Market Context ────────────────────────────────────────
async function getMarketContextViaSearch(role, location, headers) {
  /**
   * POST /v1/search
   * Uses Anakin's AI-powered web search to get current market context
   * This feeds into local analysis when no Anakin.ai token is available
   */
  const query = `${role} jobs ${location} salary skills 2026 trending`;

  const resp = await fetch(`${ANAKIN_BASE}/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      limit: 5
    })
  });

  if (!resp.ok) throw new Error(`Search API HTTP ${resp.status}`);
  const data = await resp.json();

  // Extract text snippets from search results
  const results = data?.results || data?.data || [];
  return results
    .slice(0, 5)
    .map(r => r.snippet || r.description || r.content || '')
    .filter(Boolean)
    .join('\n\n');
}

// ─── Normalise jobs from any source ──────────────────────────────────────────
function normalizeJobs(rawJobs) {
  if (!Array.isArray(rawJobs)) return [];
  return rawJobs.slice(0, 20).map(j => ({
    title:      j.title || j.jobTitle || j.name || '',
    company:    j.company || j.companyName || j.employer || '',
    location:   j.location || j.city || '',
    salary:     j.salary || j.ctc || j.compensation || '',
    experience: j.experience || j.exp || '',
    skills:     Array.isArray(j.skills) ? j.skills : (j.skills ? [j.skills] : []),
    postedDate: j.postedDate || j.date || '',
    jobType:    j.jobType || j.type || ''
  })).filter(j => j.title);
}
