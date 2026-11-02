# Public Suffix List

`public-suffix-list.json` in this directory is derived from the Public Suffix List, a
list of public suffixes maintained by the Mozilla Foundation and the PSL community.

- Source: <https://publicsuffix.org/list/public_suffix_list.dat>
- Project: <https://publicsuffix.org/>
- License: Mozilla Public License, version 2.0 (<https://mozilla.org/MPL/2.0/>)

Notice from the original file:

> This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
> If a copy of the MPL was not distributed with this file, You can obtain one at
> https://mozilla.org/MPL/2.0/.

Modifications: only the ICANN DOMAINS section was kept (the PRIVATE DOMAINS section was
removed), comments were stripped, internationalised rules were converted to punycode, and the
rules were serialised as JSON by `scripts/build-psl.mjs`. The `fetchedAt` field records when the
source file was downloaded. This directory's other data (`adfection-2026.json`) is CC0-1.0; the
MPL-2.0 applies to `public-suffix-list.json` only.
