-- DOC-45 stage B: additive homepage collection configuration.
--
-- These tables store display configuration only. Product, Category, images and
-- prices remain in their existing master-data tables. The quantity fields are
-- final configured totals, not per-request page sizes; the later API reads them
-- in 24-item cursor batches. No application-level 36/120 cap is introduced.

-- CreateTable
CREATE TABLE "homepage_display_configs" (
    "id" UUID NOT NULL,
    "newArrivalsLimit" INTEGER NOT NULL DEFAULT 12,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "homepage_display_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homepage_display_configs_new_arrivals_limit_check"
      CHECK ("newArrivalsLimit" > 0 AND "newArrivalsLimit" % 6 = 0)
);

-- CreateTable
CREATE TABLE "homepage_collections" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productLimit" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "homepage_collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homepage_collections_product_limit_check"
      CHECK ("productLimit" > 0 AND "productLimit" % 6 = 0)
);

-- CreateTable
CREATE TABLE "homepage_collection_translations" (
    "collectionId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "subtitle" VARCHAR(500),

    CONSTRAINT "homepage_collection_translations_pkey" PRIMARY KEY ("collectionId","locale")
);

-- CreateTable
CREATE TABLE "homepage_collection_products" (
    "id" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homepage_collection_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "homepage_collections_categoryId_key" ON "homepage_collections"("categoryId");

-- CreateIndex
CREATE INDEX "homepage_collections_sortOrder_idx" ON "homepage_collections"("sortOrder");

-- CreateIndex
CREATE INDEX "homepage_collections_enabled_sortOrder_idx" ON "homepage_collections"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "homepage_collection_translations_locale_idx" ON "homepage_collection_translations"("locale");

-- CreateIndex
CREATE INDEX "homepage_collection_products_collectionId_sortOrder_id_idx" ON "homepage_collection_products"("collectionId", "sortOrder", "id");

-- CreateIndex
CREATE INDEX "homepage_collection_products_productId_idx" ON "homepage_collection_products"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_collection_products_collectionId_productId_key" ON "homepage_collection_products"("collectionId", "productId");

-- AddForeignKey
ALTER TABLE "homepage_collections" ADD CONSTRAINT "homepage_collections_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_collection_translations" ADD CONSTRAINT "homepage_collection_translations_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "homepage_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_collection_products" ADD CONSTRAINT "homepage_collection_products_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "homepage_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_collection_products" ADD CONSTRAINT "homepage_collection_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback (manual, after review): this release is expand-only. Prefer an
-- application rollback while retaining the new tables and any Admin config.
-- If configuration is confirmed unused, roll back in this order:
-- DROP TABLE "homepage_collection_products";
-- DROP TABLE "homepage_collection_translations";
-- DROP TABLE "homepage_collections";
-- DROP TABLE "homepage_display_configs";
