---
name: meta-ads-analyzer
description: Analyse Meta (Facebook/Instagram) ad performance and say what to cut, keep, or scale. Use when the user asks how their Meta/Facebook/Instagram ads are doing, wants a weekly ads check, asks about ROAS, spend, CPA, creative fatigue, wasted budget, or "what should I change in my ads". Read-only; never changes campaigns without explicit approval.
---

# Meta Ads Analyzer

Gives a short, decision-ready read on Meta ad performance: what's making money, what's wasting it, and the 1–3 changes worth making this week.

## Ground rules

- **Read-only by default.** Never call `ads_update_entity`, `ads_activate_entity`, or any create/delete tool unless the user approves that exact change in this conversation. Propose changes; don't make them.
- **Numbers come from tools, never memory.** If a tool fails or returns nothing, say so. Don't fill gaps with estimates.
- **Judge against break-even, not vibes.** A 2.0 ROAS is great at 70% margin and a loss at 40%.
- **Small samples lie.** Don't call a winner or loser on fewer than ~1,000 impressions or under ~3 conversions. Flag it as "too early".
- Tag each key claim **[Certain]** (straight from data), **[Likely]** (strong inference), or **[Guessing]**.

## Workflow

### 1. Find the account
Call `ads_get_ad_accounts`. If there's one queryable account, use it. If several, ask which. If `is_queryable` is false, report `not_queryable_reason` and stop.

### 2. Get the break-even ROAS
Break-even ROAS = 1 ÷ gross margin (after COGS, shipping, payment fees).
- If the user has given a margin or target ROAS, use it.
- Otherwise ask once: "What's your rough gross margin, or the ROAS you need to break even?"
- If they don't know, use 2.5 as a placeholder and label it **[Guessing]**.

### 3. Pull the data (in this order)
Use `advertiser_job: "assess_and_optimize_performance"` (or `explain_poor_results` if they're asking why things got worse).

1. `ads_get_ad_entities`, `level: "ad_account"`, `date_preset: "last_7d"` and again with `last_28d`. This gives overall spend, results, and ROAS, and shows whether the last week is better or worse than the month.
2. `ads_get_ad_entities`, `level: "campaign"`, `last_28d`, filtered to `effective_status IN ["ACTIVE"]`, sorted by spend descending.
3. `ads_get_ad_entities`, `level: "ad"`, `last_28d`, `reporting_purpose: ["creative"]`, sorted by spend descending, limit 20.
4. **Follow every read-only `next_actions` item** the entity calls return before writing the answer.
5. `ads_insights_anomaly_signal`: sudden spikes and drops.
6. `ads_insights_performance_vs_peers`, `last_28d`: is this good or bad compared with similar advertisers?
7. `ads_get_opportunity_score`: Meta's own recommendations. Treat as suggestions, not gospel; Meta's advice tends to favour spending more.

Verify any non-default field with `ads_get_field_context` before requesting it. Never invent field names.

### 4. Sort ads into buckets
For each ad with enough data:

| Bucket | Rule |
|---|---|
| **Scale** | ROAS ≥ 1.3 × break-even, stable or improving over 7d vs 28d |
| **Keep** | ROAS between break-even and 1.3 × break-even |
| **Fix or cut** | ROAS below break-even after meaningful spend (≥ 2 × target CPA with no sale = cut) |
| **Fatigued** | Frequency > 3 (prospecting) and CTR down > 25% or CPM up > 25% (7d vs 28d) |
| **Too early** | Below the sample thresholds above |

### 5. Write the report
Keep it phone-readable. Lead with the verdict.

```
**Verdict:** <one line: profitable / break-even / losing money, and the trend>

**Last 7 days vs last 28 days**
Spend · Purchases · ROAS (vs break-even X) · CPA · CTR · CPM

**Do this week** (max 3, biggest money impact first)
1. <action> — <why, with the number> — <expected effect> [confidence]

**Wasting money**: ads/campaigns below break-even, with spend
**Worth scaling**: ads above 1.3× break-even, with suggested budget step (+20–30%, not doubling)
**Fatigue watch**: ads with rising frequency and falling CTR
**Anomalies / Meta recommendations**: only the ones that matter
**Too early to call**: list briefly
```

End with: "Want me to make any of these changes?" Only act on a clear yes, and confirm each change (entity, old value → new value) before calling a write tool.

## Things to watch for

- **Attribution inflation:** Meta's default (7-day click, 1-day view) over-credits Meta. If Shopify revenue is available, compare total Meta-reported purchase value against actual Shopify sales for the same period and flag a big gap.
- **Learning phase:** ad sets with fewer than ~50 conversions a week behave erratically. Don't recommend edits to an ad set that's still learning unless it's clearly burning cash.
- **Budget changes:** suggest increases of 20–30% at a time; big jumps reset learning.
- **Retargeting vs prospecting:** retargeting ROAS always looks better. Don't move prospecting budget into retargeting based on ROAS alone.
- **Currency:** report in the account's currency and say which it is.
