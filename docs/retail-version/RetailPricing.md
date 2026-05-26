# Photarium Retail Pricing Strategy

Internal planning memo. This is not public pricing copy, a public offer, or legal/commercial terms. Treat these numbers as launch-planning estimates for a self-hosted Photarium retail version and optional managed hosting service.

## Positioning

Photarium should not be priced like a narrow utility script. The stronger positioning is:

> Self-hosted visual asset management for small studios, agencies, labs, and content teams that want Cloudflare Images, search, AI enrichment, and optional MCP tooling without buying into a full enterprise DAM.

That places Photarium between low-cost self-hosted software and hosted image/DAM SaaS:

- **Sendy-style self-hosted anchor:** low one-time license, customer owns hosting and operations. Useful as a mental model, but too low for Photarium's scope.
- **Hosted image/DAM SaaS anchor:** recurring monthly pricing, vendor manages uptime, storage, upgrades, and support. Useful as the high-side comparison.
- **Infrastructure-cost anchor:** customer-visible hard costs are relatively modest: VPS, Cloudflare Images, backups, domain, and optional OpenAI usage.

The pricing should make the self-hosted license feel clearly cheaper than SaaS over a year, while still charging enough to fund documentation, updates, security work, and support.

## Self-Hosted License

Recommended tiers:

| Tier | Price | Intended customer | Notes |
| --- | ---: | --- | --- |
| Personal / Solo | $149 one-time | Individual creators, researchers, very small studios | One production install, 12 months of updates, docs/community support only. |
| Studio | $299-399 one-time | Small studios, agencies, labs, internal creative teams | Recommended default. One production install, client-site publishing, AI/MCP config support, 12 months of updates. |
| Business | $699-999 one-time | Operational teams using Photarium in production | Staging + production or up to 3 installs, priority email support, upgrade guidance. |

Recommended launch offer:

> **Photarium Studio: $349 one-time, including 12 months of updates.**

Annual renewal:

- Charge **35-50% of license price per year** for updates and support.
- Recommended Studio renewal: **$149/year**.
- Renewal should not be required for continued use of the existing installed version.
- Renewal should be required for new versions, security patches, compatibility updates, and support.

## Managed Hosting

Managed hosting is a materially different business. It includes uptime expectations, backups, monitoring, upgrades, customer hand-holding, and incident response. Do not price it like static hosting.

Recommended tiers:

| Tier | Price | Intended customer | Includes |
| --- | ---: | --- | --- |
| Managed Starter | $99/mo | Small internal library, low support need | One hosted instance, one customer domain, basic backups, best-effort email support. |
| Managed Studio | $199/mo | Recommended managed plan | VPS management, monitoring, backups, upgrades, restore assistance, MCP internal setup, basic monthly usage review. |
| Managed Business | $399/mo | Teams that expect support responsiveness | Priority support, staging instance, tighter backup/restore policy, custom domain/client-site help, quarterly upgrade review. |

Setup fees:

- Range: **$299-750 one-time**.
- Recommended Studio setup fee: **$499**.
- Business setup fee: **$750**.

Recommended managed offer:

> **Managed Photarium Studio: $199/mo + $499 setup.**

Avoid managed hosting below **$99/mo**. At that price, even one meaningful support interaction can consume the margin.

## Operating Cost Assumptions

These are planning estimates. Actual customer costs depend on image volume, delivery traffic, AI usage, backup policy, and support expectations.

Typical fixed costs:

| Item | Estimated cost | Notes |
| --- | ---: | --- |
| VPS, minimum | $12-18/mo | Small libraries only; limited headroom for Redis, imports, and Puppeteer. |
| VPS, recommended | $24-48/mo | Better fit for production Redis Stack, page imports, image processing, and MCP tooling. |
| VPS backups | +20-30% | Provider backup pricing varies. Still keep app-level Redis backups. |
| Domain | $10-25/year | Usually customer-owned. |

Usage costs:

| Item | Estimate | Notes |
| --- | ---: | --- |
| Cloudflare Images storage | Roughly $5 per 100k images/month | Customer should bring their own Cloudflare account by default. |
| Cloudflare Images delivery | Usage-based | Depends on public/client-site traffic. |
| OpenAI metadata | Usually low single-digit dollars/month for modest usage | Display names and tags are cheap with low-cost models. |
| OpenAI image generation | Highly variable | Do not bundle unlimited usage. |

Typical all-in customer cost:

| Scenario | Customer-paid operating cost |
| --- | ---: |
| Small self-hosted internal library | $25-40/mo plus license |
| Recommended self-hosted production setup | $35-60/mo plus license |
| Heavier AI/import/client-site usage | $75-180+/mo plus license |

## LLM And MCP Billing Policy

Default policy:

- Customer brings their own **Cloudflare** and **OpenAI** accounts.
- Photarium includes the integration and tooling, not unlimited third-party usage.
- If usage is bundled into a managed plan, pass through third-party usage at **cost + 15%**.
- Do not include unlimited image generation, bulk AI enrichment, or open-ended MCP agent usage.

Recommended framing:

- **LLM metadata features** are part of the product capability.
- **LLM/API usage costs** are customer-paid.
- **MCP tooling** is included as an advanced/operator feature.
- **MCP-triggered OpenAI calls, uploads, image generation, or heavy processing** count as customer usage.

## Competitive Logic

Self-hosted license:

- A $349 Studio license is high enough to signal serious software, but still far below a year of most hosted image/DAM SaaS.
- It gives the buyer a clear financial reason to self-host.
- It leaves room for paid renewals, implementation help, and managed hosting.

Managed hosting:

- $199/mo is the practical center of gravity.
- $99/mo can work only as a low-touch starter plan with strict boundaries.
- $399/mo is appropriate when the customer expects faster support, staging, restore help, or recurring operational attention.

Support reality:

- One hour of support can erase the margin on a $99/mo account.
- Setup should be charged separately because DNS, Cloudflare token scope, first import, backups, and customer handoff are where hidden labor accumulates.
- Managed hosting should have a written support boundary: no unlimited custom workflows, no unlimited import cleanup, no open-ended AI usage, and no emergency SLA unless separately contracted.

## Recommended Launch Pricing

Launch with two simple offers:

1. **Photarium Studio Self-Hosted**
   - $349 one-time
   - Includes 12 months of updates
   - Renewal: $149/year
   - Customer pays their own VPS, Cloudflare, and OpenAI usage

2. **Managed Photarium Studio**
   - $199/mo
   - $499 setup
   - Customer pays or reimburses Cloudflare and OpenAI usage
   - Includes VPS management, backups, upgrades, monitoring, and basic support

Hold back the Business tier until there is enough demand to justify more formal support commitments.

## Public Pricing Cautions

Before publishing any of this:

- Decide whether prices include tax.
- Define update/support terms clearly.
- Define refund policy.
- Define what counts as one install.
- Define whether staging is included.
- Define managed-hosting support hours and response expectations.
- Define pass-through billing for Cloudflare, OpenAI, and other third-party services.
- Avoid implying unlimited storage, unlimited image delivery, unlimited AI generation, or guaranteed uptime without explicit limits.

