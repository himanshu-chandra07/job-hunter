// Known company → official career-site URL directory.
// Used to (a) always surface a real "career site" link for these employers and
// (b) point live career-site discovery at the exact URL instead of guessing.

export const normalizeKey = (name = "") =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

const ENTRIES = [
  ["Google", "https://careers.google.com"],
  ["Meta", "https://www.metacareers.com"],
  ["Microsoft", "https://careers.microsoft.com"],
  ["Amazon", "https://www.amazon.jobs"],
  ["Apple", "https://jobs.apple.com"],
  ["Netflix", "https://jobs.netflix.com"],
  ["Uber", "https://www.uber.com/careers"],
  ["Airbnb", "https://careers.airbnb.com"],
  ["Adobe", "https://careers.adobe.com"],
  ["Salesforce", "https://careers.salesforce.com"],
  ["Atlassian", "https://www.atlassian.com/company/careers"],
  ["LinkedIn", "https://careers.linkedin.com"],
  ["NVIDIA", "https://www.nvidia.com/en-us/about-nvidia/careers"],
  ["ServiceNow", "https://careers.servicenow.com"],
  ["Stripe", "https://stripe.com/jobs"],
  ["Databricks", "https://www.databricks.com/company/careers"],
  ["Snowflake", "https://careers.snowflake.com"],
  ["Cloudflare", "https://www.cloudflare.com/careers"],
  ["Datadog", "https://www.datadoghq.com/careers"],
  ["Coinbase", "https://www.coinbase.com/careers"],
  ["MongoDB", "https://www.mongodb.com/careers"],
  ["Confluent", "https://www.confluent.io/careers"],
  ["HashiCorp", "https://www.hashicorp.com/careers"],
  ["Palantir", "https://www.palantir.com/careers"],
  ["Twilio", "https://www.twilio.com/company/jobs"],
  ["Shopify", "https://www.shopify.com/careers"],
  ["Dropbox", "https://jobs.dropbox.com"],
  ["GitHub", "https://github.careers"],
  ["Reddit", "https://www.redditinc.com/careers"],
  ["Pinterest", "https://www.pinterestcareers.com"],
  ["Slack", "https://slack.com/careers"],
  ["Cisco", "https://careers.cisco.com/global/en/search-results"],
  ["Oracle", "https://careers.oracle.com/en/sites/jobsearch"],
  ["VMware", "https://careers.vmware.com"],
  // Omnissa: VMware's End-User Computing spinoff — Workday board.
  ["Omnissa", "https://www.omnissa.com/careers/"],
  ["Intel", "https://jobs.intel.com"],
  ["Qualcomm", "https://careers.qualcomm.com/careers"],
  ["Cisco Meraki", "https://meraki.cisco.com/jobs"],
  ["Pure Storage", "https://www.purestorage.com/company/careers.html"],
  ["Rubrik", "https://www.rubrik.com/company/careers"],
  ["CrowdStrike", "https://www.crowdstrike.com/careers"],
  ["Palo Alto Networks", "https://jobs.paloaltonetworks.com"],
  ["Zscaler", "https://www.zscaler.com/careers"],
  ["Netskope", "https://www.netskope.com/company/careers"],
  ["Okta", "https://www.okta.com/company/careers"],
  ["OpenAI", "https://openai.com/careers"],
  ["Anthropic", "https://www.anthropic.com/careers"],
  ["Mistral AI", "https://mistral.ai/careers"],
  ["Cohere", "https://cohere.com/careers"],
  ["Scale AI", "https://scale.com/careers"],
  ["Rippling", "https://www.rippling.com/careers"],
  ["Figma", "https://www.figma.com/careers"],
  ["Canva", "https://www.canva.com/careers"],
  ["DoorDash", "https://careers.doordash.com"],
  ["Instacart", "https://instacart.careers"],
  ["Robinhood", "https://careers.robinhood.com"],
  ["Bloomberg", "https://careers.bloomberg.com"],
  ["eBay", "https://jobs.ebayinc.com"],
  // Additional well-known tech employers (resolved to live public ATS boards).
  ["DocuSign", "https://careers.docusign.com"],
  ["Lyft", "https://www.lyft.com/careers"],
  ["Spotify", "https://www.lifeatspotify.com"],
  ["Roblox", "https://careers.roblox.com"],
  ["Block", "https://block.xyz/careers"],
  ["Discord", "https://discord.com/careers"],
  ["Notion", "https://www.notion.so/careers"],
  ["Plaid", "https://plaid.com/careers"],
  ["Asana", "https://asana.com/jobs"],
  ["Affirm", "https://www.affirm.com/careers"],
  ["Brex", "https://www.brex.com/careers"],
  ["Ramp", "https://ramp.com/careers"],
  ["Samsara", "https://www.samsara.com/company/careers"],
  ["Verkada", "https://www.verkada.com/careers"],
  ["Postman", "https://www.postman.com/company/careers"],
  ["Airtable", "https://www.airtable.com/careers"],
  ["Chime", "https://careers.chime.com"],
  ["Gusto", "https://gusto.com/about/careers"],
  ["Coursera", "https://careers.coursera.com"],
  ["ServiceTitan", "https://careers.servicetitan.com"],
  ["Roku", "https://www.roku.com/careers"],
  ["Tesco", "https://www.tesco-careers.com"],
  // Target in India (TII): India-only careers board on TalentBrew/Radancy.
  ["Target", "https://indiajobs.target.com"],
  ["Visa", "https://corporate.visa.com/en/jobs/"],
  // Quant / financial-tech firms on custom portals (parsed via dedicated fetchers).
  ["DE Shaw", "https://www.deshawindia.com/careers/work-with-us"],
  ["Arcesium", "https://www.arcesium.com/careers"],
  ["Goldman Sachs", "https://higher.gs.com"],
  ["Morgan Stanley", "https://www.morganstanley.com/careers"],
  ["JPMorgan Chase", "https://careers.jpmorgan.com"],
  ["Fidelity Investments", "https://jobs.fidelity.com"],
];

// Sector tags (currently used to gate the optional "fintech" group behind a
// toggle in the weekly digest, and to badge those firms in the Companies grid).
const SECTORS = {
  goldmansachs: "fintech",
  morganstanley: "fintech",
  jpmorganchase: "fintech",
  fidelityinvestments: "fintech",
};

// Employers whose own career portals aren't machine-readable (large banks and
// payment networks); we fetch their openings via LinkedIn's company-filtered
// guest search (f_C = numeric id).
export const FINTECH_COMPANIES = [
  {
    name: "Goldman Sachs",
    companyId: 1382,
    careerUrl: "https://higher.gs.com",
    aliases: ["goldman", "goldmansachs", "gs"],
  },
  {
    name: "Morgan Stanley",
    companyId: 497017,
    careerUrl: "https://www.morganstanley.com/careers",
    aliases: ["morganstanley", "morgan stanley", "ms"],
  },
  {
    name: "JPMorgan Chase",
    companyId: 1068,
    careerUrl: "https://careers.jpmorgan.com",
    aliases: ["jpmorgan", "jp morgan", "jpmorganchase", "jpmc", "chase"],
  },
  {
    name: "Fidelity Investments",
    companyId: 1307,
    careerUrl: "https://jobs.fidelity.com",
    aliases: ["fidelity", "fidelityinvestments", "fmr"],
  },
];

// Resolve a free-text company name to a fintech entry (by name or alias).
export function lookupFintech(company) {
  const k = normalizeKey(company);
  return (
    FINTECH_COMPANIES.find(
      (f) =>
        normalizeKey(f.name) === k ||
        (f.aliases || []).some((a) => normalizeKey(a) === k)
    ) || null
  );
}

export const COMPANY_DIRECTORY = Object.fromEntries(
  ENTRIES.map(([name, url]) => [normalizeKey(name), { name, careerUrl: url }])
);

export function lookupCareerSite(company) {
  return COMPANY_DIRECTORY[normalizeKey(company)] || null;
}

// Resolved status from the resolution sweep (provider, approx open roles).
// Companies without an entry use a proprietary/JS portal we can't read yet and
// are exposed as career-link-only.
const STATUS = {
  uber: ["Uber", 93],
  airbnb: ["Greenhouse", 226],
  google: ["Google", 160],
  microsoft: ["LinkedIn", 100],
  amazon: ["Amazon", 300],
  atlassian: ["Atlassian", 170],
  adobe: ["Workday", 600],
  apple: ["Apple", 66],
  linkedin: ["Greenhouse", 73],
  nvidia: ["Workday", 600],
  servicenow: ["SmartRecruiters", 100],
  stripe: ["Greenhouse", 511],
  databricks: ["Greenhouse", 758],
  snowflake: ["Ashby", 412],
  cloudflare: ["Greenhouse", 199],
  datadog: ["Greenhouse", 403],
  coinbase: ["Greenhouse", 103],
  mongodb: ["Greenhouse", 424],
  confluent: ["Ashby", 47],
  palantir: ["Lever", 248],
  twilio: ["Greenhouse", 165],
  dropbox: ["Greenhouse", 59],
  reddit: ["Greenhouse", 157],
  pinterest: ["Greenhouse", 183],
  slack: ["Workday", 14],
  purestorage: ["Greenhouse", 334],
  rubrik: ["Greenhouse", 112],
  crowdstrike: ["Workday", 441],
  paloaltonetworks: ["Workday", 600],
  zscaler: ["Greenhouse", 338],
  netskope: ["Greenhouse", 142],
  okta: ["Greenhouse", 363],
  openai: ["Ashby", 711],
  anthropic: ["Greenhouse", 374],
  mistralai: ["Lever", 170],
  cohere: ["Ashby", 131],
  scaleai: ["Greenhouse", 176],
  figma: ["Greenhouse", 164],
  canva: ["SmartRecruiters", 100],
  instacart: ["Greenhouse", 163],
  robinhood: ["Greenhouse", 142],
  intel: ["Workday", 600],
  oracle: ["Oracle", 175],
  cisco: ["Cisco", 25],
  meta: ["LinkedIn", 10],
  rippling: ["Rippling", 32],
  qualcomm: ["Qualcomm", 417],
  salesforce: ["Workday", 600],
  vmware: ["Workday", 346],
  omnissa: ["Workday", 122],
  bloomberg: ["Avature", 436],
  ebay: ["Workday", 581],
  docusign: ["SmartRecruiters", 4],
  lyft: ["Greenhouse", 155],
  spotify: ["Lever", 110],
  roblox: ["Greenhouse", 232],
  block: ["Greenhouse", 206],
  discord: ["Greenhouse", 57],
  notion: ["Ashby", 141],
  plaid: ["Ashby", 113],
  asana: ["Greenhouse", 145],
  affirm: ["Greenhouse", 174],
  brex: ["Greenhouse", 266],
  ramp: ["Ashby", 128],
  samsara: ["Greenhouse", 310],
  verkada: ["Greenhouse", 289],
  postman: ["Greenhouse", 121],
  airtable: ["Greenhouse", 37],
  chime: ["Greenhouse", 72],
  gusto: ["Greenhouse", 80],
  coursera: ["Greenhouse", 11],
  servicetitan: ["SmartRecruiters", 8],
  roku: ["Greenhouse", 235],
  tesco: ["Tesco", 60],
  target: ["Target", 86],
  visa: ["Workday", 113],
  deshaw: ["DE Shaw", 91],
  arcesium: ["Greenhouse", 33],
  goldmansachs: ["LinkedIn", 30],
  morganstanley: ["LinkedIn", 30],
  jpmorganchase: ["LinkedIn", 40],
  fidelityinvestments: ["LinkedIn", 12],
};

export const COMPANY_LIST = ENTRIES.map(([name, url]) => {
  const s = STATUS[normalizeKey(name)];
  return {
    name,
    url,
    provider: s ? s[0] : null,
    jobs: s ? s[1] : 0,
    live: !!s,
    sector: SECTORS[normalizeKey(name)] || null,
  };
}).sort((a, b) => a.name.localeCompare(b.name));
