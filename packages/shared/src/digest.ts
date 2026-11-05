/** Counts for one local calendar day. Contains no URLs and no per-page records. */
export interface DayStats {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Top-level navigations started (main_frame request_started), capped at 100 000. */
  pages: number;
  /** Pages whose third-party domain count was finalised (closed by a later navigation or tab close). */
  pagesMeasured: number;
  /** Sum of distinct third-party registrable domains over measured pages. */
  thirdPartyDomainsTotal: number;
  /** Highest distinct third-party domain count on one page. */
  thirdPartyDomainsMax: number;
  /** New known_infra.* detections (not severity updates). */
  contacts: number;
  /** Distinct documented hosts contacted, sorted, at most 50. */
  hosts: string[];
  /** New detections at elevated or high_priority (any rule). */
  strong: number;
}

export interface Digest {
  /** Local YYYY-MM-DD of "today" when computed. */
  today: string;
  /** Newest first, at most 400 entries; days with no activity are absent. */
  days: DayStats[];
  /** Mean third-party domains per measured page over the trailing 30 days before today, or null. */
  normalThirdPartyPerPage: number | null;
  /** Most recent day with contacts > 0, or null. */
  lastContact: { date: string; hosts: string[] } | null;
}
