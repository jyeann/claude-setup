// Allow-list of public guides. URLs are links only and are never fetched.
const BASE = 'https://bytebytego.com/guides/';
const SLUGS = [
  'how-can-cache-systems-go-wrong',
  'things-to-consider-when-using-cache',
  'how-do-we-retry-on-failures',
  'resiliency-patterns',
  'a-crash-course-in-database-sharding',
  'consistent-hashing',
  'types-of-message-queue',
  '7-must-know-strategies-to-scale-your-database',
  'how-does-https-work',
  'cap-theorem-one-of-the-most-misunderstood-terms',
  'how-to-deploy-services',
];

export const GUIDES = Object.freeze(SLUGS.map((s) => BASE + s));
export const GUIDE_PATTERN = /^https:\/\/bytebytego\.com\/guides\/[a-z0-9-]{1,120}$/;
export const GUIDE_PREFIX = BASE;

export function isAllowedGuide(url) {
  return typeof url === 'string' && GUIDE_PATTERN.test(url) && GUIDES.includes(url);
}
