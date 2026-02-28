-- Legal News Aggregator Schema

CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT UNIQUE NOT NULL,
  description TEXT,
  content TEXT,
  source_name TEXT,
  source_url TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  feed_type TEXT NOT NULL CHECK (feed_type IN ('news', 'blogpost', 'judgment', 'regulatory')),
  jurisdiction TEXT,
  language TEXT DEFAULT 'en',
  relevance_score REAL DEFAULT 1.0,
  ai_classified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS article_categories (
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES legal_categories(id) ON DELETE CASCADE,
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (article_id, category_id)
);

-- Judgment-specific metadata (CJEU, etc.)
CREATE TABLE IF NOT EXISTS judgment_metadata (
  id SERIAL PRIMARY KEY,
  article_id INTEGER UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  case_number TEXT,
  ecli TEXT UNIQUE,
  court TEXT,                         -- 'Court of Justice' or 'General Court'
  chamber TEXT,                       -- e.g. 'Grand Chamber', 'Tenth Chamber'
  judge_rapporteur TEXT,
  advocate_general TEXT,
  procedure_type TEXT,                -- e.g. 'Actions for annulment', 'Reference for a preliminary ruling'
  procedure_result TEXT,
  subject_matter TEXT,                -- original CJEU subject classification
  case_name TEXT,                     -- usual case name, e.g. 'Silex v Commission'
  document_type TEXT,                 -- 'Judgment', 'Order', 'Opinion'
  decision_date DATE,
  lodging_date DATE,
  case_language TEXT,                 -- language of the case
  ai_summary TEXT,                    -- AI-generated summary
  ai_summarized BOOLEAN DEFAULT FALSE,
  parties TEXT,
  full_text TEXT,
  celex_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_judgment_case_number ON judgment_metadata(case_number);
CREATE INDEX idx_judgment_court ON judgment_metadata(court);
CREATE INDEX idx_judgment_ecli ON judgment_metadata(ecli);
CREATE INDEX idx_judgment_decision_date ON judgment_metadata(decision_date DESC);
CREATE INDEX idx_judgment_ai_summarized ON judgment_metadata(ai_summarized);

CREATE TABLE IF NOT EXISTS saved_articles (
  id SERIAL PRIMARY KEY,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id)
);

CREATE INDEX idx_articles_feed_type ON articles(feed_type);
CREATE INDEX idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX idx_articles_relevance ON articles(relevance_score DESC);
CREATE INDEX idx_articles_jurisdiction ON articles(jurisdiction);
CREATE INDEX idx_articles_ai_classified ON articles(ai_classified);
CREATE INDEX idx_article_categories_category ON article_categories(category_id);

-- Seed the 28 legal categories
INSERT INTO legal_categories (name, slug) VALUES
  ('AI, Platforms and Data Protection Law', 'ai-platforms-data-protection'),
  ('Administrative Law', 'administrative'),
  ('Banking & Finance Law', 'banking-finance'),
  ('Capital Markets / Securities Law', 'capital-markets-securities'),
  ('Competition / Antitrust Law', 'competition-antitrust'),
  ('Construction & Real Estate Law', 'construction-real-estate'),
  ('Consumer Protection Law', 'consumer-protection'),
  ('Corporate / Company Law', 'corporate-company'),
  ('Criminal Law', 'criminal'),
  ('Employment & Labour Law', 'employment-labour'),
  ('Energy Law', 'energy'),
  ('Environmental Law', 'environmental'),
  ('Family Law', 'family'),
  ('Life Sciences Law', 'life-sciences'),
  ('Immigration Law', 'immigration'),
  ('Infrastructure & Public Procurement Law', 'infrastructure-procurement'),
  ('Media & Telecommunications Law', 'media-telecom'),
  ('Insolvency & Restructuring Law', 'insolvency-restructuring'),
  ('Insurance Law', 'insurance'),
  ('Intellectual Property (Patents, Trademarks, Copyright)', 'intellectual-property'),
  ('International Law, Trade & Customs Law', 'international-trade-customs'),
  ('Litigation & Dispute Resolution', 'litigation-dispute-resolution'),
  ('Mergers & Acquisitions (M&A)', 'mergers-acquisitions'),
  ('Private Equity & Venture Capital', 'private-equity-vc'),
  ('Constitutional Law', 'constitutional'),
  ('Sports & Entertainment Law', 'sports-entertainment'),
  ('Tax Law', 'tax'),
  ('Transport & Logistics Law', 'transport-logistics')
ON CONFLICT (slug) DO NOTHING;
