// Maps LearnWorlds user tags to legal_categories slugs.
// The category names/slugs come from the seeded legal_categories table.

const NAME_TO_SLUG = {
  'ai, platforms and data protection law': 'ai-platforms-data-protection',
  'administrative law': 'administrative',
  'banking & finance law': 'banking-finance',
  'capital markets / securities law': 'capital-markets-securities',
  'competition / antitrust law': 'competition-antitrust',
  'construction & real estate law': 'construction-real-estate',
  'consumer protection law': 'consumer-protection',
  'corporate / company law': 'corporate-company',
  'criminal law': 'criminal',
  'employment & labour law': 'employment-labour',
  'energy law': 'energy',
  'environmental law': 'environmental',
  'family law': 'family',
  'life sciences law': 'life-sciences',
  'immigration law': 'immigration',
  'infrastructure & public procurement law': 'infrastructure-procurement',
  'media & telecommunications law': 'media-telecom',
  'insolvency & restructuring law': 'insolvency-restructuring',
  'insurance law': 'insurance',
  'intellectual property (patents, trademarks, copyright)': 'intellectual-property',
  'international law, trade & customs law': 'international-trade-customs',
  'litigation & dispute resolution': 'litigation-dispute-resolution',
  'mergers & acquisitions (m&a)': 'mergers-acquisitions',
  'private equity & venture capital': 'private-equity-vc',
  'constitutional law': 'constitutional',
  'sports & entertainment law': 'sports-entertainment',
  'tax law': 'tax',
  'transport & logistics law': 'transport-logistics',
};

// Short keyword fallbacks for less exact tag names
const KEYWORD_TO_SLUG = {
  'ai': 'ai-platforms-data-protection',
  'data protection': 'ai-platforms-data-protection',
  'gdpr': 'ai-platforms-data-protection',
  'administrative': 'administrative',
  'banking': 'banking-finance',
  'finance': 'banking-finance',
  'capital markets': 'capital-markets-securities',
  'securities': 'capital-markets-securities',
  'competition': 'competition-antitrust',
  'antitrust': 'competition-antitrust',
  'construction': 'construction-real-estate',
  'real estate': 'construction-real-estate',
  'consumer protection': 'consumer-protection',
  'consumer': 'consumer-protection',
  'corporate': 'corporate-company',
  'company law': 'corporate-company',
  'criminal': 'criminal',
  'employment': 'employment-labour',
  'labour': 'employment-labour',
  'labor': 'employment-labour',
  'energy': 'energy',
  'environmental': 'environmental',
  'family': 'family',
  'life sciences': 'life-sciences',
  'pharma': 'life-sciences',
  'immigration': 'immigration',
  'infrastructure': 'infrastructure-procurement',
  'public procurement': 'infrastructure-procurement',
  'procurement': 'infrastructure-procurement',
  'media': 'media-telecom',
  'telecommunications': 'media-telecom',
  'telecom': 'media-telecom',
  'insolvency': 'insolvency-restructuring',
  'restructuring': 'insolvency-restructuring',
  'insurance': 'insurance',
  'intellectual property': 'intellectual-property',
  'ip': 'intellectual-property',
  'patents': 'intellectual-property',
  'trademarks': 'intellectual-property',
  'copyright': 'intellectual-property',
  'international law': 'international-trade-customs',
  'trade': 'international-trade-customs',
  'customs': 'international-trade-customs',
  'litigation': 'litigation-dispute-resolution',
  'dispute resolution': 'litigation-dispute-resolution',
  'arbitration': 'litigation-dispute-resolution',
  'mergers': 'mergers-acquisitions',
  'acquisitions': 'mergers-acquisitions',
  'm&a': 'mergers-acquisitions',
  'private equity': 'private-equity-vc',
  'venture capital': 'private-equity-vc',
  'constitutional': 'constitutional',
  'sports': 'sports-entertainment',
  'entertainment': 'sports-entertainment',
  'tax': 'tax',
  'taxation': 'tax',
  'transport': 'transport-logistics',
  'logistics': 'transport-logistics',
  'shipping': 'transport-logistics',
};

function mapTagsToSlugs(tags) {
  if (!Array.isArray(tags)) return [];

  const slugs = new Set();

  for (const tag of tags) {
    const normalized = tag.toLowerCase().trim();

    // 1. Exact match against full category names
    if (NAME_TO_SLUG[normalized]) {
      slugs.add(NAME_TO_SLUG[normalized]);
      continue;
    }

    // 2. Try stripping trailing " law"
    const withoutLaw = normalized.replace(/\s+law$/i, '').trim();
    if (KEYWORD_TO_SLUG[withoutLaw]) {
      slugs.add(KEYWORD_TO_SLUG[withoutLaw]);
      continue;
    }

    // 3. Direct keyword match
    if (KEYWORD_TO_SLUG[normalized]) {
      slugs.add(KEYWORD_TO_SLUG[normalized]);
      continue;
    }

    // 4. Substring match as last resort
    let matched = false;
    for (const [key, slug] of Object.entries(KEYWORD_TO_SLUG)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        slugs.add(slug);
        matched = true;
        break;
      }
    }

    if (!matched) {
      console.log(`[TagMapper] Unmatched LearnWorlds tag: "${tag}"`);
    }
  }

  return [...slugs];
}

module.exports = { mapTagsToSlugs };
