const fetch = require('node-fetch');
const cheerio = require('cheerio');
const pool = require('../db/pool');

const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';

// SPARQL query to get recent CJEU judgments from CELLAR
// Retrieves: ECLI, date, title, case number, document type, subject matter, court
function buildRecentJudgmentsQuery(daysBack = 30, limit = 50) {
  const dateFilter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  return `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT
  ?work
  ?ecli
  ?date
  ?celex
  ?title
  ?courtLabel
  ?docTypeLabel
  ?subjectLabel
  ?procedureTypeLabel
  ?judgeRapporteur
  ?advocateGeneral
  ?formation
  ?origLanguage
WHERE {
  ?work cdm:case-law_ecli ?ecli ;
        cdm:work_date_document ?date .

  # Only CJEU: Court of Justice (C:) and General Court (T:)
  FILTER(STRSTARTS(?ecli, 'ECLI:EU:C:') || STRSTARTS(?ecli, 'ECLI:EU:T:'))
  FILTER(?date >= '${dateFilter}'^^xsd:date)

  OPTIONAL { ?work cdm:resource_legal_id_celex ?celex . }

  OPTIONAL {
    ?work cdm:work_has_expression ?expr .
    ?expr cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> .
    ?expr cdm:expression_title ?title .
  }

  OPTIONAL {
    ?work cdm:case-law_delivered_by_court ?court .
    ?court skos:prefLabel ?courtLabel .
    FILTER(LANG(?courtLabel) = 'en')
  }

  OPTIONAL {
    ?work cdm:case-law_has_type_procedure_document_type ?docType .
    ?docType skos:prefLabel ?docTypeLabel .
    FILTER(LANG(?docTypeLabel) = 'en')
  }

  OPTIONAL {
    ?work cdm:case-law_is_about_concept_directory-code ?subject .
    ?subject skos:prefLabel ?subjectLabel .
    FILTER(LANG(?subjectLabel) = 'en')
  }

  OPTIONAL {
    ?work cdm:case-law_has_type_procedure_concept_type_procedure ?procedureType .
    ?procedureType skos:prefLabel ?procedureTypeLabel .
    FILTER(LANG(?procedureTypeLabel) = 'en')
  }

  OPTIONAL {
    ?work cdm:case-law_delivered_by_judge ?jrx .
    ?jrx cdm:agent_name ?judgeRapporteur .
  }

  OPTIONAL {
    ?work cdm:case-law_delivered_by_advocate-general ?agx .
    ?agx cdm:agent_name ?advocateGeneral .
  }

  OPTIONAL {
    ?work cdm:case-law_delivered_by_court-formation ?cfx .
    ?cfx cdm:agent_name ?formation .
  }

  OPTIONAL {
    ?work cdm:resource_legal_uses_originally_language ?origLang .
    ?origLang skos:prefLabel ?origLanguage .
    FILTER(LANG(?origLanguage) = 'en')
  }
}
ORDER BY DESC(?date)
LIMIT ${limit}`;
}

async function querySPARQL(query) {
  const params = new URLSearchParams();
  params.set('query', query);

  const response = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Accept': 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SPARQL query failed (${response.status}): ${text.substring(0, 200)}`);
  }

  return response.json();
}

// Fetch full text of a judgment from EUR-Lex using CELEX number
async function fetchFullTextFromEurLex(celex) {
  if (!celex) return null;

  const url = `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LegalNewsAggregator/1.0 (educational/research)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // EUR-Lex wraps the judgment text in #document1 or .EurlexContent
    const textContent = $('#document1').text() || $('.EurlexContent').text() || $('body').text();

    // Clean up whitespace
    return textContent.replace(/\s+/g, ' ').trim().substring(0, 50000);
  } catch (err) {
    console.error(`Failed to fetch EUR-Lex text for ${celex}:`, err.message);
    return null;
  }
}

// Parse ECLI to extract court and case number
// e.g. ECLI:EU:C:2026:123 => { court: 'Court of Justice', year: '2026', seq: '123' }
// e.g. ECLI:EU:T:2026:45 => { court: 'General Court', year: '2026', seq: '45' }
function parseECLI(ecli) {
  if (!ecli) return {};

  const parts = ecli.split(':');
  if (parts.length < 5) return {};

  const courtCode = parts[2]; // 'C' or 'T'
  return {
    court: courtCode === 'C' ? 'Court of Justice' : courtCode === 'T' ? 'General Court' : courtCode,
    year: parts[3],
    sequence: parts[4],
  };
}

// Normalize SPARQL result row into a judgment object
function normalizeJudgment(row) {
  const ecli = row.ecli?.value || '';
  const parsed = parseECLI(ecli);

  return {
    ecli,
    celex: row.celex?.value || null,
    title: row.title?.value || null,
    date: row.date?.value || null,
    court: row.courtLabel?.value || parsed.court || null,
    documentType: row.docTypeLabel?.value || null,
    subjectMatter: row.subjectLabel?.value || null,
    procedureType: row.procedureTypeLabel?.value || null,
    judgeRapporteur: row.judgeRapporteur?.value || null,
    advocateGeneral: row.advocateGeneral?.value || null,
    formation: row.formation?.value || null,
    caseLanguage: row.origLanguage?.value || null,
    cellarUri: row.work?.value || null,
  };
}

// Deduplicate SPARQL results (same ECLI may appear multiple times due to multiple subjects)
function deduplicateResults(results) {
  const map = new Map();

  for (const row of results) {
    const judgment = normalizeJudgment(row);
    if (!judgment.ecli) continue;

    if (map.has(judgment.ecli)) {
      // Merge subject matters
      const existing = map.get(judgment.ecli);
      if (judgment.subjectMatter && !existing.subjectMatter?.includes(judgment.subjectMatter)) {
        existing.subjectMatter = existing.subjectMatter
          ? `${existing.subjectMatter}; ${judgment.subjectMatter}`
          : judgment.subjectMatter;
      }
    } else {
      map.set(judgment.ecli, judgment);
    }
  }

  return Array.from(map.values());
}

// Main scrape function: query SPARQL, fetch full texts, store in DB
async function scrapeRecentJudgments(daysBack = 30) {
  console.log(`[CJEU Scraper] Querying SPARQL for judgments from the last ${daysBack} days...`);

  let sparqlResult;
  try {
    const query = buildRecentJudgmentsQuery(daysBack, 100);
    sparqlResult = await querySPARQL(query);
  } catch (err) {
    console.error('[CJEU Scraper] SPARQL query failed:', err.message);
    return { fetched: 0, new: 0 };
  }

  const bindings = sparqlResult?.results?.bindings || [];
  console.log(`[CJEU Scraper] SPARQL returned ${bindings.length} result rows.`);

  const judgments = deduplicateResults(bindings);
  console.log(`[CJEU Scraper] ${judgments.length} unique judgments after deduplication.`);

  let newCount = 0;

  for (const judgment of judgments) {
    // Skip if we already have this ECLI
    const existing = await pool.query(
      'SELECT id FROM judgment_metadata WHERE ecli = $1',
      [judgment.ecli]
    );
    if (existing.rows.length > 0) continue;

    // Build the EUR-Lex link
    const link = judgment.celex
      ? `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${judgment.celex}`
      : `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=ecli:${judgment.ecli}`;

    // Check if article with this link already exists
    const existingArticle = await pool.query(
      'SELECT id FROM articles WHERE link = $1',
      [link]
    );
    if (existingArticle.rows.length > 0) continue;

    // Fetch full text (with small delay to be polite)
    let fullText = null;
    if (judgment.celex) {
      fullText = await fetchFullTextFromEurLex(judgment.celex);
      await new Promise((r) => setTimeout(r, 500)); // polite delay
    }

    const articleTitle = judgment.title
      || `${judgment.court || 'CJEU'} — ${judgment.documentType || 'Decision'} — ${judgment.ecli}`;

    const description = [
      judgment.court,
      judgment.documentType,
      judgment.procedureType,
      judgment.subjectMatter,
    ]
      .filter(Boolean)
      .join(' | ');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert into articles table
      const articleResult = await client.query(
        `INSERT INTO articles (title, link, description, content, source_name, source_url, published_at, feed_type, jurisdiction, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'judgment', 'EU', 'en')
         ON CONFLICT (link) DO NOTHING
         RETURNING id`,
        [
          articleTitle,
          link,
          description,
          fullText || description,
          judgment.court || 'CJEU',
          'https://curia.europa.eu',
          judgment.date,
        ]
      );

      if (articleResult.rows.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      const articleId = articleResult.rows[0].id;

      // Insert judgment metadata
      await client.query(
        `INSERT INTO judgment_metadata
          (article_id, case_number, ecli, court, chamber, judge_rapporteur, advocate_general, procedure_type, subject_matter, document_type, decision_date, celex_number, case_language, full_text, parties)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (ecli) DO NOTHING`,
        [
          articleId,
          judgment.celex,
          judgment.ecli,
          judgment.court,
          judgment.formation,
          judgment.judgeRapporteur,
          judgment.advocateGeneral,
          judgment.procedureType,
          judgment.subjectMatter,
          judgment.documentType,
          judgment.date,
          judgment.celex,
          judgment.caseLanguage,
          fullText,
          judgment.title, // title often contains party names
        ]
      );

      await client.query('COMMIT');
      newCount++;
      console.log(`[CJEU Scraper] New: ${judgment.ecli} — ${articleTitle.substring(0, 60)}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[CJEU Scraper] Failed to store ${judgment.ecli}:`, err.message);
    } finally {
      client.release();
    }
  }

  console.log(`[CJEU Scraper] Complete. ${newCount} new judgments stored.`);
  return { fetched: judgments.length, new: newCount };
}

module.exports = { scrapeRecentJudgments, querySPARQL, buildRecentJudgmentsQuery };
