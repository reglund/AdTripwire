import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "@adtripwire/shared";
import type { SensorOptions } from "@adtripwire/sensor-firefox";
import type { ChromiumRequestDetails } from "./event-builder.js";
import {
  ChromiumWebRequestSensor,
  type ChromeLike,
  type ChromiumSensorOptions,
  type TabLike,
} from "./webrequest-sensor.js";

type AnyFn = (...args: never[]) => unknown;

interface Recorded {
  event: string;
  filter: unknown;
  extraInfoSpec: unknown;
  listener: AnyFn;
}

function fakeEvent(name: string, log: Recorded[]) {
  const listeners: AnyFn[] = [];
  return {
    listeners,
    addListener: (cb: AnyFn, filter?: unknown, extraInfoSpec?: unknown) => {
      listeners.push(cb);
      log.push({ event: name, filter, extraInfoSpec, listener: cb });
    },
    removeListener: (cb: AnyFn) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    fire: (...args: unknown[]) => {
      for (const l of listeners) (l as (...a: unknown[]) => unknown)(...args);
    },
  };
}

function makeFakeChrome(opts: { tabs?: TabLike[]; incognitoAllowed?: boolean } = {}) {
  const log: Recorded[] = [];
  const accessed = new Set<string>();
  const wrRaw = {
    onBeforeRequest: fakeEvent("onBeforeRequest", log),
    onBeforeRedirect: fakeEvent("onBeforeRedirect", log),
    onCompleted: fakeEvent("onCompleted", log),
    onErrorOccurred: fakeEvent("onErrorOccurred", log),
    onHeadersReceived: fakeEvent("onHeadersReceived", log),
    onBeforeSendHeaders: fakeEvent("onBeforeSendHeaders", log),
    onAuthRequired: fakeEvent("onAuthRequired", log),
  };
  const webRequest = new Proxy(wrRaw, {
    get(target, prop, recv) {
      accessed.add(String(prop));
      return Reflect.get(target, prop, recv) as unknown;
    },
  });
  const tabs = opts.tabs ?? [];
  const getAllFrames = vi.fn(
    async () => [] as Array<{ frameId: number; parentFrameId: number; url: string }>,
  );
  const chrome = {
    webRequest,
    webNavigation: {
      onBeforeNavigate: fakeEvent("onBeforeNavigate", log),
      onCommitted: fakeEvent("onCommitted", log),
      getAllFrames,
    },
    tabs: {
      onCreated: fakeEvent("tabs.onCreated", log),
      onUpdated: fakeEvent("tabs.onUpdated", log),
      onRemoved: fakeEvent("tabs.onRemoved", log),
      query: vi.fn(async () => tabs),
      get: vi.fn(async (id: number) => {
        const t = tabs.find((x) => x.id === id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        return t;
      }),
    },
    extension: { isAllowedIncognitoAccess: vi.fn(async () => opts.incognitoAllowed ?? true) },
  };
  return { chrome, wr: wrRaw, log, accessed, getAllFrames };
}

function makeOpts(over: Partial<ChromiumSensorOptions> = {}) {
  const events: NormalizedEvent[] = [];
  const opts: ChromiumSensorOptions = {
    browserName: "chromium",
    shouldObserve: () => true,
    excludeIncognito: () => true,
    enabled: () => true,
    onEvent: (ev) => events.push(ev),
    ...over,
  };
  return { opts, events };
}

const req = (over: Partial<ChromiumRequestDetails> = {}): ChromiumRequestDetails => ({
  requestId: "100",
  url: "https://ads.example/getAd?uid=SECRET&x=1",
  method: "GET",
  type: "script",
  tabId: 1,
  frameId: 0,
  parentFrameId: -1,
  timeStamp: 1000,
  initiator: "https://news.example",
  ...over,
});

const sensors: ChromiumWebRequestSensor[] = [];
function setup(
  fake = makeFakeChrome({ tabs: [{ id: 1, incognito: false }] }),
  over: Partial<ChromiumSensorOptions> = {},
) {
  const { opts, events } = makeOpts(over);
  const sensor = new ChromiumWebRequestSensor(opts, { api: fake.chrome as unknown as ChromeLike });
  sensors.push(sensor);
  sensor.register();
  return { sensor, events, ...fake };
}

afterEach(() => {
  for (const s of sensors.splice(0)) s.dispose();
});

describe("ChromiumWebRequestSensor registration", () => {
  it("registers the four non-blocking webRequest observers on <all_urls>", () => {
    const { log } = setup();
    const wr = log.filter((r) =>
      ["onBeforeRequest", "onBeforeRedirect", "onCompleted", "onErrorOccurred"].includes(r.event),
    );
    expect(wr.map((r) => r.event).sort()).toEqual(
      ["onBeforeRedirect", "onBeforeRequest", "onCompleted", "onErrorOccurred"].sort(),
    );
    for (const r of wr) expect(r.filter).toEqual({ urls: ["<all_urls>"] });
    expect(wr.find((r) => r.event === "onCompleted")!.extraInfoSpec).toEqual(["responseHeaders"]);
    expect(
      log.some((r) =>
        ["onHeadersReceived", "onBeforeSendHeaders", "onAuthRequired"].includes(r.event),
      ),
    ).toBe(false);
  });

  it("never passes a blocking extraInfoSpec anywhere", () => {
    const { log } = setup();
    for (const r of log) {
      const spec = Array.isArray(r.extraInfoSpec) ? (r.extraInfoSpec as string[]) : [];
      expect(spec).not.toContain("blocking");
      expect(spec).not.toContain("asyncBlocking");
    }
  });

  it("never reads webRequest.filterResponseData", async () => {
    const { wr, accessed, sensor } = setup();
    await sensor.ready();
    wr.onBeforeRequest.fire(req());
    wr.onCompleted.fire(req({ statusCode: 200 }));
    expect(accessed.has("filterResponseData")).toBe(false);
    expect(accessed.has("onBeforeRequest")).toBe(true);
  });

  it("registers webNavigation and tabs listeners synchronously in register()", () => {
    const { log } = setup();
    const names = log.map((r) => r.event);
    for (const n of [
      "onBeforeNavigate",
      "onCommitted",
      "tabs.onCreated",
      "tabs.onUpdated",
      "tabs.onRemoved",
    ])
      expect(names).toContain(n);
  });

  it("listeners return undefined (observers only)", async () => {
    const { log, sensor } = setup();
    await sensor.ready();
    const l = log.find((r) => r.event === "onBeforeRequest")!.listener as (d: unknown) => unknown;
    expect(l(req())).toBeUndefined();
  });

  it("accepts a Firefox SensorOptions object", () => {
    const ff: SensorOptions = {
      ...makeOpts().opts,
      inspectionMatchPatterns: [],
      shouldInspect: () => true,
      analyzer: () => ({ markers: [] }) as never,
      maxInspectBytes: () => 1,
    };
    const s = new ChromiumWebRequestSensor(ff, {
      api: makeFakeChrome().chrome as unknown as ChromeLike,
    });
    sensors.push(s);
    expect(s.stats.activeFilters).toBe(0);
  });
});

describe("ChromiumWebRequestSensor event flow", () => {
  it("emits started → redirected → completed with no response_inspected events", async () => {
    const { wr, events, sensor } = setup();
    await sensor.ready();
    wr.onBeforeRequest.fire(req());
    wr.onBeforeRedirect.fire(req({ redirectUrl: "https://cdn.example/x.js?t=SECRET" }));
    wr.onBeforeRequest.fire(req({ url: "https://cdn.example/x.js?t=SECRET" })); // same requestId after redirect
    wr.onCompleted.fire(
      req({
        url: "https://cdn.example/x.js?t=SECRET",
        statusCode: 200,
        responseHeaders: [{ name: "content-length", value: "42" }],
      }),
    );
    expect(events.map((e) => e.eventType)).toEqual([
      "request_started",
      "request_redirected",
      "request_completed",
    ]);
    expect(events.every((e) => e.eventType !== "response_inspected")).toBe(true);
    const completed = events[2]!;
    expect(completed.responseSizeIfObservable).toBe(42);
    expect(completed.observationLimitations).toContain("no_response_body_access");
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(sensor.stats.pending).toBe(0);
  });

  it("emits error events and clears pending", async () => {
    const { wr, events, sensor } = setup();
    await sensor.ready();
    wr.onBeforeRequest.fire(req());
    wr.onErrorOccurred.fire(req({ error: "net::ERR_BLOCKED_BY_CLIENT" }));
    expect(events.map((e) => e.eventType)).toEqual(["request_started", "request_error"]);
    expect(sensor.stats.pending).toBe(0);
  });

  it("ignores completions for requests it never started (shouldObserve false)", async () => {
    const { wr, events, sensor } = setup(undefined, { shouldObserve: () => false });
    await sensor.ready();
    wr.onBeforeRequest.fire(req());
    wr.onCompleted.fire(req({ statusCode: 200 }));
    expect(events).toEqual([]);
  });

  it("emits nothing when disabled", async () => {
    const { wr, events, sensor } = setup(undefined, { enabled: () => false });
    await sensor.ready();
    wr.onBeforeRequest.fire(req());
    wr.onBeforeRedirect.fire(req({ redirectUrl: "https://x.example/" }));
    wr.onCompleted.fire(req({ statusCode: 200 }));
    expect(events).toEqual([]);
  });

  it("uses the frame tree fed by webNavigation", async () => {
    const fake = makeFakeChrome({ tabs: [{ id: 1, incognito: false }] });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    fake.chrome.webNavigation.onCommitted.fire({
      tabId: 1,
      frameId: 0,
      parentFrameId: -1,
      url: "https://news.example/",
    });
    fake.chrome.webNavigation.onCommitted.fire({
      tabId: 1,
      frameId: 5,
      parentFrameId: 0,
      url: "https://adframe.example/",
    });
    wr.onBeforeRequest.fire(
      req({ frameId: 5, parentFrameId: 0, initiator: "https://adframe.example" }),
    );
    expect(events[0]!.frameContext).toMatchObject({
      ancestorFrameIds: [0],
      ancestorHostnames: ["news.example"],
      topHostname: "news.example",
      thirdParty: true,
    });
    expect(fake.getAllFrames).not.toHaveBeenCalled();
  });

  it("schedules a getAllFrames refresh when a frame is unknown", async () => {
    const { wr, getAllFrames, sensor } = setup();
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ frameId: 9, parentFrameId: 0 }));
    expect(getAllFrames).toHaveBeenCalledWith({ tabId: 1 });
  });
});

describe("ChromiumWebRequestSensor incognito exclusion", () => {
  it("drops events from incognito tabs when excludeIncognito is on", async () => {
    const fake = makeFakeChrome({
      tabs: [
        { id: 1, incognito: false },
        { id: 2, incognito: true },
      ],
    });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ requestId: "a", tabId: 2 }));
    wr.onCompleted.fire(req({ requestId: "a", tabId: 2 }));
    wr.onBeforeRequest.fire(req({ requestId: "b", tabId: 1 }));
    expect(events.map((e) => e.tabId)).toEqual([1]);
  });

  it("learns incognito tabs from tabs.onCreated", async () => {
    const fake = makeFakeChrome({ tabs: [] });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    fake.chrome.tabs.onCreated.fire({ id: 7, incognito: true });
    fake.chrome.tabs.onCreated.fire({ id: 8, incognito: false });
    wr.onBeforeRequest.fire(req({ requestId: "a", tabId: 7 }));
    wr.onBeforeRequest.fire(req({ requestId: "b", tabId: 8 }));
    expect(events.map((e) => e.tabId)).toEqual([8]);
  });

  it("fails closed for unknown tabs and looks them up lazily", async () => {
    const fake = makeFakeChrome({ tabs: [] });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ tabId: 33 }));
    expect(events).toEqual([]);
    expect(fake.chrome.tabs.get).toHaveBeenCalledWith(33);
    expect(sensor.stats.droppedUnknownTab).toBe(1);
  });

  it("keeps incognito events when excludeIncognito is off", async () => {
    const fake = makeFakeChrome({ tabs: [{ id: 2, incognito: true }] });
    const { wr, events, sensor } = setup(fake, { excludeIncognito: () => false });
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ tabId: 2 }));
    expect(events).toHaveLength(1);
  });

  it("skips per-tab checks when the extension has no incognito access", async () => {
    const fake = makeFakeChrome({ tabs: [], incognitoAllowed: false });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ tabId: 33 }));
    expect(events).toHaveLength(1);
  });

  it("keeps non-tab requests (tabId -1) when the extension has no incognito access", async () => {
    const fake = makeFakeChrome({ tabs: [], incognitoAllowed: false });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ tabId: -1 }));
    expect(events).toHaveLength(1);
    expect(events[0]!.tabId).toBeUndefined();
  });

  it("drops non-tab requests (tabId -1) when incognito access is granted and exclusion is on", async () => {
    const fake = makeFakeChrome({ tabs: [], incognitoAllowed: true });
    const { wr, events, sensor } = setup(fake);
    await sensor.ready();
    wr.onBeforeRequest.fire(req({ tabId: -1 }));
    expect(events).toEqual([]);
    const off = setup(makeFakeChrome({ tabs: [], incognitoAllowed: true }), {
      excludeIncognito: () => false,
    });
    await off.sensor.ready();
    off.wr.onBeforeRequest.fire(req({ tabId: -1 }));
    expect(off.events).toHaveLength(1);
  });

  it("queues events that arrive before the tab cache is primed and replays them in order", async () => {
    const fake = makeFakeChrome({
      tabs: [
        { id: 1, incognito: false },
        { id: 2, incognito: true },
      ],
    });
    const { wr, events, sensor } = setup(fake);
    // Fired synchronously after register(), before priming resolved (service-worker wake).
    wr.onBeforeRequest.fire(req({ requestId: "a", tabId: 1 }));
    wr.onBeforeRequest.fire(req({ requestId: "b", tabId: 2 }));
    wr.onCompleted.fire(req({ requestId: "a", tabId: 1, statusCode: 204 }));
    expect(events).toEqual([]);
    expect(sensor.stats.queuedUntilPrimed).toBe(3);
    await sensor.ready();
    expect(events.map((e) => [e.requestId, e.eventType])).toEqual([
      ["a", "request_started"],
      ["a", "request_completed"],
    ]);
  });

  it("clears tab and frame state on tabs.onRemoved", async () => {
    const fake = makeFakeChrome({ tabs: [{ id: 1, incognito: false }] });
    const { sensor } = setup(fake);
    await sensor.ready();
    fake.chrome.webNavigation.onCommitted.fire({
      tabId: 1,
      frameId: 0,
      parentFrameId: -1,
      url: "https://news.example/",
    });
    expect(sensor.frameTree.ancestry(1, 0)).toBeDefined();
    fake.chrome.tabs.onRemoved.fire(1, {});
    expect(sensor.frameTree.ancestry(1, 0)).toBeUndefined();
  });
});
