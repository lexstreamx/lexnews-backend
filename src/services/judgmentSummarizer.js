const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');

const anthropic = new Anthropic();

const LEGAL_CATEGORIES = [
  'AI, Platforms and Data Protection Law',
  'Administrative Law',
  'Banking & Finance Law',
  'Capital Markets / Securities Law',
  'Competition / Antitrust Law',
  'Construction & Real Estate Law',
  'Consumer Protection Law',
  'Corporate / Company Law',
  'Criminal Law',
  'Employment & Labour Law',
  'Energy Law',
  'Environmental Law',
  'Family Law',
  'Life Sciences Law',
  'Immigration Law',
  'Infrastructure & Public Procurement Law',
  'Media & Telecommunications Law',
  'Insolvency & Restructuring Law',
  'Insurance Law',
  'Intellectual Property (Patents, Trademarks, Copyright)',
  'International Law, Trade & Customs Law',
  'Litigation & Dispute Resolution',
  'Mergers & Acquisitions (M&A)',
  'Private Equity & Venture Capital',
  'Constitutional Law',
  'Sports & Entertainment Law',
  'Tax Law',
  'Transport & Logistics Law',
];

const JUDGMENT_PROMPT = `You are an expert EU law analyst. Analyze the following CJEU judgment and produce a JSON response with:

1. "summary": A clear, professional summary of the judgment (3-5 paragraphs). Cover:
   - The parties and background of the dispute
   - The key legal questions referred or issues raised
   - The Court's reasoning and key legal principles established
   - The ruling/operative part and its practical implications

2. "legal_areas": An array of 1-3 most relevant legal categories from this exact list:
${LEGAL_CATEGORIES.map((c) => `- ${c}`).join('\n')}

3. "jurisdiction": Always "EU" for CJEU cases.

4. "key_provisions": An array of key EU legal provisions cited (e.g., "Article 101 TFEU", "Regulation 2016/679 (GDPR) Art. 5").

5. "significance": A one-sentence assessment of the judgment's practical significance for legal practitioners.

Return ONLY valid JSON. Example:
{
  "summary": "In this case, the Court of Justice...",
  "legal_areas": ["Competition / Antitrust Law"],
  "jurisdiction": "EU",
  "key_provisions": ["Article 101 TFEU", "Article 102 TFEU"],
  "significance": "This judgment clarifies the scope of..."
}`;

async function summarizeJudgment(judgmentMeta) {
  // Build input from available data
  const parts = [];

  if (judgmentMeta.case_name || judgmentMeta.parties) {
    parts.push(`Case: ${judgmentMeta.case_name || judgmentMeta.parties}`);
  }
  if (judgmentMeta.ecli) parts.push(`ECLI: ${judgmentMeta.ecli}`);
  if (judgmentMeta.court) parts.push(`Court: ${judgmentMeta.court}`);
  if (judgmentMeta.chamber) parts.push(`Formation: ${judgmentMeta.chamber}`);
  if (judgmentMeta.document_type) parts.push(`Document type: ${judgmentMeta.document_type}`);
  if (judgmentMeta.procedure_type) parts.push(`Procedure: ${judgmentMeta.procedure_type}`);
  if (judgmentMeta.subject_matter) parts.push(`Subject matter: ${judgmentMeta.subject_matter}`);
  if (judgmentMeta.decision_date) parts.push(`Decision date: ${judgmentMeta.decision_date}`);

  const header = parts.join('\n');

  // Use full text if available, otherwise use what we have
  const textContent = judgmentMeta.full_text
    ? judgmentMeta.full_text.substring(0, 12000)
    : header;

  const input = `${header}\n\n---\n\nFull text (excerpt):\n${textContent}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `${JUDGMENT_PROMPT}\n\n---\n\n${input}`,
        },
      ],
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(`[Summarizer] Failed for judgment ${judgmentMeta.ecli}:`, err.message);
    return null;
  }
}

async function summarizeUnsummarizedJudgments(batchSize = 5) {
  // Find judgments that haven't been summarized yet
  const { rows: judgments } = await pool.query(
    `SELECT jm.*, a.title, a.description
     FROM judgment_metadata jm
     JOIN articles a ON a.id = jm.article_id
     WHERE jm.ai_summarized = FALSE
     ORDER BY jm.decision_date DESC
     LIMIT $1`,
    [batchSize]
  );

  if (judgments.length === 0) {
    console.log('[Summarizer] No unsummarized judgments found.');
    return 0;
  }

  console.log(`[Summarizer] Summarizing ${judgments.length} judgments...`);

  // Load category mapping
  const { rows: categories } = await pool.query('SELECT id, name FROM legal_categories');
  const categoryMap = {};
  for (const cat of categories) {
    categoryMap[cat.name] = cat.id;
  }

  let summarized = 0;

  for (const judgment of judgments) {
    const result = await summarizeJudgment(judgment);
    if (!result) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update judgment_metadata with summary
      await client.query(
        `UPDATE judgment_metadata
         SET ai_summary = $1, ai_summarized = TRUE
         WHERE id = $2`,
        [result.summary, judgment.id]
      );

      // Mark article as classified
      await client.query(
        `UPDATE articles
         SET ai_classified = TRUE, jurisdiction = $1, updated_at = NOW(),
             description = CASE WHEN description IS NULL OR description = '' THEN $2 ELSE description END
         WHERE id = $3`,
        [result.jurisdiction || 'EU', result.significance || '', judgment.article_id]
      );

      // Insert category associations
      if (result.legal_areas && Array.isArray(result.legal_areas)) {
        for (const area of result.legal_areas) {
          const catId = categoryMap[area];
          if (catId) {
            await client.query(
              `INSERT INTO article_categories (article_id, category_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [judgment.article_id, catId]
            );
          }
        }
      }

      await client.query('COMMIT');
      summarized++;
      console.log(`[Summarizer] Summarized: ${judgment.ecli}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[Summarizer] Failed to save summary for ${judgment.ecli}:`, err.message);
    } finally {
      client.release();
    }
  }

  console.log(`[Summarizer] Complete. ${summarized}/${judgments.length} judgments summarized.`);
  return summarized;
}

module.exports = { summarizeJudgment, summarizeUnsummarizedJudgments };
