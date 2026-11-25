// Single source of the experimental-version limits statement. Wording approved verbatim by the owner
// (user reply "تمام نفذ" to the review message, wamid ...RkFEMjNFMzhEQkRCRkUwRgA=, 25 Nov 2026 09:58). Do not edit it here without the owner's approval.
export const BETA_LIMITS_AR =
  'نسخة تجريبية لمقارنة السيناريوهات. النتائج مبنية على المدخلات، ولم تُتحقق دقتها مقابل إنتاج مصنع حقيقي. لا تعتمد عليها وحدها لتقديم أرقام لعميل أو لاتخاذ قرارات معدات أو عمالة.';
export const BETA_LIMITS_EN =
  'Experimental version for scenario comparison. Results depend on the inputs and have not been validated against real plant output. Do not rely on them alone for client-facing figures or equipment or staffing decisions.';
export const betaLimitsText = (isAr: boolean): string => (isAr ? BETA_LIMITS_AR : BETA_LIMITS_EN);
