import type { FaqCategoryCode } from '@b2b/contracts';

export interface FaqSeedEntry {
  code: string;
  category: FaqCategoryCode;
  sortOrder: number;
  question: string;
  answer: string;
  /**
   * Used only to upgrade the three original seed rows after the category/code
   * migration. Administrator-edited copy never matches and is preserved.
   */
  legacyQuestion?: string;
}

/**
 * Reviewed English FAQ starter content from
 * `docs/English-FAQ-for-the-B2B-Inquiry-Website — Executable Implementation
 * Specification.md`. Product-dependent commitments remain deliberately
 * cautious and must be confirmed for each inquiry.
 */
export const FAQ_SEED: readonly FaqSeedEntry[] = [
  {
    code: 'faq.products.types',
    category: 'products',
    sortOrder: 10,
    question: 'What types of products do you offer?',
    answer:
      '<p>We offer a range of products shown in our online catalog. Browse the product categories and product pages to explore available styles and specifications. If you are looking for a particular item, contact us with your requirements and we will check the available options.</p>',
  },
  {
    code: 'faq.products.specifications',
    category: 'products',
    sortOrder: 20,
    question: 'Where can I find product specifications?',
    answer:
      '<p>Please check the relevant product page for the specifications currently available, such as size, material, color, or packaging information. If a detail is not listed, send us the product name or SKU and tell us what information you need.</p>',
  },
  {
    code: 'faq.products.availability',
    category: 'products',
    sortOrder: 30,
    question: 'Are all products shown on the website currently available?',
    answer:
      '<p>Product availability may vary by item and may change over time. Please contact us with the product name or SKU to confirm current availability, options, and any applicable production arrangements.</p>',
  },
  {
    code: 'faq.products.pricing',
    category: 'products',
    sortOrder: 40,
    legacyQuestion: 'Do you publish prices on the website?',
    question: 'Do you display product prices online?',
    answer:
      '<p>We provide product information online, but prices are not displayed on the website. Pricing depends on the product, order quantity, customization requirements, packaging, and shipping destination. Contact us for a quotation based on your requirements.</p>',
  },
  {
    code: 'faq.wholesale.orders',
    category: 'wholesale',
    sortOrder: 50,
    question: 'Do you accept wholesale or bulk orders?',
    answer:
      '<p>Please contact us with the products you are interested in and your estimated order quantity. Our team will review your requirements and confirm whether the requested order can be supported.</p>',
  },
  {
    code: 'faq.wholesale.moq',
    category: 'wholesale',
    sortOrder: 60,
    question: 'What is your minimum order quantity (MOQ)?',
    answer:
      '<p>MOQ may vary by product, customization, and packaging requirements. Please share the product name or SKU and your estimated quantity so we can confirm the applicable MOQ.</p>',
  },
  {
    code: 'faq.wholesale.customization',
    category: 'wholesale',
    sortOrder: 70,
    question: 'Can you customize products?',
    answer:
      '<p>Customization options depend on the product and project requirements. Contact us with your preferred design, colors, dimensions, materials, logo, or other requirements. We will review the request and confirm which options are available.</p>',
  },
  {
    code: 'faq.wholesale.oem_odm',
    category: 'wholesale',
    sortOrder: 80,
    question: 'Can you provide OEM or ODM services?',
    answer:
      '<p>Please tell us about your project, including the product concept, reference images or drawings, target quantity, and required specifications. Our team will assess the request and confirm the services and development options available for your project.</p>',
  },
  {
    code: 'faq.wholesale.packaging',
    category: 'wholesale',
    sortOrder: 90,
    legacyQuestion: 'Can you customise packaging or print our logo?',
    question: 'Can you customize packaging or add a private label?',
    answer:
      '<p>Packaging and branding options depend on the product, order quantity, and artwork requirements. Please send your packaging preferences, logo files, target quantity, and destination market so we can review feasibility and provide details.</p>',
  },
  {
    code: 'faq.orders.samples',
    category: 'orders',
    sortOrder: 100,
    question: 'Can I request a sample before placing a bulk order?',
    answer:
      '<p>Sample availability, sample charges, shipping costs, and preparation time depend on the product and the requested customization. Contact us with the product details and delivery country so we can confirm the available sample arrangements.</p>',
  },
  {
    code: 'faq.orders.lead_time',
    category: 'orders',
    sortOrder: 110,
    legacyQuestion: 'What is the typical lead time?',
    question: 'How long does production take?',
    answer:
      '<p>Production lead time depends on the product, order quantity, customization, packaging, and current production schedule. We will confirm the estimated lead time when reviewing your specific inquiry or quotation.</p>',
  },
  {
    code: 'faq.orders.quote_details',
    category: 'orders',
    sortOrder: 120,
    question: 'What information should I include when requesting a quotation?',
    answer:
      '<p>To help us respond efficiently, please include as many of the following details as possible:</p><ul><li>Product name, SKU, or product link</li><li>Estimated order quantity</li><li>Customization, color, material, or logo requirements</li><li>Packaging requirements</li><li>Delivery country and city or postal code</li><li>Target delivery date, if applicable</li></ul><p>If some details are not yet decided, send the information you have and we can discuss the next steps.</p>',
  },
  {
    code: 'faq.orders.changes',
    category: 'orders',
    sortOrder: 130,
    question: 'Can I change or cancel an order after confirmation?',
    answer:
      '<p>Changes or cancellations depend on the order status, materials already prepared, and production progress. Please contact our team as soon as possible and include your quotation or order reference. We will review the request and confirm what can be changed.</p>',
  },
  {
    code: 'faq.shipping.destinations',
    category: 'shipping',
    sortOrder: 140,
    question: 'Do you ship to my country?',
    answer:
      '<p>Please provide your destination country and postal code, together with the products and estimated quantity. We will check the available shipping arrangements and confirm the applicable options and costs for your inquiry.</p>',
  },
  {
    code: 'faq.shipping.cost_time',
    category: 'shipping',
    sortOrder: 150,
    question: 'How much does shipping cost, and how long will delivery take?',
    answer:
      '<p>Shipping cost and transit time depend on the destination, shipment size and weight, shipping method, and other logistics conditions. We will provide an estimate after reviewing your shipment details. Any estimate is subject to confirmation by the logistics provider.</p>',
  },
  {
    code: 'faq.shipping.payment',
    category: 'shipping',
    sortOrder: 160,
    question: 'What payment methods and payment terms do you accept?',
    answer:
      '<p>Payment methods and terms are confirmed during the quotation and order-confirmation process. Please discuss your preferred arrangement with our sales team before placing an order. Do not treat any payment terms as confirmed until they are stated in your official quotation or order documents.</p>',
  },
  {
    code: 'faq.shipping.documents',
    category: 'shipping',
    sortOrder: 170,
    question: 'Can you provide invoices, packing lists, or export documents?',
    answer:
      '<p>Please tell us which documents you need and the destination market. Our team will confirm which documents can be provided for your specific order and shipping arrangement.</p>',
  },
  {
    code: 'faq.quality.management',
    category: 'quality',
    sortOrder: 180,
    question: 'How do you manage product quality?',
    answer:
      '<p>Quality requirements should be discussed before an order is confirmed. Please share any required specifications, inspection criteria, packaging requirements, or quality documents. Our team will review your requirements and confirm the applicable arrangements for the product and order.</p>',
  },
  {
    code: 'faq.quality.certificates',
    category: 'quality',
    sortOrder: 190,
    question: 'Do your products have certificates or test reports?',
    answer:
      '<p>Certificates and test reports, where available, vary by product, model, material, and target market. Please tell us the exact product and the standards or documents you require. We will confirm whether relevant documentation is available. Do not assume that a certificate displayed for one product applies to every product.</p>',
  },
  {
    code: 'faq.quality.damaged_item',
    category: 'quality',
    sortOrder: 200,
    question:
      'What should I do if a product arrives damaged or does not match the confirmed order?',
    answer:
      '<p>Please contact us promptly and provide your order reference, a description of the issue, and clear photos or videos of the product and packaging. Our team will review the information and explain the next steps according to the confirmed order terms.</p>',
  },
  {
    code: 'faq.contact.product',
    category: 'contact',
    sortOrder: 210,
    question: 'How can I contact you about a product?',
    answer:
      '<p>Use the WhatsApp inquiry button on a product page or the website contact section. Include the product name or SKU, a link to the product, your estimated quantity, and your main requirements so our team can understand your inquiry.</p>',
  },
  {
    code: 'faq.contact.unlisted_product',
    category: 'contact',
    sortOrder: 220,
    question: 'What if I cannot find the product I need on the website?',
    answer:
      '<p>Send us a description, reference image, drawing, or example link, together with your estimated quantity and any important specifications. We will review your request and let you know whether we can assist.</p>',
  },
  {
    code: 'faq.contact.whatsapp_message',
    category: 'contact',
    sortOrder: 230,
    question: 'What information should I send in my first message on WhatsApp?',
    answer:
      '<p>You can use this simple format:</p><blockquote><p>Hello, I am interested in your product [product name or SKU]. My estimated quantity is [quantity]. My requirements are [customization or packaging details]. The delivery destination is [country/postal code]. Could you please share availability, MOQ, pricing, and estimated lead time?</p></blockquote><p>Please replace the bracketed text with your own details. Sharing more information at the beginning usually helps us review your inquiry more efficiently.</p>',
  },
];
