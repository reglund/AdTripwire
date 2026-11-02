import { describe, expect, it } from "vitest";
import {
  IDENTIFIER_PARAM_NAMES,
  classifyParamNames,
  identifierParamCategory,
} from "./identifier-params.js";

const REQUIRED = (
  "idfa gaid aaid adid advertising_id ifa idfv oaid imei msisdn mac uid user_id userid uuid cid pid sid did " +
  "device_id deviceid ip ipv4 ipv6 new_ipv6 ua user_agent devicemodel device_model os osv model make lat lon " +
  "latitude longitude geo country cookie cookies email phone sourceid impid infififo dsp bee_sync_partners " +
  "script_tok q qq"
).split(" ");

describe("IDENTIFIER_PARAM_NAMES", () => {
  it("contains every required name, all lower-case", () => {
    for (const n of REQUIRED) expect(IDENTIFIER_PARAM_NAMES.has(n)).toBe(true);
    for (const n of IDENTIFIER_PARAM_NAMES) expect(n).toBe(n.toLowerCase());
    expect(IDENTIFIER_PARAM_NAMES.size).toBe(REQUIRED.length);
  });

  it("every name has a category", () => {
    for (const n of IDENTIFIER_PARAM_NAMES) expect(identifierParamCategory(n)).not.toBeNull();
  });
});

describe("identifierParamCategory", () => {
  it.each([
    ["idfa", "device_id"],
    ["IDFA", "device_id"],
    ["ipv4", "network_identity"],
    ["new_ipv6", "network_identity"],
    ["cookie", "cookie_material"],
    ["lat", "geolocation"],
    ["email", "contact"],
    ["osv", "device_profile"],
    ["bee_sync_partners", "ad_tech"],
  ])("%s -> %s", (name, cat) => {
    expect(identifierParamCategory(name)).toBe(cat);
  });

  it("returns null for unknown names", () => {
    expect(identifierParamCategory("page")).toBeNull();
    expect(identifierParamCategory("")).toBeNull();
    expect(identifierParamCategory("constructor")).toBeNull();
    expect(identifierParamCategory("__proto__")).toBeNull();
  });
});

describe("classifyParamNames", () => {
  it("handles empty input", () => {
    expect(classifyParamNames([])).toEqual({
      categories: [],
      identifierCount: 0,
      hasCookieMaterial: false,
      hasContact: false,
    });
  });

  it("classifies a mixed list", () => {
    expect(classifyParamNames(["idfa", "ipv4", "cookie", "page", "email"])).toEqual({
      categories: ["contact", "cookie_material", "device_id", "network_identity"],
      identifierCount: 4,
      hasCookieMaterial: true,
      hasContact: true,
    });
  });

  it("counts distinct names case-insensitively and ignores unknown names", () => {
    const r = classifyParamNames(["IDFA", "idfa", "gaid", "utm_source"]);
    expect(r.identifierCount).toBe(2);
    expect(r.categories).toEqual(["device_id"]);
    expect(r.hasCookieMaterial).toBe(false);
    expect(r.hasContact).toBe(false);
  });

  it("treats msisdn as contact", () => {
    expect(classifyParamNames(["msisdn"]).hasContact).toBe(true);
  });
});
