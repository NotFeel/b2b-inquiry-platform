# English FAQ for the B2B Inquiry Website — Executable Implementation Specification

- **Project:** B2B Inquiry Platform
- **Primary locale:** `en-US`
- **Secondary locale:** `zh-CN`
- **Purpose:** Public-facing English FAQ content and implementation requirements
- **Status:** Ready for implementation; verify repository conventions before coding

## 1. Goal and content principles

Add an English FAQ section/page to the public B2B website. The website is a product showcase and inquiry channel, not a checkout-based online store. Product prices must not be displayed publicly; visitors should be guided to contact the company through the existing WhatsApp or inquiry channel.

This initial copy deliberately avoids inventing company-specific promises. MOQ, sample charges, production lead time, payment terms, shipping options, certificates, and after-sales terms must be confirmed for the specific product/order by the sales team.

## 2. Page placement

- Preferred route: `/en-US/faq`
- Chinese route, if supported by current locale routing: `/zh-CN/faq`
- Navigation label: `FAQ` / `常见问题`
- Page title: **Frequently Asked Questions**
- Subtitle: `Find answers to common questions about our products, customization, orders, and shipping. Need more details? Contact our team.`
- Place a WhatsApp CTA near the introduction and after the FAQ list.
- If an existing content-page or FAQ pattern is available, extend and reuse it instead of creating a duplicate page system.

## 3. English FAQ copy — ready for the public website

### A. Products and product information

**Q1. What types of products do you offer?**

We offer a range of products shown in our online catalog. Browse the product categories and product pages to explore available styles and specifications. If you are looking for a particular item, contact us with your requirements and we will check the available options.

**Q2. Where can I find product specifications?**

Please check the relevant product page for the specifications currently available, such as size, material, color, or packaging information. If a detail is not listed, send us the product name or SKU and tell us what information you need.

**Q3. Are all products shown on the website currently available?**

Product availability may vary by item and may change over time. Please contact us with the product name or SKU to confirm current availability, options, and any applicable production arrangements.

**Q4. Do you display product prices online?**

We provide product information online, but prices are not displayed on the website. Pricing depends on the product, order quantity, customization requirements, packaging, and shipping destination. Contact us for a quotation based on your requirements.

### B. Wholesale, MOQ, and customization

**Q5. Do you accept wholesale or bulk orders?**

Please contact us with the products you are interested in and your estimated order quantity. Our team will review your requirements and confirm whether the requested order can be supported.

**Q6. What is your minimum order quantity (MOQ)?**

MOQ may vary by product, customization, and packaging requirements. Please share the product name or SKU and your estimated quantity so we can confirm the applicable MOQ.

**Q7. Can you customize products?**

Customization options depend on the product and project requirements. Contact us with your preferred design, colors, dimensions, materials, logo, or other requirements. We will review the request and confirm which options are available.

**Q8. Can you provide OEM or ODM services?**

Please tell us about your project, including the product concept, reference images or drawings, target quantity, and required specifications. Our team will assess the request and confirm the services and development options available for your project.

**Q9. Can you customize packaging or add a private label?**

Packaging and branding options depend on the product, order quantity, and artwork requirements. Please send your packaging preferences, logo files, target quantity, and destination market so we can review feasibility and provide details.

### C. Samples, orders, and production

**Q10. Can I request a sample before placing a bulk order?**

Sample availability, sample charges, shipping costs, and preparation time depend on the product and the requested customization. Contact us with the product details and delivery country so we can confirm the available sample arrangements.

**Q11. How long does production take?**

Production lead time depends on the product, order quantity, customization, packaging, and current production schedule. We will confirm the estimated lead time when reviewing your specific inquiry or quotation.

**Q12. What information should I include when requesting a quotation?**

To help us respond efficiently, please include as many of the following details as possible:

- Product name, SKU, or product link
- Estimated order quantity
- Customization, color, material, or logo requirements
- Packaging requirements
- Delivery country and city or postal code
- Target delivery date, if applicable

If some details are not yet decided, send the information you have and we can discuss the next steps.

**Q13. Can I change or cancel an order after confirmation?**

Changes or cancellations depend on the order status, materials already prepared, and production progress. Please contact our team as soon as possible and include your quotation or order reference. We will review the request and confirm what can be changed.

### D. Shipping, payment, and documents

**Q14. Do you ship to my country?**

Please provide your destination country and postal code, together with the products and estimated quantity. We will check the available shipping arrangements and confirm the applicable options and costs for your inquiry.

**Q15. How much does shipping cost, and how long will delivery take?**

Shipping cost and transit time depend on the destination, shipment size and weight, shipping method, and other logistics conditions. We will provide an estimate after reviewing your shipment details. Any estimate is subject to confirmation by the logistics provider.

**Q16. What payment methods and payment terms do you accept?**

Payment methods and terms are confirmed during the quotation and order-confirmation process. Please discuss your preferred arrangement with our sales team before placing an order. Do not treat any payment terms as confirmed until they are stated in your official quotation or order documents.

**Q17. Can you provide invoices, packing lists, or export documents?**

Please tell us which documents you need and the destination market. Our team will confirm which documents can be provided for your specific order and shipping arrangement.

### E. Quality, certificates, and after-sales support

**Q18. How do you manage product quality?**

Quality requirements should be discussed before an order is confirmed. Please share any required specifications, inspection criteria, packaging requirements, or quality documents. Our team will review your requirements and confirm the applicable arrangements for the product and order.

**Q19. Do your products have certificates or test reports?**

Certificates and test reports, where available, vary by product, model, material, and target market. Please tell us the exact product and the standards or documents you require. We will confirm whether relevant documentation is available. Do not assume that a certificate displayed for one product applies to every product.

**Q20. What should I do if a product arrives damaged or does not match the confirmed order?**

Please contact us promptly and provide your order reference, a description of the issue, and clear photos or videos of the product and packaging. Our team will review the information and explain the next steps according to the confirmed order terms.

### F. Contact and response

**Q21. How can I contact you about a product?**

Use the WhatsApp inquiry button on a product page or the website contact section. Include the product name or SKU, a link to the product, your estimated quantity, and your main requirements so our team can understand your inquiry.

**Q22. What if I cannot find the product I need on the website?**

Send us a description, reference image, drawing, or example link, together with your estimated quantity and any important specifications. We will review your request and let you know whether we can assist.

**Q23. What information should I send in my first message on WhatsApp?**

You can use this simple format:

> Hello, I am interested in your product [product name or SKU]. My estimated quantity is [quantity]. My requirements are [customization or packaging details]. The delivery destination is [country/postal code]. Could you please share availability, MOQ, pricing, and estimated lead time?

Please replace the bracketed text with your own details. Sharing more information at the beginning usually helps us review your inquiry more efficiently.

## 4. FAQ data and content management requirements

### 4.1 Implementation approach

1. Inspect current public routes, locale routing, navigation, i18n resources, content-page implementation, API conventions, and Prisma schema before coding.
2. Reuse the current content-page/translation mechanism if it can support FAQ entries. Do not create a second CMS or duplicate existing models without evidence that the current model cannot meet the requirements.
3. If the existing content system cannot represent individual questions and answers, propose the smallest compatible extension and migration before implementing it.
4. The 23 entries may be seeded as content. Prefer manageable records over a hard-coded component so operators can update answers later.

### 4.2 Suggested logical fields

Use existing equivalent fields if present. Otherwise, the logical data contract is:

| Field | Requirement |
|---|---|
| `id` | Stable unique identifier |
| `code` | Stable unique code, e.g. `faq.product.pricing` |
| `question` | Required localized question |
| `answer` | Required localized answer; use the project's safe rich-text/Markdown convention |
| `category` | Stable code: `products`, `wholesale`, `orders`, `shipping`, `quality`, `contact` |
| `sortOrder` | Integer; lower values appear first |
| `status` | Reuse existing publication-status convention where possible |
| `locale` | Use existing translation mechanism for `en-US` and `zh-CN` |
| timestamps | Follow existing persistence conventions |

If using parent/translation records, keep stable fields such as `code`, `category`, `sortOrder`, and publication state on the parent; put localized question/answer text in translation records.

### 4.3 Publication rules

- Publish the English entries only after a business owner reviews them.
- If Chinese translation is not ready, do not display English on a `zh-CN` page unless the existing product explicitly supports a documented fallback policy.
- Public APIs return only published and public FAQ records.
- Sort by category order, then `sortOrder`, with a stable tie-breaker such as ID.
- Do not expose internal notes, unpublished answers, audit fields, or private file links publicly.
- Do not include prices, discounts, payment credentials, or private quotation information in FAQ content.

## 5. Frontend behavior and UI requirements

### 5.1 Layout

- Heading: `Frequently Asked Questions`
- Use the subtitle in Section 2.
- Render categories as section headings or accessible category tabs. On narrow screens, prefer stacked sections if tabs become cramped.
- Render each question as an accessible accordion item.
- Multiple answers may remain open unless the existing shared accordion uses a different consistent behavior.
- Add a WhatsApp CTA after the introduction and at the bottom.
- Follow existing public-site typography, spacing, buttons, and colors.
- Responsive on desktop, tablet, and mobile.

### 5.2 Accordion accessibility

- Each question is a real button with an accessible name.
- Expose expanded state using `aria-expanded` and associate the trigger with its panel using `aria-controls`.
- Support keyboard activation and visible focus styles.
- Do not communicate state through color alone; maintain readable contrast and comfortable mobile tap targets.

### 5.3 WhatsApp CTA

- Reuse the existing WhatsApp URL/configuration and inquiry-message builder; do not hard-code another phone number or duplicate business settings.
- Suggested label: `Ask Us on WhatsApp`.
- Suggested default message: `Hello, I have a question about your products. Could you please help me?`
- If WhatsApp configuration is missing or invalid, show the existing contact fallback rather than a broken link.
- Open external links safely according to project conventions.

### 5.4 SEO

- Page title: `Frequently Asked Questions | [Configured Brand Name]`
- Meta description: `Find answers about product options, wholesale inquiries, customization, samples, shipping, and quality documentation. Contact our team for product-specific details.`
- Use the configured brand name; do not hard-code a new brand name.
- Add FAQ structured data only if the project's SEO implementation supports it and markup exactly matches visible content. Do not add hidden or misleading FAQ schema.

## 6. Localization

- English locale: `en-US`; Chinese locale: `zh-CN`.
- Translate navigation labels, page title, subtitle, category headings, CTA labels, loading/empty/error states, and metadata.
- Translate FAQ answers only through reviewed content; do not silently fall back to English if that would display the wrong language.
- Follow current locale routing conventions.

Suggested UI keys (adapt to existing naming conventions):

```text
faq.title
faq.subtitle
faq.category.products
faq.category.wholesale
faq.category.orders
faq.category.shipping
faq.category.quality
faq.category.contact
faq.cta.whatsapp
faq.loading
faq.empty
faq.error
```

## 7. API and security

- Reuse existing public content API patterns where possible.
- Validate locale and publication state on the server.
- Public endpoint does not require an admin session, but exposes only published, public content.
- Admin create/update/publish operations, if added, use existing authentication, permissions, validation, and audit conventions.
- Sanitize rich text/HTML using the project's existing safe-rendering approach. Never render arbitrary unsanitized HTML from admin input.
- Apply the existing cache invalidation strategy when FAQ content is published, unpublished, or updated.

## 8. Acceptance criteria

### Content
- [ ] All 23 English Q&A entries are available in the initial content set.
- [ ] No unverified MOQ, lead time, payment term, shipping promise, warranty, or certification claim is presented as a guarantee.
- [ ] Product prices are not shown on the FAQ page or returned by the FAQ API.
- [ ] Answers remain readable on desktop and mobile.
- [ ] Missing Chinese translations do not silently leak English into the Chinese locale unless an explicit fallback policy exists.

### Functionality
- [ ] `/en-US/faq` loads and refreshes directly without routing errors.
- [ ] FAQ categories and sort order are consistent.
- [ ] Accordion items work with mouse, touch, and keyboard.
- [ ] WhatsApp CTA uses existing configured contact settings.
- [ ] Empty, loading, and API error states are handled.
- [ ] Only published records are visible publicly.
- [ ] If admin-managed, edits and publication changes are reflected according to the existing cache invalidation behavior.

### Regression and quality
- [ ] Verify at 1440px, 1024px, 768px, 390px, and 320–360px viewport widths.
- [ ] Verify English and Chinese navigation, page metadata, and language switching.
- [ ] Run actual repository lint, type-check, build, and relevant tests; record commands and results.
- [ ] Confirm product inquiry/WhatsApp flow and existing product pages remain unaffected.

## 9. Implementation sequence for the coding agent

1. Read `AGENTS.md`, README, `项目背景与需求.md`, `技术架构与设计决策.md`, `已确认问题与解决方案.md`, current routes, i18n resources, content models, migrations, public APIs, and tests.
2. Report the existing implementation and identify which models/components can be reused.
3. Add the FAQ route and responsive page using the existing layout and design system.
4. Add or seed the 23 English entries using the smallest compatible data approach. Do not invent a schema if existing content support is sufficient.
5. Connect the page to the published-content source and reuse existing WhatsApp configuration.
6. Add localization, accessibility, SEO metadata, safe content rendering, and loading/empty/error states.
7. Add/update tests for publication filtering, locale behavior, ordering, accordion behavior, and WhatsApp fallback.
8. Run real project checks and report modified files, migrations (if any), test commands/results, and unresolved business confirmations.

## 10. Copy-and-run prompt for VS Code AI

```text
Implement the public English FAQ page according to `英文FAQ前台页面_可执行开发规范.md`.

Before coding, inspect AGENTS.md, README, the three project baseline documents, current frontend routes/layout/i18n, existing content-page and translation models, Prisma schema/migrations, public API conventions, WhatsApp configuration, and tests. Reuse existing implementations wherever possible; do not invent duplicate models or hard-code a new WhatsApp number.

Create `/en-US/faq` using the 23 English Q&A entries in the specification. Keep product prices off the public page and do not turn product-dependent business terms into guarantees. Display only published public FAQ content. Preserve `zh-CN` behavior without silently showing English unless an explicit fallback policy exists. Use an accessible responsive accordion, existing design components, current WhatsApp configuration, SEO metadata, safe content rendering, and loading/empty/error states.

If existing content models support the feature, reuse them. If a schema change is necessary, explain why and implement the smallest compatible migration. Add tests for route rendering, locale, publication filtering, ordering, accordion accessibility, and WhatsApp fallback. Run actual lint/type-check/build/tests and report changed files, migration details, commands/results, and unresolved business confirmations. Do not claim tests passed unless they were actually run.
```

## 11. Business review checklist before publishing

These items require confirmation by the business owner; the copy intentionally avoids assuming the answers:

- [ ] Product categories and product types currently offered
- [ ] Product-specific MOQ policy and whether a general MOQ statement is approved
- [ ] Sample availability, sample charges, and shipping charges
- [ ] Available customization, OEM/ODM, logo, and packaging options
- [ ] Typical production lead-time guidance, if the company wants to publish it
- [ ] Countries served and shipping methods currently supported
- [ ] Payment methods and standard payment terms
- [ ] Certificates/test reports available for specific products and markets
- [ ] Official after-sales, damage-reporting, replacement, or refund policy
- [ ] Approved WhatsApp configuration and sales response expectations

**Publishing rule:** Do not replace cautious wording with specific guarantees until the business owner confirms them and the terms are documented.
