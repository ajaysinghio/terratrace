# TerraTrace — Positioning (one-pager)

## The two questions any reviewer will ask

**"Isn't this just AWS's carbon dashboard?"** No — AWS CCFT stops at service × region × month. TerraTrace attributes down to the function/line and produces a fix diff.

**"Isn't this just Cloud Carbon Footprint?"** No — CCF stops at service × account. TerraTrace uses CCF's methodology as its foundation and adds code-level attribution, LLM-generated fix diffs, and combined cost/carbon prioritization. CCF is our upstream, not our competitor.

## Versus AWS CCFT (the free built-in dashboard)

| Dimension | AWS CCFT | TerraTrace |
|---|---|---|
| Attribution depth | Service × region × month | Function / line of code |
| Output | Dashboard number | Number + LLM-generated fix diff |
| Estate scope | AWS only | Code + on-prem + cloud |
| Timeframe | Retrospective, 3-month lag | Retrospective + what-if scenarios |
| Methodology | Proprietary, market-based (includes AWS renewables offsets) | Location-based, sourced from CCF — defensible in public-sector tenders |
| Pre-cloud clients | Nothing to show | On-prem mode gives a pre-migration baseline |

## Versus Cloud Carbon Footprint (open source)

| Dimension | CCF | TerraTrace |
|---|---|---|
| Cloud carbon numbers | ✅ (5 years of methodology work) | Depends on CCF, doesn't reinvent |
| Code-level attribution | ❌ | ✅ **Primary differentiator** |
| LLM-generated fix diffs | ❌ | ✅ **Primary differentiator** |
| Combined cost + carbon prioritization | ❌ | ✅ **Primary differentiator** |
| What-if scenarios | Partial (region shift only) | Fix-this-code / shift-region / migrate-this-workload |
| On-prem mode | ✅ | Wraps CCF's package |
| Multi-cloud | ✅ | Inherited via CCF |

## Positioning lines to use

**Field brief / bid deck one-liner:**
> *CCFT tells you what your AWS carbon was last quarter. TerraTrace tells you which loop in which service caused it, gives you a fix diff, and also works for the on-prem and pre-migration parts of the estate that CCFT can't see.*

**Technical audiences (acknowledges CCF):**
> *TerraTrace stands on Cloud Carbon Footprint's methodology and directly depends on its packages. What we add is code-level attribution, LLM-generated fix diffs, and combined cost/carbon prioritization — the layer above CCF, not a competitor to it.*

**EE public-sector tenders where sustainability is scored:**
> *TerraTrace uses CCF's location-based Scope 2 methodology — the same methodology ThoughtWorks vouches for and that public-sector reviewers expect. On top of that, it attributes emissions down to the function and line, and produces developer-ready fix diffs so the reduction plan isn't just a spreadsheet.*

## Where NOT to pitch

A client already fully in AWS who just wants a monthly compliance snapshot is served fine by CCFT. TerraTrace is overkill there — don't pitch against that use case.

## Prior art we name openly

- **[Cloud Carbon Footprint](https://github.com/cloud-carbon-footprint/cloud-carbon-footprint)** (ThoughtWorks + community, Apache 2.0) — our methodology foundation.
- **[AWS Customer Carbon Footprint Tool](https://aws.amazon.com/aws-cost-management/aws-customer-carbon-footprint-tool/)** — the primary comparator.
- **[Etsy's Cloud Jewels](https://www.etsy.com/codeascraft/cloud-jewels-estimating-kwh-in-the-cloud)** — the original methodology CCF builds on.
- **[Green Software Foundation SCI](https://sci.greensoftware.foundation/)** — alternative methodology we deliberately don't use.

---

*Full version with engineering implications: see [POSITIONING.md](./POSITIONING.md).*
