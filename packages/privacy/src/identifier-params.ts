export type IdentifierParamCategory =
  | "device_id"
  | "network_identity"
  | "cookie_material"
  | "geolocation"
  | "contact"
  | "device_profile"
  | "ad_tech";

const CATEGORY_NAMES: Record<IdentifierParamCategory, readonly string[]> = {
  device_id: [
    "idfa",
    "gaid",
    "aaid",
    "adid",
    "advertising_id",
    "ifa",
    "idfv",
    "oaid",
    "imei",
    "mac",
    "uid",
    "user_id",
    "userid",
    "uuid",
    "cid",
    "pid",
    "sid",
    "did",
    "device_id",
    "deviceid",
  ],
  network_identity: ["ip", "ipv4", "ipv6", "new_ipv6", "ua", "user_agent"],
  cookie_material: ["cookie", "cookies"],
  geolocation: ["lat", "lon", "latitude", "longitude", "geo", "country"],
  contact: ["email", "phone", "msisdn"],
  device_profile: ["devicemodel", "device_model", "os", "osv", "model", "make"],
  ad_tech: ["sourceid", "impid", "infififo", "dsp", "bee_sync_partners", "script_tok", "q", "qq"],
};

const CATEGORY_BY_NAME: ReadonlyMap<string, IdentifierParamCategory> = new Map(
  (Object.entries(CATEGORY_NAMES) as Array<[IdentifierParamCategory, readonly string[]]>).flatMap(
    ([category, names]) => names.map((n): [string, IdentifierParamCategory] => [n, category]),
  ),
);

/** Lower-case query parameter names that commonly carry identifiers or network identity in ad traffic. */
export const IDENTIFIER_PARAM_NAMES: ReadonlySet<string> = new Set(CATEGORY_BY_NAME.keys());

export function identifierParamCategory(name: string): IdentifierParamCategory | null {
  return CATEGORY_BY_NAME.get(name.toLowerCase()) ?? null;
}

export function classifyParamNames(names: string[]): {
  categories: string[];
  identifierCount: number;
  hasCookieMaterial: boolean;
  hasContact: boolean;
} {
  const categories = new Set<string>();
  const matched = new Set<string>();
  for (const raw of names) {
    const name = raw.toLowerCase();
    const category = CATEGORY_BY_NAME.get(name);
    if (category === undefined) continue;
    matched.add(name);
    categories.add(category);
  }
  return {
    categories: Array.from(categories).sort(),
    identifierCount: matched.size,
    hasCookieMaterial: categories.has("cookie_material"),
    hasContact: categories.has("contact"),
  };
}
