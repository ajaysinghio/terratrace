# TerraTrace — Positioning & Prior Art

**Audience:** Terra Team, EE technical leads, bid reviewers.
**Purpose:** Answer the two questions any reviewer will ask about TerraTrace — "isn't this just AWS's carbon dashboard?" and "isn't this just Cloud Carbon Footprint?" — with honest, defensible answers, and lock in the positioning we'll take into EE bids and the field-brief discussion.

---

## TL;DR

- The two comparators TerraTrace has to beat are **AWS's Customer Carbon Footprint Tool (CCFT)** and the open source **Cloud Carbon Footprint (CCF)** project. They are not the same thing and need separate answers.
- **CCFT** is a free AWS dashboard. TerraTrace differentiates on code-level attribution, LLM-generated fix diffs, cross-estate scope (on-prem + cloud + code), and a defensible location-based methodology suitable for public-sector tenders.
- **CCF** is not a competitor — it is TerraTrace's **methodology upstream**. The right positioning is *"TerraTrace = CCF's methodology + code-level attribution + LLM fix diffs, packaged for consultancy delivery."* We should depend on CCF's npm packages rather than reimplement their coefficient tables.
- Doing this openly (naming CCF as our foundation) is a **stronger** bid position than pretending we invented the math. Reviewers who know the space will recognise CCF; not naming it looks either naive or dishonest.

---

## 1. What CCFT is (AWS's built-in tool)

AWS Customer Carbon Footprint Tool — free, built into the AWS Console under Billing. Shows a customer's carbon footprint per service / region / month with a ~3-month lag.

**Methodology:** proprietary, market-based Scope 2 — includes AWS's own PPA and renewables offsets, which typically produces *lower* CO2e numbers than a location-based methodology. Not fully published.

**Scope:** AWS-only, retrospective only, dashboard only.

---

## 2. What CCF is (the open source project)

[Cloud Carbon Footprint](https://github.com/cloud-carbon-footprint/cloud-carbon-footprint) — Apache 2.0 TypeScript monorepo maintained by ThoughtWorks + community since 2020. Estimates kWh and kg CO2e from public-cloud usage across AWS, GCP, Azure, and Alibaba, plus an on-premise package.

**Methodology:** location-based Scope 2 only. Built on Etsy's "Cloud Jewels" methodology, not SCI. Operational emissions = `usage × kWh coefficient × PUE × grid intensity`, with separate formulas for compute / storage / networking / memory. Coefficients from **SPECPower** (compute), the **2016 US Data Center Energy Usage Report** (storage), and **Teads** (GPU). Grid intensity from **EPA eGRID2023** (US), **EEA** (Europe), **Google's data** (GCP), and **carbonfootprint.com** (global).

**Data source:** AWS **CUR via Athena**, GCP BigQuery billing export, Azure Consumption API. **Not aggregated Cost Explorer** — CUR's per-hour, per-instance granularity is required for their formulas to work.

**Scope of attribution:** service × account × region. **Does not attribute to code.**

**Known limits:** assumes 50% CPU utilization by default; publishes point estimates with no confidence intervals; self-described as "experimental."

---

## 3. How TerraTrace differs

### Versus CCFT (AWS's tool)

| Dimension | AWS CCFT | TerraTrace |
|---|---|---|
| Attribution depth | Service × region × month | Function / line of code |
| Output type | Dashboard number | Number + LLM-generated fix diff |
| Estate scope | AWS only | Code + on-prem + cloud (covers pre-migration and hybrid) |
| Timeframe | Retrospective only, 3-month lag | Retrospective + what-if (fix this code, shift region, migrate this workload) |
| Methodology | Proprietary market-based, includes renewables offsets | Location-based, sourced from CCF — defensible in tenders that require location-based figures |
| Pre-cloud clients | Nothing to show | On-prem mode gives a pre-migration baseline |

**When CCFT is actually the right pick** (be honest): a client already fully in AWS who just wants a monthly compliance snapshot and doesn't care about *what to change* is served fine by CCFT. TerraTrace is overkill there — don't pitch against that use case.

### Versus CCF (the open source project)

| Differentiator | CCF has it? | Verdict |
|---|---|---|
| Code-level attribution — trace a bill back to a function/line | ❌ | ✅ **Real gap, valid pitch** |
| LLM-generated fix diffs | ❌ | ✅ **Real gap, valid pitch** |
| What-if scenarios (fix this code, shift region) | Partial (region shift only) | ✅ **Partly novel** |
| Combined cost + carbon prioritization | ❌ | ✅ **Real gap** |
| On-prem mode | ✅ (they have a package) | ⚠️ Not novel — use theirs, don't reinvent |
| Cloud carbon numbers themselves | ✅ (5 years of methodology work) | ⚠️ **Do NOT try to compete on this — depend on it** |
| Multi-cloud (AWS/GCP/Azure/Alibaba) | ✅ | ⚠️ Long-tail; inherit via CCF |
| Confidence intervals | ❌ (point estimates only) | ✅ Small win — TerraTrace's `CarbonEstimate.confidence` field is more honest |

---

## 4. Recommended positioning lines

**One-liner for the field brief and bid decks:**

> *CCFT tells you what your AWS carbon was last quarter. TerraTrace tells you which loop in which service caused it, gives you a fix diff, and also works for the on-prem and pre-migration parts of the estate that CCFT can't see.*

**One-liner acknowledging CCF (use in any technical audience):**

> *TerraTrace stands on Cloud Carbon Footprint's methodology and (planned) directly depends on its npm packages. What we add is code-level attribution, LLM-generated fix diffs, and combined cost/carbon prioritization — the layer above CCF, not a competitor to it.*

**Bid line for EE public-sector tenders where sustainability is scored:**

> *TerraTrace uses Cloud Carbon Footprint's location-based Scope 2 methodology — the same methodology ThoughtWorks vouches for and that public-sector reviewers expect. On top of that, it attributes emissions down to the function and line, and produces developer-ready fix diffs so the reduction plan isn't just a spreadsheet.*

---

## 5. Concrete engineering implications

Positioning is only credible if the code matches the pitch. Three follow-ups the engineering team should schedule:

### 5.1 Depend on CCF, don't reinvent it

- `packages/core/src/carbon/carbonMath.ts` currently uses a single placeholder coefficient (`PLACEHOLDER_KWH_PER_USAGE_UNIT = 0.01`) for every service. Replace with a call into `@cloud-carbon-footprint/core`.
- One PR unlocks defensible numbers, plus we get GCP/Azure/Alibaba coefficients for free the moment we add those billing sources.
- Tradeoff we're accepting: we inherit CCF's 50% CPU utilization assumption and their point-estimate approach. If a client demands market-based reporting, we'll need to plan around it — CCF doesn't ship market-based.

### 5.2 `AWSCurSource` now reads a real CUR file — resolved

- Done: `packages/core/src/billing/AWSCurSource.ts` reads a real AWS CUR export file (`lineItem/*`, `product/*`, `pricing/*` columns) instead of calling Cost Explorer. `CostExplorerJsonSource`/`CostExplorerCsvSource` (Cost Explorer-API-shaped) were retired — Cost Explorer isn't CUR and CCF doesn't use it, so TerraTrace standardizes on one form.
- Still open: this reads a local file only. A live-fetch variant (CUR-via-Athena, or syncing CUR files from S3 directly) is a separate `CloudBillingSource` implementation to add later — see TESTING.md for how to pull a real CUR export in the meantime.

### 5.3 Use CCF's on-premise package for mode 2

- Their `@cloud-carbon-footprint/on-premise` package covers the on-prem infra mode described in the field brief.
- When we build mode 2, wrap that package. Don't start from scratch.

---

## 6. Prior art we should name openly

Doing this in the README, bid material, and any client-facing deck is good faith and makes the pitch more defensible in front of technical reviewers.

- **[Cloud Carbon Footprint](https://github.com/cloud-carbon-footprint/cloud-carbon-footprint)** (ThoughtWorks + community, Apache 2.0) — TerraTrace's methodology foundation for cloud and on-prem modes.
- **[AWS Customer Carbon Footprint Tool](https://aws.amazon.com/aws-cost-management/aws-customer-carbon-footprint-tool/)** — AWS's built-in dashboard, TerraTrace's primary comparator for cloud-fully-deployed clients.
- **[Etsy's Cloud Jewels](https://www.etsy.com/codeascraft/cloud-jewels-estimating-kwh-in-the-cloud)** — the original methodology CCF is built on.
- **[Green Software Foundation's Software Carbon Intensity (SCI)](https://sci.greensoftware.foundation/)** — an alternative methodology we are **not** currently using; worth naming so reviewers know we made a deliberate choice.

---

## 7. Open questions this doc doesn't answer

Copy-paste directly from the field brief — these are the ones the team still needs to settle. Nothing above changes them, but the positioning above should inform how each is decided:

1. **Scope for the first PoC** — build all three modes now, or ship cloud-mode first?
2. **On-prem data availability** — where does mode 2's utilization data come from in a real engagement?
3. **Shared or standalone scanner?** — is the code-pattern scanner tuned specifically for energy patterns, or shared with other static-analysis tooling EE already has?

---

*Prepared for the Terra Team field-brief discussion. Feedback and challenges welcome — the positioning is only as strong as the questions it's survived.*
